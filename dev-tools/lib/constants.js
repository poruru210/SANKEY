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
    }
};