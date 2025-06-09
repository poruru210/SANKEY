const { createAwsClients, findSankeyStacks, getStackOutputs, getCognitoDetails } = require('../lib/aws-helpers');
const { log } = require('../lib/logger');
const { selectStackCombination } = require('../lib/cli-helpers');
const { CLOUDFORMATION_OUTPUT_KEYS, AWS_REGIONS, COGNITO, ENVIRONMENTS } = require('../lib/constants');
const { ConfigurationError, CdkNotDeployedError, ResourceNotFoundError } = require('../lib/errors');

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
 * @param {Object} clients - AWS clients
 * @param {Object} stackCombination - Selected stack combination
 * @param {Object} options - Options
 * @returns {Object} Configuration values
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
            CLOUDFORMATION_OUTPUT_KEYS.API_ID
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
        
        // API エンドポイントの正規化（末尾スラッシュ削除）
        const apiEndpoint = apiOutputs[CLOUDFORMATION_OUTPUT_KEYS.API_ENDPOINT].replace(/\/$/, '');

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
            region: region
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
        throw new ConfigurationError(`Missing required AWS configuration fields: ${missing.join(', ')}`);
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