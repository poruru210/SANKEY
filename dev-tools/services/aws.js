/**
 * AWS統合サービスモジュール
 * aws-helpers + aws-config-module + ssm-module + test-data-module を統合
 */

const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const { CognitoIdentityProviderClient, DescribeUserPoolClientCommand, ListUsersCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient, BatchWriteItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { SSMClient, PutParameterCommand, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { 
    log, 
    displayProgress, 
    displayUserList,
    selectStackCombination,
    selectUser,
    confirm,
    prompt,
    promptNumber,
    promptChoice,
    Timer
} = require('../core/utils');
const { 
    CLOUDFORMATION_OUTPUT_KEYS, 
    AWS_REGIONS, 
    COGNITO, 
    SSM_PARAMETERS,
    GENERATE_TEST_DATA,
    SAMPLE_DATA,
    WEIGHTED_STATUSES,
    APPROVAL_MODES
} = require('../core/constants');
const { ConfigurationError, ApiError, ResourceNotFoundError, CdkNotDeployedError } = require('../core/errors');

// ============================================================
// AWS クライアント管理
// ============================================================

/**
 * AWS クライアントの初期化
 */
function createAwsClients(profile, region) {
    const config = {
        profile: profile
    };

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
 * SSMクライアントの作成
 */
function createSSMClient(profile, region) {
    const config = {
        profile: profile
    };

    if (region) {
        config.region = region;
    }

    try {
        return new SSMClient(config);
    } catch (error) {
        throw new Error(`Failed to initialize SSM client: ${error.message}`);
    }
}

// ============================================================
// CloudFormation スタック管理
// ============================================================

/**
 * Sankeyスタック検索関数
 */
async function findSankeyStacks(cloudFormationClient, options) {
    try {
        const command = new DescribeStacksCommand({});
        const response = await cloudFormationClient.send(command);

        // Sankeyスタックのパターンマッチング
        const authStackPattern = /^Sankey(Dev|Prod)AuthStack$/;
        const apiStackPattern = /^Sankey(Dev|Prod)ApiStack$/;
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

// ============================================================
// AWS設定取得 (旧 aws-config-module.js)
// ============================================================

/**
 * AWS設定を取得
 */
async function getAwsConfiguration(options) {
    try {
        log.debug('Initializing AWS clients...', options);
        
        const clients = createAwsClients(options.profile, options.region);
        log.debug('AWS clients initialized successfully', options);

        // スタック検索
        log.debug('Searching for Sankey stacks...', options);
        let stackCombinations = await findSankeyStacks(clients.cloudFormation, options);

        if (stackCombinations.length === 0) {
            throw new CdkNotDeployedError(['Sankey Stacks'], options.environment, new Error('findSankeyStacks returned no combinations.'));
        }

        log.debug(`Found ${stackCombinations.length} stack combination(s)`, options);

        // 環境指定がある場合はフィルタリング
        if (options.environment) {
            stackCombinations = stackCombinations.filter(combo => 
                combo.environment === options.environment.toLowerCase()
            );
            
            if (stackCombinations.length === 0) {
                throw new CdkNotDeployedError([`Sankey Stacks for ${options.environment}`], options.environment, new Error(`No stack combinations found matching environment: ${options.environment}`));
            }
        }

        // スタック選択
        const selectedCombination = stackCombinations.length === 1 && options.environment ?
            stackCombinations[0] :
            await selectStackCombination(stackCombinations, options);

        log.debug(`Selected stack combination: ${selectedCombination.environment}`, options);

        // 設定取得
        const config = await retrieveStackConfigurations(clients, selectedCombination, options);
        
        // 環境情報を追加
        config.environment = selectedCombination.environment;
        config.stackCombination = selectedCombination;

        return config;

    } catch (error) {
        if (error instanceof CdkNotDeployedError || error instanceof ConfigurationError) {
            throw error;
        }
        throw new ConfigurationError(`Failed to get AWS configuration: ${error.message}`, error);
    }
}

/**
 * スタックから設定値を取得
 */
async function retrieveStackConfigurations(clients, stackCombination, options) {
    try {
        log.debug('Retrieving configuration from stacks...', options);

        // AuthStackからの設定取得
        const authOutputKeys = [
            CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID,
            CLOUDFORMATION_OUTPUT_KEYS.COGNITO_CLIENT_ID,
            CLOUDFORMATION_OUTPUT_KEYS.COGNITO_DOMAIN_URL
        ];
        const authOutputs = await getStackOutputs(
            clients.cloudFormation,
            stackCombination.authStack.StackName,
            authOutputKeys,
            options
        );

        // APIStackからの設定取得
        const apiOutputKeys = [
            CLOUDFORMATION_OUTPUT_KEYS.API_ENDPOINT,
            CLOUDFORMATION_OUTPUT_KEYS.API_ID,
            CLOUDFORMATION_OUTPUT_KEYS.CUSTOM_DOMAIN_NAME,
            CLOUDFORMATION_OUTPUT_KEYS.CUSTOM_DOMAIN_TARGET
        ];
        const apiOutputs = await getStackOutputs(
            clients.cloudFormation,
            stackCombination.apiStack.StackName,
            apiOutputKeys,
            options
        );

        // 必須の設定値チェック
        const requiredAuthKeys = [CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID, CLOUDFORMATION_OUTPUT_KEYS.COGNITO_CLIENT_ID];
        const missingAuthKeys = requiredAuthKeys.filter(key => !authOutputs[key]);
        if (missingAuthKeys.length > 0) {
            throw new CdkNotDeployedError(missingAuthKeys.map(k => `AuthStack Output: ${k}`), stackCombination.environment, new Error(`Missing required outputs from ${stackCombination.authStack.StackName}`));
        }

        if (!apiOutputs[CLOUDFORMATION_OUTPUT_KEYS.API_ENDPOINT]) {
            throw new CdkNotDeployedError([`APIStack Output: ${CLOUDFORMATION_OUTPUT_KEYS.API_ENDPOINT}`], stackCombination.environment, new Error(`Missing required output ${CLOUDFORMATION_OUTPUT_KEYS.API_ENDPOINT} from ${stackCombination.apiStack.StackName}`));
        }

        // Cognito詳細取得
        log.debug('Retrieving Cognito client details...', options);
        const cognitoDetails = await getCognitoDetails(
            clients.cognito,
            authOutputs[CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID],
            authOutputs[CLOUDFORMATION_OUTPUT_KEYS.COGNITO_CLIENT_ID],
            options
        );

        if (!cognitoDetails.clientSecret) {
            throw new ConfigurationError(
                'Cognito Client Secret not found. Make sure the User Pool Client has a secret generated.',
                new Error(`Client ID: ${authOutputs[CLOUDFORMATION_OUTPUT_KEYS.COGNITO_CLIENT_ID]}`)
            );
        }

        // 設定値の組み立て
        const region = options.region || process.env.AWS_DEFAULT_REGION || AWS_REGIONS.DEFAULT;
        const cognitoIssuerBase = COGNITO.ISSUER_BASE_URL_TEMPLATE.replace('{region}', region);
        const cognitoIssuer = `${cognitoIssuerBase}${authOutputs[CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID]}`;
        
        // API エンドポイントの決定
        let apiEndpoint;
        if (apiOutputs[CLOUDFORMATION_OUTPUT_KEYS.CUSTOM_DOMAIN_NAME]) {
            apiEndpoint = `https://${apiOutputs[CLOUDFORMATION_OUTPUT_KEYS.CUSTOM_DOMAIN_NAME]}`;
            log.debug(`Using custom domain for API endpoint: ${apiEndpoint}`, options);
        } else {
            apiEndpoint = apiOutputs[CLOUDFORMATION_OUTPUT_KEYS.API_ENDPOINT].replace(/\/$/, '');
            log.debug(`Using CDK API endpoint: ${apiEndpoint}`, options);
        }

        const configValues = {
            // API Gateway設定
            NEXT_PUBLIC_API_ENDPOINT: apiEndpoint,
            ApiId: apiOutputs[CLOUDFORMATION_OUTPUT_KEYS.API_ID],

            // Cognito設定
            COGNITO_CLIENT_ID: authOutputs[CLOUDFORMATION_OUTPUT_KEYS.COGNITO_CLIENT_ID],
            COGNITO_CLIENT_SECRET: cognitoDetails.clientSecret,
            COGNITO_ISSUER: cognitoIssuer,
            
            // Cognito詳細情報
            userPoolId: authOutputs[CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID],
            region: region,

            // カスタムドメイン設定
            customDomainName: apiOutputs[CLOUDFORMATION_OUTPUT_KEYS.CUSTOM_DOMAIN_NAME],
            customDomainTarget: apiOutputs[CLOUDFORMATION_OUTPUT_KEYS.CUSTOM_DOMAIN_TARGET]
        };

        // Cognito Domain設定（オプション）
        if (authOutputs[CLOUDFORMATION_OUTPUT_KEYS.COGNITO_DOMAIN_URL]) {
            configValues.NEXT_PUBLIC_COGNITO_DOMAIN = authOutputs[CLOUDFORMATION_OUTPUT_KEYS.COGNITO_DOMAIN_URL];
            configValues.NEXT_PUBLIC_COGNITO_CLIENT_ID = authOutputs[CLOUDFORMATION_OUTPUT_KEYS.COGNITO_CLIENT_ID];
        }

        log.debug('Configuration values retrieved successfully', options);
        return configValues;

    } catch (error) {
        if (error instanceof CdkNotDeployedError || error instanceof ConfigurationError) {
            throw error;
        }
        throw new ConfigurationError(`Failed to retrieve stack configurations for ${stackCombination.environment}: ${error.message}`, error);
    }
}

// ============================================================
// Cognito 管理
// ============================================================

/**
 * Cognito詳細取得関数
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

// ============================================================
// SSM Parameter Store 管理 (旧 ssm-module.js)
// ============================================================

/**
 * パラメータの保存
 */
async function putParameter(ssmClient, parameterName, value, options = {}) {
    try {
        const { description, dryRun = false, overwrite = true } = options;

        if (dryRun) {
            log.info(`[DRY-RUN] Would save parameter: ${parameterName}`);
            return { 
                success: true, 
                dryRun: true,
                parameterName,
                action: 'dry-run'
            };
        }

        log.debug(`Saving parameter: ${parameterName}`, options);

        const command = new PutParameterCommand({
            Name: parameterName,
            Value: value,
            Type: 'String',
            Description: description || `Managed by Sankey setup script - ${new Date().toISOString()}`,
            Overwrite: overwrite,
            Tier: 'Standard'
        });

        const response = await ssmClient.send(command);

        log.success(`✅ Parameter saved: ${parameterName}`);
        log.debug(`Version: ${response.Version}`, options);

        return {
            success: true,
            parameterName,
            version: response.Version,
            action: response.Version > 1 ? 'updated' : 'created'
        };

    } catch (error) {
        if (error.name === 'ParameterAlreadyExists' && !options.overwrite) {
            log.warning(`Parameter already exists: ${parameterName}`);
            return {
                success: false,
                parameterName,
                error: 'already_exists',
                message: 'Use --force-update to overwrite'
            };
        }
        
        throw new Error(`Failed to save parameter: ${error.message}`);
    }
}

/**
 * パラメータの取得
 */
async function getParameter(ssmClient, parameterName, options = {}) {
    try {
        log.debug(`Retrieving parameter: ${parameterName}`, options);

        const command = new GetParameterCommand({
            Name: parameterName,
            WithDecryption: true
        });

        const response = await ssmClient.send(command);

        if (!response.Parameter) {
            return null;
        }

        const parameter = response.Parameter;
        log.debug(`Found parameter version ${parameter.Version}`, options);

        return {
            name: parameter.Name,
            value: parameter.Value,
            version: parameter.Version,
            lastModifiedDate: parameter.LastModifiedDate,
            description: parameter.Description
        };

    } catch (error) {
        if (error.name === 'ParameterNotFound') {
            log.debug(`Parameter not found: ${parameterName}`, options);
            return null;
        }
        
        throw new Error(`Failed to retrieve parameter: ${error.message}`);
    }
}

/**
 * 証明書ARNの保存（高レベルAPI）
 */
async function saveCertificateArn(config) {
    const { certificateArn, profile, region, dryRun = false, forceUpdate = false, debug = false } = config;

    try {
        const ssmClient = createSSMClient(profile, region);
        const parameterName = SSM_PARAMETERS.CERTIFICATE_ARN;

        const existingParam = await getParameter(ssmClient, parameterName, { debug });

        if (existingParam && !forceUpdate) {
            log.info(`Existing certificate ARN found: ${existingParam.value}`);
            log.info(`Last modified: ${existingParam.lastModifiedDate}`);
            
            if (existingParam.value === certificateArn) {
                log.success('Certificate ARN is already up to date');
                return {
                    success: true,
                    action: 'no-change',
                    parameterName,
                    certificateArn
                };
            } else {
                log.warning('Certificate ARN differs from stored value');
                log.info('Use --force-update to overwrite');
                return {
                    success: false,
                    action: 'differs',
                    parameterName,
                    storedArn: existingParam.value,
                    newArn: certificateArn
                };
            }
        }

        const result = await putParameter(
            ssmClient,
            parameterName,
            certificateArn,
            {
                description: `Wildcard certificate ARN for *.sankey.trade`,
                dryRun,
                overwrite: true
            }
        );

        return result;

    } catch (error) {
        throw new Error(`Failed to save certificate ARN: ${error.message}`);
    }
}

/**
 * 証明書ARNの取得（高レベルAPI）
 */
async function getCertificateArn(config) {
    const { profile, region, debug = false } = config;

    try {
        const ssmClient = createSSMClient(profile, region);
        const parameterName = SSM_PARAMETERS.CERTIFICATE_ARN;

        const param = await getParameter(ssmClient, parameterName, { debug });

        if (!param) {
            log.info('No certificate ARN found in SSM Parameter Store');
            return null;
        }

        log.info(`Found certificate ARN: ${param.value}`);
        log.debug(`Version: ${param.version}, Modified: ${param.lastModifiedDate}`, { debug });

        return param.value;

    } catch (error) {
        throw new Error(`Failed to retrieve certificate ARN: ${error.message}`);
    }
}

// ============================================================
// テストデータ生成 (旧 test-data-module.js)
// ============================================================

/**
 * テストデータ生成のメインワークフロー
 */
async function executeTestDataWorkflow(config) {
    const timer = new Timer();
    
    try {
        const { profile, region, environment, debug = false } = config;

        // AWS クライアントの初期化
        log.info('🔧 Initializing AWS clients...');
        const clients = createAwsClients(profile, region);
        log.success('AWS clients initialized successfully');

        // Step 1: スタック検索と選択
        log.info('🔍 Searching for Sankey stacks...');
        const stackCombinations = await findSankeyStacks(clients.cloudFormation, { debug });

        if (stackCombinations.length === 0) {
            throw new Error('No Sankey stacks found');
        }

        // 環境でフィルタリング
        const filteredCombinations = environment 
            ? stackCombinations.filter(combo => combo.environment === environment.toLowerCase())
            : stackCombinations;

        if (filteredCombinations.length === 0) {
            throw new Error(`No stacks found for environment: ${environment}`);
        }

        const selectedCombination = filteredCombinations.length === 1 
            ? filteredCombinations[0]
            : await selectStackCombination(filteredCombinations, { requireApproval: APPROVAL_MODES.ALWAYS });

        log.success(`Selected: ${selectedCombination.environment.toUpperCase()} Environment`);

        // Step 2: テーブル名取得
        log.info('🔍 Retrieving DynamoDB table name...');
        const dbOutputs = await getStackOutputs(
            clients.cloudFormation,
            selectedCombination.dbStack.StackName,
            [CLOUDFORMATION_OUTPUT_KEYS.SANKEY_TABLE_NAME],
            { debug }
        );

        if (!dbOutputs[CLOUDFORMATION_OUTPUT_KEYS.SANKEY_TABLE_NAME]) {
            throw new Error(`Required DB stack output not found (${CLOUDFORMATION_OUTPUT_KEYS.SANKEY_TABLE_NAME})`);
        }

        const tableName = dbOutputs[CLOUDFORMATION_OUTPUT_KEYS.SANKEY_TABLE_NAME];
        log.success(`Table Name: ${tableName}`);

        // Step 3: 操作選択
        const operation = await selectOperation();

        // Step 4: ユーザー選択
        const userInfo = await selectTestUser(clients, selectedCombination, { debug });

        // Step 5: 操作に応じた処理
        let result;
        switch (operation) {
            case 'generate':
                const generateOptions = await getGenerationOptions();
                result = await executeGeneration(clients.dynamo, tableName, userInfo.userId, generateOptions, { debug });
                break;
            
            case 'delete':
                const confirmed = await confirm('⚠️  Are you sure you want to delete ALL test data for this user?', false);
                if (!confirmed) {
                    log.info('Delete operation cancelled');
                    return { success: false, cancelled: true };
                }
                result = await executeDelete(clients.dynamo, tableName, userInfo.userId, { debug });
                break;
            
            case 'reset':
                const resetConfirmed = await confirm('⚠️  This will DELETE existing data and generate new data. Continue?', false);
                if (!resetConfirmed) {
                    log.info('Reset operation cancelled');
                    return { success: false, cancelled: true };
                }
                const resetOptions = await getGenerationOptions();
                result = await executeReset(clients.dynamo, tableName, userInfo.userId, resetOptions, { debug });
                break;
        }

        log.success(`🎉 ${operation} operation completed in ${timer.elapsedFormatted()}`);
        return result;

    } catch (error) {
        log.error(`Test data operation failed: ${error.message}`);
        throw error;
    }
}

/**
 * 操作選択
 */
async function selectOperation() {
    const operations = [
        { id: 'generate', label: 'Generate new test data', description: 'Add new dummy records to existing data' },
        { id: 'delete', label: 'Delete all test data', description: 'Remove all existing test data for selected user' },
        { id: 'reset', label: 'Reset (Delete + Generate)', description: 'Delete existing data and generate fresh test data' }
    ];

    return await promptChoice('Select operation:', operations.map(op => op.label), operations[0].label)
        .then(selected => {
            const selectedOp = operations.find(op => op.label === selected);
            log.info(`Selected operation: ${selectedOp.label}`);
            return selectedOp.id;
        });
}

/**
 * テストユーザー選択
 */
async function selectTestUser(clients, stackCombination, options = {}) {
    // UserPool ID取得
    log.info('🔍 Retrieving UserPool ID...');
    const authOutputs = await getStackOutputs(
        clients.cloudFormation,
        stackCombination.authStack.StackName,
        [CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID],
        options
    );

    if (!authOutputs[CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID]) {
        throw new Error(`Required Auth stack output not found (${CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID})`);
    }

    const userPoolId = authOutputs[CLOUDFORMATION_OUTPUT_KEYS.USER_POOL_ID];
    log.success(`UserPool ID: ${userPoolId}`);

    // ユーザー選択方法
    const selectionMethod = await promptChoice(
        'How would you like to specify the user?',
        ['Search by email address', 'Enter User ID directly', 'Select from user list'],
        'Search by email address'
    );

    switch (selectionMethod) {
        case 'Search by email address':
            const email = await prompt('Enter email address', GENERATE_TEST_DATA.DEFAULT_EMAIL);
            const user = await findUserByEmail(clients.cognito, userPoolId, email);
            if (!user) {
                log.error(`User not found with email: ${email}`);
                log.info('Available users:');
                const allUsers = await listAllUsers(clients.cognito, userPoolId);
                displayUserList(allUsers);
                throw new Error('User not found');
            }
            return user;

        case 'Enter User ID directly':
            const userId = await prompt('Enter User ID');
            if (!userId) throw new Error('User ID is required');
            return { userId, email: 'direct-input', userStatus: 'UNKNOWN' };

        case 'Select from user list':
            const allUsers = await listAllUsers(clients.cognito, userPoolId);
            if (allUsers.length === 0) {
                throw new Error('No users found in UserPool');
            }
            displayUserList(allUsers);
            return await selectUser(allUsers, { requireApproval: APPROVAL_MODES.ALWAYS });

        default:
            throw new Error('Invalid selection method');
    }
}

/**
 * 生成オプション取得
 */
async function getGenerationOptions() {
    const options = {};

    // レコード数
    options.count = await promptNumber(
        'Number of records to generate',
        GENERATE_TEST_DATA.DEFAULT_RECORD_COUNT,
        1,
        100
    );

    // ステータス選択
    const statusChoices = ['Pending', 'Active', 'Expired', 'Rejected', 'Revoked', 'Random'];
    options.status = await promptChoice(
        'Select status for test data',
        statusChoices,
        GENERATE_TEST_DATA.DEFAULT_STATUS
    );

    // メール設定
    const useRealEmail = await confirm('Use real email address in test data?', true);
    options.useRealEmail = useRealEmail;

    if (!useRealEmail) {
        const useDummyEmail = await confirm('Use specific dummy email address?', false);
        if (useDummyEmail) {
            options.dummyEmail = await prompt('Enter dummy email address');
        }
    }

    return options;
}

/**
 * データ生成実行
 */
async function executeGeneration(dynamoClient, tableName, userId, options, config = {}) {
    const items = generateDummyData(userId, options);
    const successCount = await batchWriteItems(dynamoClient, tableName, items, config);
    
    return {
        success: true,
        operation: 'generate',
        generated: successCount,
        total: items.length
    };
}

/**
 * データ削除実行
 */
async function executeDelete(dynamoClient, tableName, userId, config = {}) {
    const deletedCount = await deleteUserData(dynamoClient, tableName, userId, config);
    
    return {
        success: true,
        operation: 'delete',
        deleted: deletedCount
    };
}

/**
 * リセット実行
 */
async function executeReset(dynamoClient, tableName, userId, options, config = {}) {
    // 既存データ削除
    const deletedCount = await deleteUserData(dynamoClient, tableName, userId, config);
    log.success(`🗑️ Deleted ${deletedCount} existing items`);

    // 新データ生成
    const items = generateDummyData(userId, options);
    const successCount = await batchWriteItems(dynamoClient, tableName, items, config);

    return {
        success: true,
        operation: 'reset',
        deleted: deletedCount,
        generated: successCount,
        total: items.length
    };
}

/**
 * ユーザーの全データを削除
 */
async function deleteUserData(dynamoClient, tableName, userId, options) {
    const timer = new Timer();

    try {
        log.database(`🔍 Scanning existing data for user: ${userId}`);

        const queryCommand = new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: {
                ':uid': { S: userId }
            }
        });

        const queryResult = await dynamoClient.send(queryCommand);

        if (!queryResult.Items || queryResult.Items.length === 0) {
            log.info('No existing data found for this user');
            return 0;
        }

        const itemCount = queryResult.Items.length;
        log.warning(`Found ${itemCount} existing items for this user`);

        const deleteRequests = queryResult.Items.map(item => ({
            DeleteRequest: {
                Key: {
                    userId: item.userId,
                    sk: item.sk
                }
            }
        }));

        const batchSize = GENERATE_TEST_DATA.DYNAMODB_BATCH_SIZE;
        const totalBatches = Math.ceil(deleteRequests.length / batchSize);
        let deletedCount = 0;

        log.database(`🗑️ Deleting ${itemCount} items in ${totalBatches} batch(es)...`);

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const start = batchIndex * batchSize;
            const end = Math.min(start + batchSize, deleteRequests.length);
            const batchItems = deleteRequests.slice(start, end);

            if (totalBatches > 1) {
                log.progress(`Deleting batch ${batchIndex + 1}/${totalBatches} (${batchItems.length} items)...`);
            }

            const batchRequest = {
                RequestItems: {
                    [tableName]: batchItems
                }
            };

            try {
                const command = new BatchWriteItemCommand(batchRequest);
                const result = await dynamoClient.send(command);

                if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
                    log.warning(`Unprocessed items found in delete batch ${batchIndex + 1}`);

                    let retryCount = 0;
                    const maxRetries = GENERATE_TEST_DATA.MAX_RETRIES;
                    let unprocessed = result.UnprocessedItems;

                    while (Object.keys(unprocessed).length > 0 && retryCount < maxRetries) {
                        retryCount++;
                        log.progress(`  Retrying delete ${retryCount}/${maxRetries}...`);
                        await new Promise(resolve => setTimeout(resolve, GENERATE_TEST_DATA.RETRY_DELAY_MS * retryCount));

                        const retryCommand = new BatchWriteItemCommand({ RequestItems: unprocessed });
                        const retryResult = await dynamoClient.send(retryCommand);
                        unprocessed = retryResult.UnprocessedItems || {};
                    }

                    if (Object.keys(unprocessed).length === 0) {
                        deletedCount += batchItems.length;
                        if (totalBatches > 1) {
                            log.success(`  Delete batch ${batchIndex + 1} succeeded (after retry)`);
                        }
                    } else {
                        log.error(`  Some items in delete batch ${batchIndex + 1} could not be processed`);
                    }
                } else {
                    deletedCount += batchItems.length;
                    if (totalBatches > 1) {
                        log.success(`  Delete batch ${batchIndex + 1} succeeded`);
                    }
                }

            } catch (error) {
                log.error(`Delete batch ${batchIndex + 1} failed: ${error.message}`);
            }
        }

        log.info(`Deleted ${deletedCount}/${itemCount} items in ${timer.elapsedFormatted()}`);
        return deletedCount;

    } catch (error) {
        throw new Error(`Failed to delete user data: ${error.message}`);
    }
}

/**
 * ダミーデータ生成
 */
function generateDummyData(userId, options) {
    const timer = new Timer();
    const count = parseInt(options.count);
    const items = [];

    log.generate(`Generating ${count} dummy records...`);

    for (let i = 1; i <= count; i++) {
        const appliedAt = getRandomDateTime(GENERATE_TEST_DATA.DAYS_BACK_APPLIED_AT);
        const accountNumber = `100${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`;
        const eaName = SAMPLE_DATA.EA_NAMES[Math.floor(Math.random() * SAMPLE_DATA.EA_NAMES.length)];
        const broker = SAMPLE_DATA.BROKERS[Math.floor(Math.random() * SAMPLE_DATA.BROKERS.length)];
        const sk = `${GENERATE_TEST_DATA.DB_SK_PREFIXES.APPLICATION}${appliedAt}#${broker}#${accountNumber}#${eaName}`;

        let itemStatus;
        if (options.status !== GENERATE_TEST_DATA.STATUS_RANDOM) {
            itemStatus = options.status;
        } else {
            itemStatus = getWeightedRandomStatus();
        }

        const xAccount = SAMPLE_DATA.TWITTER_HANDLES[Math.floor(Math.random() * SAMPLE_DATA.TWITTER_HANDLES.length)];

        let emailToUse = '';
        if (options.useRealEmail) {
            emailToUse = options.email || GENERATE_TEST_DATA.DEFAULT_EMAIL;
        } else if (options.dummyEmail) {
            emailToUse = options.dummyEmail;
        } else {
            emailToUse = generateDummyEmail();
        }

        const item = {
            PutRequest: {
                Item: {
                    userId: { S: userId },
                    sk: { S: sk },
                    accountNumber: { S: accountNumber },
                    eaName: { S: eaName },
                    broker: { S: broker },
                    email: { S: emailToUse },
                    xAccount: { S: xAccount },
                    status: { S: itemStatus },
                    appliedAt: { S: appliedAt },
                    updatedAt: { S: new Date().toISOString() }
                }
            }
        };

        // ステータスに応じて追加フィールド
        switch (itemStatus) {
            case 'Active':
                const approvedAt = new Date(new Date(appliedAt).getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString();
                const expiresAt = new Date(Date.now() + (Math.random() * 335 + 30) * 24 * 60 * 60 * 1000).toISOString();
                const licenseKey = `SMP-2025-${Math.floor(Math.random() * 2147483647).toString(16).toUpperCase()}`;

                item.PutRequest.Item.approvedAt = { S: approvedAt };
                item.PutRequest.Item.expiresAt = { S: expiresAt };
                item.PutRequest.Item.licenseKey = { S: licenseKey };
                break;

            case 'Expired':
                const expiredApprovedAt = getRandomDateTime(GENERATE_TEST_DATA.DAYS_BACK_EXPIRED_APPROVED_AT);
                const expiredExpiresAt = getRandomDateTime(GENERATE_TEST_DATA.DAYS_BACK_EXPIRED_EXPIRES_AT);
                const expiredLicenseKey = `SMP-2024-${Math.floor(Math.random() * 2147483647).toString(16).toUpperCase()}`;

                item.PutRequest.Item.approvedAt = { S: expiredApprovedAt };
                item.PutRequest.Item.expiresAt = { S: expiredExpiresAt };
                item.PutRequest.Item.licenseKey = { S: expiredLicenseKey };
                break;

            case 'Revoked':
                const revokedApprovedAt = getRandomDateTime(GENERATE_TEST_DATA.DAYS_BACK_REVOKED_APPROVED_AT);
                const revokedAt = new Date(new Date(revokedApprovedAt).getTime() + (Math.random() * 83 + 7) * 24 * 60 * 60 * 1000).toISOString();
                const revokedLicenseKey = `SMP-2025-${Math.floor(Math.random() * 2147483647).toString(16).toUpperCase()}`;

                item.PutRequest.Item.approvedAt = { S: revokedApprovedAt };
                item.PutRequest.Item.revokedAt = { S: revokedAt };
                item.PutRequest.Item.licenseKey = { S: revokedLicenseKey };
                break;
        }

        items.push(item);

        if (i % Math.max(1, Math.floor(count / 10)) === 0 || i === count) {
            displayProgress(i, count, '  Progress');
        }
    }

    log.info(`Generated ${count} dummy records in ${timer.elapsedFormatted()}`);
    return items;
}

/**
 * DynamoDBバッチ書き込み
 */
async function batchWriteItems(dynamoClient, tableName, items, options) {
    const timer = new Timer();
    const batchSize = GENERATE_TEST_DATA.DYNAMODB_BATCH_SIZE;
    const totalBatches = Math.ceil(items.length / batchSize);
    let successCount = 0;

    log.database(`Writing ${items.length} items to DynamoDB in ${totalBatches} batch(es)...`);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const start = batchIndex * batchSize;
        const end = Math.min(start + batchSize, items.length);
        const batchItems = items.slice(start, end);

        if (totalBatches > 1) {
            log.progress(`Processing batch ${batchIndex + 1}/${totalBatches} (${batchItems.length} items)...`);
        }

        const batchRequest = {
            RequestItems: {
                [tableName]: batchItems
            }
        };

        try {
            const command = new BatchWriteItemCommand(batchRequest);
            const result = await dynamoClient.send(command);

            if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
                log.warning(`Unprocessed items found in batch ${batchIndex + 1}`);

                let retryCount = 0;
                const maxRetries = GENERATE_TEST_DATA.MAX_RETRIES;
                let unprocessed = result.UnprocessedItems;

                while (Object.keys(unprocessed).length > 0 && retryCount < maxRetries) {
                    retryCount++;
                    log.progress(`  Retrying ${retryCount}/${maxRetries}...`);
                    await new Promise(resolve => setTimeout(resolve, GENERATE_TEST_DATA.RETRY_DELAY_MS * retryCount));

                    const retryCommand = new BatchWriteItemCommand({ RequestItems: unprocessed });
                    const retryResult = await dynamoClient.send(retryCommand);
                    unprocessed = retryResult.UnprocessedItems || {};
                }

                if (Object.keys(unprocessed).length === 0) {
                    successCount += batchItems.length;
                    if (totalBatches > 1) {
                        log.success(`  Batch ${batchIndex + 1} succeeded (after retry)`);
                    }
                } else {
                    log.error(`  Some items in batch ${batchIndex + 1} could not be processed`);
                }
            } else {
                successCount += batchItems.length;
                if (totalBatches > 1) {
                    log.success(`  Batch ${batchIndex + 1} succeeded`);
                }
            }

        } catch (error) {
            log.error(`Batch ${batchIndex + 1} failed: ${error.message}`);
        }
    }

    log.info(`Batch write completed: ${successCount}/${items.length} items succeeded in ${timer.elapsedFormatted()}`);
    return successCount;
}

/**
 * ヘルパー関数群
 */

function getRandomDateTime(daysBack = GENERATE_TEST_DATA.DAYS_BACK_DEFAULT) {
    const now = new Date();
    const start = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));
    const randomTime = start.getTime() + Math.random() * (now.getTime() - start.getTime());
    return new Date(randomTime).toISOString();
}

function getWeightedRandomStatus() {
    const totalWeight = WEIGHTED_STATUSES.reduce((sum, item) => sum + item.weight, 0);
    const random = Math.random() * totalWeight;
    let currentWeight = 0;

    for (const statusItem of WEIGHTED_STATUSES) {
        currentWeight += statusItem.weight;
        if (random < currentWeight) {
            return statusItem.status;
        }
    }
    return WEIGHTED_STATUSES[0].status;
}

function generateDummyEmail() {
    const prefix = SAMPLE_DATA.EMAIL_PREFIXES[Math.floor(Math.random() * SAMPLE_DATA.EMAIL_PREFIXES.length)];
    const domain = SAMPLE_DATA.EMAIL_DOMAINS[Math.floor(Math.random() * SAMPLE_DATA.EMAIL_DOMAINS.length)];
    const number = Math.floor(Math.random() * 999) + 1;
    return `${prefix}${number}@${domain}`;
}

// エクスポート
module.exports = {
    // AWS クライアント管理
    createAwsClients,
    
    // CloudFormation 管理
    findSankeyStacks,
    getStackOutputs,
    
    // AWS設定取得
    getAwsConfiguration,
    
    // Cognito 管理
    getCognitoDetails,
    findUserByEmail,
    listAllUsers,
    
    // SSM Parameter Store
    saveCertificateArn,
    getCertificateArn,
    
    // テストデータ生成
    executeTestDataWorkflow
};