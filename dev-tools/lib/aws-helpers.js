const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const { CognitoIdentityProviderClient, DescribeUserPoolClientCommand, ListUsersCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { ConfigurationError, ApiError, ResourceNotFoundError } = require('./errors');

/**
 * AWS クライアントの初期化
 * @param {string} profile - AWS SSO profile name
 * @param {string} region - AWS region (optional)
 * @returns {Object} AWS clients object
 */
function createAwsClients(profile, region) {
    const config = {
        profile: profile
    };

    // リージョンが指定されている場合は追加
    if (region) {
        config.region = region;
    }

    try {
        const cloudFormationClient = new CloudFormationClient(config);
        const cognitoClient = new CognitoIdentityProviderClient(config);
        const dynamoClient = new DynamoDBClient(config);

        return {
            cloudFormation: cloudFormationClient,
            cognito: cognitoClient,
            dynamo: dynamoClient
        };
    } catch (error) {
        throw new ConfigurationError(`Failed to initialize AWS clients for profile '${profile}'${region ? ` in region '${region}'` : ''}: ${error.message}`, error);
    }
}

/**
 * Sankeyスタック検索関数（staging削除、環境別API Gateway対応）
 * @param {CloudFormationClient} cloudFormationClient
 * @param {Object} options - Debug options
 * @returns {Array} Stack combinations
 */
// Note: This function relies on specific stack naming conventions for the 'Sankey' project.
// It expects stack names like 'SankeyDevAuthStack', 'SankeyProdApiStack', etc.
async function findSankeyStacks(cloudFormationClient, options) {
    try {
        const command = new DescribeStacksCommand({});
        const response = await cloudFormationClient.send(command);

        // Sankeyスタックのパターンマッチング（staging削除）
        const authStackPattern = /^Sankey(Dev|Prod)AuthStack$/;
        const apiStackPattern = /^Sankey(Dev|Prod)ApiStack$/;  // 環境別API Gateway
        const dbStackPattern = /^Sankey(Dev|Prod)DbStack$/;
        const notificationStackPattern = /^Sankey(Dev|Prod)NotificationStack$/;

        const authStacks = response.Stacks.filter(stack =>
            authStackPattern.test(stack.StackName) &&
            stack.StackStatus !== 'DELETE_COMPLETE'
        );

        const apiStacks = response.Stacks.filter(stack =>
            apiStackPattern.test(stack.StackName) &&
            stack.StackStatus !== 'DELETE_COMPLETE'
        );

        const dbStacks = response.Stacks.filter(stack =>
            dbStackPattern.test(stack.StackName) &&
            stack.StackStatus !== 'DELETE_COMPLETE'
        );

        const notificationStacks = response.Stacks.filter(stack =>
            notificationStackPattern.test(stack.StackName) &&
            stack.StackStatus !== 'DELETE_COMPLETE'
        );

        // 環境ごとにペアを作成
        const combinations = [];

        for (const authStack of authStacks) {
            const envMatch = authStack.StackName.match(/^Sankey(Dev|Prod)AuthStack$/);
            if (envMatch) {
                const environment = envMatch[1];
                const expectedApiStackName = `Sankey${environment}ApiStack`;
                const expectedDbStackName = `Sankey${environment}DbStack`;
                const expectedNotificationStackName = `Sankey${environment}NotificationStack`;

                const apiStack = apiStacks.find(stack => stack.StackName === expectedApiStackName);
                const dbStack = dbStacks.find(stack => stack.StackName === expectedDbStackName);
                const notificationStack = notificationStacks.find(stack => stack.StackName === expectedNotificationStackName);

                if (apiStack && dbStack && notificationStack) {
                    combinations.push({
                        environment: environment.toLowerCase(),
                        authStack: authStack,
                        apiStack: apiStack,
                        dbStack: dbStack,
                        notificationStack: notificationStack
                    });
                }
            }
        }

        return combinations;

    } catch (error) {
        throw new ApiError(`Failed to fetch CloudFormation stacks: ${error.message}`, 'AWS CloudFormation', error.name, error);
    }
}

/**
 * CloudFormation Output取得関数
 * @param {CloudFormationClient} cloudFormationClient
 * @param {string} stackName
 * @param {Array} outputKeys
 * @param {Object} options
 * @returns {Object} Outputs object
 */
async function getStackOutputs(cloudFormationClient, stackName, outputKeys, options) {
    try {
        const command = new DescribeStacksCommand({ StackName: stackName });
        const response = await cloudFormationClient.send(command);

        if (!response.Stacks || response.Stacks.length === 0) {
            throw new ResourceNotFoundError('CloudFormation Stack', stackName);
        }

        const stack = response.Stacks[0];
        const outputs = {};

        if (!stack.Outputs) {
            return outputs;
        }

        for (const outputKey of outputKeys) {
            const output = stack.Outputs.find(o => o.OutputKey === outputKey);
            if (output) {
                outputs[outputKey] = output.OutputValue;
            }
        }

        return outputs;

    } catch (error) {
        if (error instanceof ResourceNotFoundError) throw error;
        throw new ApiError(`Failed to get outputs from CloudFormation stack '${stackName}': ${error.message}`, 'AWS CloudFormation', error.name, error);
    }
}

/**
 * Cognito詳細取得関数
 * @param {CognitoIdentityProviderClient} cognitoClient
 * @param {string} userPoolId
 * @param {string} userPoolClientId
 * @param {Object} options
 * @returns {Object} Cognito details
 */
async function getCognitoDetails(cognitoClient, userPoolId, userPoolClientId, options) {
    try {
        const command = new DescribeUserPoolClientCommand({
            UserPoolId: userPoolId,
            ClientId: userPoolClientId
        });

        const response = await cognitoClient.send(command);

        if (!response.UserPoolClient) {
            throw new ResourceNotFoundError('Cognito UserPoolClient', userPoolClientId);
        }

        const client = response.UserPoolClient;

        return {
            clientSecret: client.ClientSecret,
            clientName: client.ClientName,
            callbackUrls: client.CallbackURLs || [],
            logoutUrls: client.LogoutURLs || []
        };

    } catch (error) {
        if (error instanceof ResourceNotFoundError) throw error;
        throw new ApiError(`Failed to get Cognito UserPoolClient details for '${userPoolClientId}': ${error.message}`, 'AWS Cognito', error.name, error);
    }
}

/**
 * Cognitoユーザー検索（メールアドレスから逆引き）
 * @param {CognitoIdentityProviderClient} cognitoClient
 * @param {string} userPoolId
 * @param {string} email
 * @returns {Object} User information
 */
async function findUserByEmail(cognitoClient, userPoolId, email) {
    try {
        const command = new ListUsersCommand({
            UserPoolId: userPoolId
        });

        const response = await cognitoClient.send(command);

        for (const user of response.Users) {
            const emailAttr = user.Attributes.find(attr => attr.Name === 'email');
            if (emailAttr && emailAttr.Value === email) {
                return {
                    userId: user.Username,
                    email: emailAttr.Value,
                    userStatus: user.UserStatus,
                    enabled: user.Enabled
                };
            }
        }

        return null;

    } catch (error) {
        throw new ApiError(`Failed to find user by email '${email}' in UserPool '${userPoolId}': ${error.message}`, 'AWS Cognito', error.name, error);
    }
}

/**
 * Cognitoユーザー一覧取得
 * @param {CognitoIdentityProviderClient} cognitoClient
 * @param {string} userPoolId
 * @returns {Array} Users list
 */
async function listAllUsers(cognitoClient, userPoolId) {
    try {
        const command = new ListUsersCommand({
            UserPoolId: userPoolId
        });

        const response = await cognitoClient.send(command);

        return response.Users.map(user => {
            const emailAttr = user.Attributes.find(attr => attr.Name === 'email');
            return {
                userId: user.Username,
                email: emailAttr ? emailAttr.Value : null,
                userStatus: user.UserStatus,
                enabled: user.Enabled
            };
        });

    } catch (error) {
        throw new ApiError(`Failed to list users in UserPool '${userPoolId}': ${error.message}`, 'AWS Cognito', error.name, error);
    }
}

module.exports = {
    createAwsClients,
    findSankeyStacks,
    getStackOutputs,
    getCognitoDetails,
    findUserByEmail,
    listAllUsers
};