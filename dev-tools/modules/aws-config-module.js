const { createAwsClients, findSankeyStacks, getStackOutputs, getCognitoDetails } = require('../lib/aws-helpers');
const { log } = require('../lib/logger');
const { selectStackCombination } = require('../lib/cli-helpers');

/**
 * AWS設定取得モジュール
 * update-env.js の設定取得ロジックを抽出・モジュール化
 */

/**
 * AWS設定を取得
 * @param {Object} options - Configuration options
 * @returns {Object} AWS configuration object
 */
async function getAwsConfiguration(options) {
    try {
        log.debug('Initializing AWS clients...', options);
        
        // AWS クライアントの初期化
        const clients = createAwsClients(options.profile, options.region);
        log.debug('AWS clients initialized successfully', options);

        // スタック検索
        log.debug('Searching for Sankey stacks...', options);
        let stackCombinations = await findSankeyStacks(clients.cloudFormation, options);

        if (stackCombinations.length === 0) {
            throw new Error('No Sankey stacks found. Please check stack naming convention and AWS region/profile settings');
        }

        log.debug(`Found ${stackCombinations.length} stack combination(s)`, options);

        // 環境指定がある場合はフィルタリング
        if (options.environment) {
            stackCombinations = stackCombinations.filter(combo => 
                combo.environment === options.environment.toLowerCase()
            );
            
            if (stackCombinations.length === 0) {
                throw new Error(`No stacks found for environment: ${options.environment}`);
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
        throw new Error(`Failed to get AWS configuration: ${error.message}`);
    }
}

/**
 * スタックから設定値を取得
 * @param {Object} clients - AWS clients
 * @param {Object} stackCombination - Selected stack combination
 * @param {Object} options - Options
 * @returns {Object} Configuration values
 */
async function retrieveStackConfigurations(clients, stackCombination, options) {
    try {
        log.debug('Retrieving configuration from stacks...', options);

        // AuthStackからの設定取得
        const authOutputs = await getStackOutputs(
            clients.cloudFormation,
            stackCombination.authStack.StackName,
            ['UserPoolId', 'UserPoolClientId', 'UserPoolDomainUrl'],
            options
        );

        // APIStackからの設定取得
        const apiOutputs = await getStackOutputs(
            clients.cloudFormation,
            stackCombination.apiStack.StackName,
            ['ApiEndpoint', 'ApiId'],
            options
        );

        // 必須の設定値チェック
        if (!authOutputs.UserPoolId || !authOutputs.UserPoolClientId) {
            throw new Error('Required Auth stack outputs not found (UserPoolId, UserPoolClientId)');
        }

        if (!apiOutputs.ApiEndpoint) {
            throw new Error('Required API stack output not found (ApiEndpoint)');
        }

        // Cognito詳細取得
        log.debug('Retrieving Cognito client details...', options);
        const cognitoDetails = await getCognitoDetails(
            clients.cognito,
            authOutputs.UserPoolId,
            authOutputs.UserPoolClientId,
            options
        );

        if (!cognitoDetails.clientSecret) {
            throw new Error('Cognito Client Secret not found. Make sure the User Pool Client has a secret generated.');
        }

        // 設定値の組み立て
        const region = options.region || process.env.AWS_DEFAULT_REGION || 'ap-northeast-1';
        const cognitoIssuer = `https://cognito-idp.${region}.amazonaws.com/${authOutputs.UserPoolId}`;
        
        // API エンドポイントの正規化（末尾スラッシュ削除）
        const apiEndpoint = apiOutputs.ApiEndpoint.replace(/\/$/, '');

        const configValues = {
            // API Gateway設定
            NEXT_PUBLIC_API_ENDPOINT: apiEndpoint,
            ApiId: apiOutputs.ApiId,

            // Cognito設定
            COGNITO_CLIENT_ID: authOutputs.UserPoolClientId,
            COGNITO_CLIENT_SECRET: cognitoDetails.clientSecret,
            COGNITO_ISSUER: cognitoIssuer,
            
            // Cognito詳細情報
            userPoolId: authOutputs.UserPoolId,
            region: region
        };

        // Cognito Domain設定（オプション）
        if (authOutputs.UserPoolDomainUrl) {
            configValues.NEXT_PUBLIC_COGNITO_DOMAIN = authOutputs.UserPoolDomainUrl;
            configValues.NEXT_PUBLIC_COGNITO_CLIENT_ID = authOutputs.UserPoolClientId;
        }

        log.debug('Configuration values retrieved successfully', options);
        return configValues;

    } catch (error) {
        throw new Error(`Failed to retrieve stack configurations: ${error.message}`);
    }
}

/**
 * 設定値の検証
 * @param {Object} config - Configuration to validate
 * @returns {boolean} Validation result
 */
function validateAwsConfiguration(config) {
    const requiredFields = [
        'NEXT_PUBLIC_API_ENDPOINT',
        'COGNITO_CLIENT_ID',
        'COGNITO_CLIENT_SECRET',
        'COGNITO_ISSUER',
        'environment'
    ];

    const missing = requiredFields.filter(field => !config[field]);
    
    if (missing.length > 0) {
        throw new Error(`Missing required configuration fields: ${missing.join(', ')}`);
    }

    return true;
}

/**
 * 設定値のマスク表示（ログ用）
 * @param {Object} config - Configuration object
 * @returns {Object} Masked configuration for safe logging
 */
function maskSensitiveConfig(config) {
    const masked = { ...config };
    
    if (masked.COGNITO_CLIENT_SECRET) {
        masked.COGNITO_CLIENT_SECRET = masked.COGNITO_CLIENT_SECRET.substring(0, 8) + '...';
    }
    
    return masked;
}

module.exports = {
    getAwsConfiguration,
    retrieveStackConfigurations,
    validateAwsConfiguration,
    maskSensitiveConfig
};