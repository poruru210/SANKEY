const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const { CognitoIdentityProviderClient, DescribeUserPoolClientCommand, ListUsersCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

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
        throw new Error(`Failed to initialize AWS clients: ${error.message}`);
    }
}

/**
 * Sankeyスタック検索関数
 * @param {CloudFormationClient} cloudFormationClient
 * @param {Object} options - Debug options
 * @returns {Array} Stack combinations
 */
async function findSankeyStacks(cloudFormationClient, options) {
    try {
        const command = new DescribeStacksCommand({});
        const response = await cloudFormationClient.send(command);

        // Sankeyスタックのパターンマッチング
        const authStackPattern = /^Sankey(Dev|Staging|Prod)AuthStack$/;
        const apiStackPattern = /^Sankey(Dev|Staging|Prod)ApiStack$/;
        const dbStackPattern = /^Sankey(Dev|Staging|Prod)DbStack$/;

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

        // 環境ごとにペアを作成
        const combinations = [];

        for (const authStack of authStacks) {
            const envMatch = authStack.StackName.match(/^Sankey(Dev|Staging|Prod)AuthStack$/);
            if (envMatch) {
                const environment = envMatch[1];
                const expectedApiStackName = `Sankey${environment}ApiStack`;
                const expectedDbStackName = `Sankey${environment}DbStack`;

                const apiStack = apiStacks.find(stack => stack.StackName === expectedApiStackName);
                const dbStack = dbStacks.find(stack => stack.StackName === expectedDbStackName);

                if (apiStack && dbStack) {
                    combinations.push({
                        environment: environment.toLowerCase(),
                        authStack: authStack,
                        apiStack: apiStack,
                        dbStack: dbStack
                    });
                }
            }
        }

        return combinations;

    } catch (error) {
        throw new Error(`Failed to fetch CloudFormation stacks: ${error.message}`);
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
            throw new Error(`Stack not found: ${stackName}`);
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
        throw new Error(`Failed to get outputs from ${stackName}: ${error.message}`);
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
            throw new Error('UserPoolClient not found');
        }

        const client = response.UserPoolClient;

        return {
            clientSecret: client.ClientSecret,
            clientName: client.ClientName,
            callbackUrls: client.CallbackURLs || [],
            logoutUrls: client.LogoutURLs || []
        };

    } catch (error) {
        throw new Error(`Failed to get Cognito details: ${error.message}`);
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
        throw new Error(`Failed to find user by email: ${error.message}`);
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
        throw new Error(`Failed to list users: ${error.message}`);
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