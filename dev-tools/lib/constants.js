/**
 * 一元管理された定数定義
 * SSMパラメータ名、環境設定値などを管理
 */

module.exports = {
    // SSM Parameter Store のパラメータ名
    SSM_PARAMETERS: {
        CERTIFICATE_ARN: '/sankey/certificate-arn'
    },

    // 証明書関連の設定
    CERTIFICATE: {
        RENEWAL_THRESHOLD_DAYS: 90,  // 証明書更新の閾値（日数）
        VALIDITY_DAYS: 365,           // 新規証明書の有効期間
        HOSTNAMES: ['*.sankey.trade', 'sankey.trade']  // ワイルドカード証明書のホスト名
    },

    // 環境名のマッピング
    ENVIRONMENTS: {
        DEV: 'dev',
        PROD: 'prod',
        DEVELOPMENT: 'development',
        PRODUCTION: 'production'
    },

    // Vercel環境のマッピング
    VERCEL_ENVIRONMENTS: {
        PREVIEW: 'preview',
        PRODUCTION: 'production'
    },

    // カスタムドメインの設定
    CUSTOM_DOMAINS: {
        BASE_DOMAIN: 'sankey.trade',
        API_PREFIX: 'api',
        getApiDomain: (environment) => {
            return environment === 'prod' 
                ? `api.sankey.trade`
                : `api-${environment}.sankey.trade`;
        }
    },

    // アプリケーションURL
    APP_URLS: {
        DEV: 'https://dev.sankey.trade',
        PROD: 'https://www.sankey.trade',
        LOCAL: 'http://localhost:3000'
    },

    // AWSリージョン
    AWS_REGIONS: {
        DEFAULT: 'ap-northeast-1',
        TOKYO: 'ap-northeast-1',
        US_EAST_1: 'us-east-1'  // CloudFront証明書用
    },

    // タイムアウト設定（ミリ秒）
    TIMEOUTS: {
        API_GATEWAY_CUSTOM_DOMAIN: 5000,  // API Gateway削除待機時間
        DEPLOYMENT_STATUS_CHECK: 30000    // デプロイメントステータス確認
    },

    // ログレベル
    LOG_LEVELS: {
        DEBUG: 'debug',
        INFO: 'info',
        WARNING: 'warning',
        ERROR: 'error'
    },

    // ファイル名
    LOCAL_ENV_FILENAME: '.env.local',

    // エラータイプ
    ERROR_TYPES: {
        CDK_NOT_DEPLOYED: 'cdk-not-deployed'
    },

    // 承認モード
    APPROVAL_MODES: {
        NEVER: 'never',
        ALWAYS: 'always'
    },

    // テストデータ生成関連
    GENERATE_TEST_DATA: {
        DEFAULT_EMAIL: 'poruru.inv@gmail.com',
        DEFAULT_RECORD_COUNT: 5,
        DEFAULT_STATUS: 'Pending',
        STATUS_RANDOM: 'Random', // ステータスをランダムに選択する場合の値
        DYNAMODB_BATCH_SIZE: 25,
        MAX_RETRIES: 3,
        RETRY_DELAY_MS: 2000,
        DAYS_BACK_DEFAULT: 365, // getRandomDateTimeのデフォルト
        DAYS_BACK_APPLIED_AT: 180,
        DAYS_BACK_EXPIRED_APPROVED_AT: 365,
        DAYS_BACK_EXPIRED_EXPIRES_AT: 30,
        DAYS_BACK_REVOKED_APPROVED_AT: 180,
        DB_SK_PREFIXES: {
            APPLICATION: 'APPLICATION#'
        }
    },

    // サンプルデータ (generate-test-data.js より)
    SAMPLE_DATA: {
        EA_NAMES: [
            'Scalping Master EA', 'Trend Follower Pro', 'Grid Trading Bot',
            'News Trading EA', 'Arbitrage Hunter', 'Breakout Warrior',
            'Swing Master EA', 'Martingale Pro', 'Hedge Fund EA', 'Fibonacci Trader'
        ],
        BROKERS: [
            'XM Trading', 'FXGT', 'TitanFX', 'IC Markets', 'Exness',
            'AXIORY', 'BigBoss', 'HotForex', 'FBS', 'InstaForex'
        ],
        TWITTER_HANDLES: [
            '@TradingMaster_fx', '@FXExpert2025', '@EAProfessional',
            '@ScalpingKing', '@TrendHunter_fx', '@GridTrader_pro',
            '@NewsTrader_EA', '@ArbitrageBot', '@FXWizard2025', '@TradingGuru_jp'
        ],
        EMAIL_PREFIXES: ['test', 'demo', 'sample', 'user', 'trader', 'fx'],
        EMAIL_DOMAINS: ['example.com', 'test.com', 'demo.org']
    },

    // 重み付きステータス定義 (generate-test-data.js より)
    WEIGHTED_STATUSES: [
        { status: 'Pending', weight: 3 },
        { status: 'Active', weight: 2 },
        { status: 'Expired', weight: 1 },
        { status: 'Rejected', weight: 1 },
        { status: 'Revoked', weight: 1 }
    ],

    // CloudFormation Outputキー
    CLOUDFORMATION_OUTPUT_KEYS: {
        SANKEY_TABLE_NAME: 'SankeyTableName',
        USER_POOL_ID: 'UserPoolId',
        COGNITO_CLIENT_ID: 'UserPoolClientId', // UserPoolClientId は Cognito Client ID を指すことが多いため、より明確な名前に。実際のOutputKeyと合わせる。
        COGNITO_DOMAIN_URL: 'UserPoolDomainUrl', // UserPoolDomainUrl など実際のOutputKeyに合わせる
        API_ENDPOINT: 'ApiEndpoint',
        API_ID: 'ApiId'
        // 他にもあれば追加: e.g., API_GATEWAY_URL: 'ApiGatewayUrl', ...
    },

    COGNITO: {
        ISSUER_BASE_URL_TEMPLATE: 'https://cognito-idp.{region}.amazonaws.com/' // {region} と {userPoolId} は実行時に置換
    },

    // Vercel API関連
    VERCEL_API: {
        BASE_URL: 'https://api.vercel.com',
        ENDPOINTS: {
            GET_ENV_VARS: (projectId) => `/v9/projects/${projectId}/env`,
            CREATE_ENV_VAR: (projectId) => `/v10/projects/${projectId}/env`,
            UPDATE_ENV_VAR: (projectId, envId) => `/v9/projects/${projectId}/env/${envId}`,
            DELETE_ENV_VAR: (projectId, envId) => `/v9/projects/${projectId}/env/${envId}`
            // デプロイフックは環境変数で管理するためここには含めない
        },
        VAR_TYPE_ENCRYPTED: 'encrypted'
    },

    VERCEL_ENV_VAR_KEYS: {
        AUTH_SECRET: 'AUTH_SECRET'
        // 他のVercel環境変数キーも必要に応じて追加
    },

    // Cloudflare API関連
    CLOUDFLARE_API: {
        BASE_URL: 'https://api.cloudflare.com/client/v4',
        ENDPOINTS: {
            ZONES: '/zones',
            DNS_RECORDS: (zoneId) => `/zones/${zoneId}/dns_records`,
            CERTIFICATES: '/certificates'
            // GET /zones/:zone_identifier/custom_hostnames
            // POST /zones/:zone_identifier/custom_hostnames
            // GET /zones/:zone_identifier/custom_hostnames/:custom_hostname_id
            // PATCH /zones/:zone_identifier/custom_hostnames/:custom_hostname_id
            // DELETE /zones/:zone_identifier/custom_hostnames/:custom_hostname_id
        },
        USER_AGENT: 'Sankey-Setup-Script/1.0' // User-Agentの例
    },

    // DNS関連
    DNS_RECORD_TYPES: {
        CNAME: 'CNAME'
        // A: 'A', AAAA: 'AAAA', TXT: 'TXT', ...
    },
    DEFAULT_DNS_TTL: 1 // TTL=1 は 'automatic' を意味することが多い
};