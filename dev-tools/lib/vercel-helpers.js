const crypto = require('crypto');
const { log } = require('./logger');

/**
 * Vercel API ヘルパー関数群
 * 環境変数管理とデプロイ機能
 */

/**
 * Vercel API クライアント
 */
class VercelClient {
    constructor(apiToken, projectId) {
        this.apiToken = apiToken;
        this.projectId = projectId;
        this.baseUrl = 'https://api.vercel.com';
    }

    /**
     * API リクエストを実行
     */
    async makeRequest(method, endpoint, body = null) {
        const url = `${this.baseUrl}${endpoint}`;
        
        const options = {
            method,
            headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json'
            }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Vercel API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
        }

        return response.json();
    }

    /**
     * 環境変数を取得
     */
    async getEnvironmentVariables(environment = 'preview') {
        const response = await this.makeRequest('GET', `/v9/projects/${this.projectId}/env`);
        
        return response.envs.filter(env => {
            return env.target.includes(environment);
        });
    }

    /**
     * 環境変数を作成
     */
    async createEnvironmentVariable(key, value, environment = 'preview') {
        const target = Array.isArray(environment) ? environment : [environment];
        
        return await this.makeRequest('POST', `/v10/projects/${this.projectId}/env`, {
            key,
            value,
            target,
            type: 'encrypted'
        });
    }

    /**
     * 環境変数を更新
     */
    async updateEnvironmentVariable(envId, key, value, environment = 'preview') {
        const target = Array.isArray(environment) ? environment : [environment];
        
        return await this.makeRequest('PATCH', `/v9/projects/${this.projectId}/env/${envId}`, {
            key,
            value,
            target,
            type: 'encrypted'
        });
    }

    /**
     * 環境変数を削除
     */
    async deleteEnvironmentVariable(envId) {
        return await this.makeRequest('DELETE', `/v9/projects/${this.projectId}/env/${envId}`);
    }

    /**
     * 環境変数を一括更新
     */
    async updateEnvironmentVariables(variables, environment = 'preview', options = {}) {
        const { forceUpdate = false } = options;
        
        const results = {
            created: [],
            updated: [],
            unchanged: [],
            errors: []
        };

        // 既存の環境変数を取得
        const existingVars = await this.getEnvironmentVariables(environment);

        for (const [key, value] of Object.entries(variables)) {
            try {
                const existingVar = existingVars.find(v => v.key === key);

                if (!existingVar) {
                    // 新規作成
                    await this.createEnvironmentVariable(key, value, environment);
                    results.created.push({ key, action: 'created' });
                    log.success(`✅ Created: ${key}`);
                } else if (forceUpdate) {
                    // 強制更新
                    await this.updateEnvironmentVariable(existingVar.id, key, value, environment);
                    results.updated.push({ key, action: 'updated' });
                    log.success(`✅ Updated: ${key}`);
                } else {
                    // スキップ
                    results.unchanged.push({ key, reason: 'exists' });
                    log.info(`ℹ️ Skipped (exists): ${key}`);
                }
            } catch (error) {
                results.errors.push({ key, error: error.message });
                log.error(`❌ Error updating ${key}: ${error.message}`);
            }
        }

        return results;
    }
}

/**
 * Vercelデプロイを実行（Deploy Hook使用）
 * @param {string} environment - 'production' または 'preview'
 * @param {Object} options - オプション（例: debugフラグ）
 * @returns {Object} Deployment result
 */
async function triggerDeployment(environment, options = {}) {
    try {
        const { debug = false } = options;

        const env = mapEnvironmentToVercel(environment);  // dev, prod対応
        log.info(`🚀 Triggering deployment for ${env} environment via Deploy Hook...`);

        const deployHookUrl = env === 'production' 
            ? process.env.VERCEL_DEPLOY_HOOK_PROD
            : process.env.VERCEL_DEPLOY_HOOK_DEV;

        if (!deployHookUrl) {
            throw new Error(`Deploy Hook URL not found for environment: ${env}. Please set VERCEL_DEPLOY_HOOK_${env.toUpperCase()}`);
        }

        log.debug(`Deploy Hook URL: ${deployHookUrl}`, { debug });

        const response = await fetch(deployHookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            const errorData = await response.text().catch(() => 'Unknown error');
            throw new Error(`Deploy Hook failed: ${response.status} - ${errorData}`);
        }

        const result = await response.json().catch(() => ({}));

        log.success(`✅ Deployment triggered successfully via Deploy Hook`);

        if (result.job) {
            log.info(`📋 Deployment Job: ${result.job.id || 'Started'}`);
        }

        const baseUrl = env === 'production'
            ? 'https://www.sankey.trade'
            : 'https://dev.sankey.trade';

        log.info(`🔗 Site URL: ${baseUrl}`);
        log.info('⏳ Deployment is in progress. Check Vercel dashboard for status.');

        return {
            success: true,
            url: baseUrl,
            target: env,
            method: 'deploy-hook',
            jobId: result.job?.id
        };
    } catch (error) {
        log.error(`❌ Failed to trigger deployment: ${error.message}`);
        throw new Error(`Failed to trigger deployment: ${error.message}`);
    }
}


/**
 * 環境名をVercel環境にマッピング
 */
function mapEnvironmentToVercel(environment) {
    const mapping = {
        'dev': 'preview',
        'development': 'preview',
        'prod': 'production',
        'production': 'production'
    };

    return mapping[environment.toLowerCase()] || 'preview';
}

/**
 * Vercel環境変数を生成
 */
function generateVercelEnvironmentVariables(awsConfig, environment, options = {}) {
    const { authSecret } = options;
    
    // カスタムドメインのAPI_ENDPOINTを生成
    const apiEndpoint = environment === 'prod' ? 
        'https://api.sankey.trade' : 
        `https://api-${environment}.sankey.trade`;
    
    // 基本的な環境変数
    const vercelVars = {
        // API設定（カスタムドメイン使用）
        NEXT_PUBLIC_API_ENDPOINT: apiEndpoint,
        
        // Cognito設定
        COGNITO_CLIENT_ID: awsConfig.COGNITO_CLIENT_ID,
        COGNITO_CLIENT_SECRET: awsConfig.COGNITO_CLIENT_SECRET,
        COGNITO_ISSUER: awsConfig.COGNITO_ISSUER,
        
        // Auth.js設定
        AUTH_SECRET: authSecret || generateAuthSecret(),
        NEXTAUTH_URL: generateNextAuthUrl(environment),
        
        // アプリケーション設定
        NEXT_PUBLIC_APP_URL: generateNextAuthUrl(environment)
    };

    // Cognito Domain設定（オプション）
    if (awsConfig.NEXT_PUBLIC_COGNITO_DOMAIN) {
        vercelVars.NEXT_PUBLIC_COGNITO_DOMAIN = awsConfig.NEXT_PUBLIC_COGNITO_DOMAIN;
        vercelVars.NEXT_PUBLIC_COGNITO_CLIENT_ID = awsConfig.COGNITO_CLIENT_ID;
    }

    return vercelVars;
}

/**
 * AUTH_SECRETを生成
 */
function generateAuthSecret() {
    return crypto.randomBytes(32).toString('base64');
}

/**
 * 環境別NEXTAUTH_URLを生成
 */
function generateNextAuthUrl(environment) {
    const urls = {
        dev: 'https://dev.sankey.trade',
        development: 'https://dev.sankey.trade',
        prod: 'https://www.sankey.trade',
        production: 'https://www.sankey.trade'
    };

    return urls[environment.toLowerCase()] || 'https://dev.sankey.trade';
}

module.exports = {
    VercelClient,
    triggerDeployment,
    mapEnvironmentToVercel,
    generateVercelEnvironmentVariables,
    generateAuthSecret,
    generateNextAuthUrl
};