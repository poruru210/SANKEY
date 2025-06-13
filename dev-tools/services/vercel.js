/**
 * Vercel統合サービスモジュール  
 * vercel-helpers + vercel-env-module + env-local-module を統合
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const { log } = require('../core/utils');
const { 
    CUSTOM_DOMAINS, 
    APP_URLS, 
    ENVIRONMENTS, 
    VERCEL_ENVIRONMENTS, 
    VERCEL_API,
    VERCEL_ENV_VAR_KEYS 
} = require('../core/constants');
const { ConfigurationError, ApiError } = require('../core/errors');

// ============================================================
// Vercel API Client (旧 vercel-helpers.js)
// ============================================================

/**
 * Vercel API クライアント
 */
class VercelClient {
    constructor(apiToken, projectId) {
        this.apiToken = apiToken;
        this.projectId = projectId;
        this.baseUrl = VERCEL_API.BASE_URL;
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

        try {
            const response = await fetch(url, options);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
                throw new ApiError(
                    `Vercel API request failed: ${errorData.error?.message || response.statusText}`,
                    'Vercel',
                    response.status
                );
            }
            return response.json();
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw new ApiError(`Vercel API request failed: ${error.message}`, 'Vercel', null, error);
        }
    }

    /**
     * 環境変数を取得
     */
    async getEnvironmentVariables(environment = VERCEL_ENVIRONMENTS.PREVIEW) {
        const response = await this.makeRequest('GET', VERCEL_API.ENDPOINTS.GET_ENV_VARS(this.projectId));
        
        return response.envs.filter(env => {
            return env.target.includes(environment);
        });
    }

    /**
     * 環境変数を作成
     */
    async createEnvironmentVariable(key, value, environment = VERCEL_ENVIRONMENTS.PREVIEW) {
        const target = Array.isArray(environment) ? environment : [environment];
        
        return await this.makeRequest('POST', VERCEL_API.ENDPOINTS.CREATE_ENV_VAR(this.projectId), {
            key,
            value,
            target,
            type: VERCEL_API.VAR_TYPE_ENCRYPTED
        });
    }

    /**
     * 環境変数を更新
     */
    async updateEnvironmentVariable(envId, key, value, environment = VERCEL_ENVIRONMENTS.PREVIEW) {
        const target = Array.isArray(environment) ? environment : [environment];
        
        return await this.makeRequest('PATCH', VERCEL_API.ENDPOINTS.UPDATE_ENV_VAR(this.projectId, envId), {
            key,
            value,
            target,
            type: VERCEL_API.VAR_TYPE_ENCRYPTED
        });
    }

    /**
     * 環境変数を削除
     */
    async deleteEnvironmentVariable(envId) {
        return await this.makeRequest('DELETE', VERCEL_API.ENDPOINTS.DELETE_ENV_VAR(this.projectId, envId));
    }

    /**
     * 環境変数を一括更新
     */
    async updateEnvironmentVariables(variables, environment = VERCEL_ENVIRONMENTS.PREVIEW, options = {}) {
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

// ============================================================
// Vercel デプロイメント
// ============================================================

/**
 * Vercelデプロイを実行（Deploy Hook使用）
 */
async function triggerDeployment(environment, options = {}) {
    try {
        const { debug = false } = options;

        const env = mapEnvironmentToVercel(environment);
        log.info(`🚀 Triggering deployment for ${env} environment via Deploy Hook...`);

        const deployHookUrl = env === VERCEL_ENVIRONMENTS.PRODUCTION
            ? process.env.VERCEL_DEPLOY_HOOK_PROD
            : process.env.VERCEL_DEPLOY_HOOK_DEV;

        if (!deployHookUrl) {
            throw new ConfigurationError(`Deploy Hook URL not found for environment: ${env}. Please set VERCEL_DEPLOY_HOOK_${env.toUpperCase()}`);
        }

        log.debug(`Deploy Hook URL: ${deployHookUrl}`, { debug });

        const response = await fetch(deployHookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            const errorData = await response.text().catch(() => `Status: ${response.status}`);
            throw new ApiError(`Vercel Deploy Hook failed: ${errorData}`, 'Vercel Deploy Hook', response.status);
        }

        const result = await response.json().catch((jsonError) => {
            log.warning(`Failed to parse JSON response from Deploy Hook: ${jsonError.message}`);
            return {};
        });

        log.success(`✅ Deployment triggered successfully via Deploy Hook`);

        if (result.job) {
            log.info(`📋 Deployment Job: ${result.job.id || 'Started'}`);
        }

        const baseUrl = env === VERCEL_ENVIRONMENTS.PRODUCTION
            ? APP_URLS.PROD
            : APP_URLS.DEV;

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
        if (error instanceof ConfigurationError || error instanceof ApiError) {
            log.error(`❌ ${error.message}`);
            throw error;
        }
        log.error(`❌ Failed to trigger deployment: ${error.message}`);
        throw new ApiError(`Failed to trigger deployment: ${error.message}`, 'Vercel Deploy Hook', null, error);
    }
}

/**
 * 環境名をVercel環境にマッピング
 */
function mapEnvironmentToVercel(environment) {
    const mapping = {
        [ENVIRONMENTS.DEV]: VERCEL_ENVIRONMENTS.PREVIEW,
        [ENVIRONMENTS.DEVELOPMENT]: VERCEL_ENVIRONMENTS.PREVIEW,
        [ENVIRONMENTS.PROD]: VERCEL_ENVIRONMENTS.PRODUCTION,
        [ENVIRONMENTS.PRODUCTION]: VERCEL_ENVIRONMENTS.PRODUCTION
    };

    return mapping[environment.toLowerCase()] || VERCEL_ENVIRONMENTS.PREVIEW;
}

/**
 * AUTH_SECRETを生成
 */
function generateAuthSecret() {
    return crypto.randomBytes(32).toString('base64');
}

// ============================================================
// Vercel 環境変数管理 (旧 vercel-env-module.js)
// ============================================================

/**
 * Vercel環境変数を生成
 */
function generateVercelEnvironmentVariables(awsConfig, environment, options = {}) {
    const { authSecret } = options;
    
    // カスタムドメインのAPI_ENDPOINTを生成
    const apiEndpoint = `https://${CUSTOM_DOMAINS.getApiDomain(environment)}`;
    
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
        NEXTAUTH_URL: environment === ENVIRONMENTS.PROD ? APP_URLS.PROD : APP_URLS.DEV,
        
        // アプリケーション設定
        NEXT_PUBLIC_APP_URL: environment === ENVIRONMENTS.PROD ? APP_URLS.PROD : APP_URLS.DEV
    };

    // Cognito Domain設定（オプション）
    if (awsConfig.NEXT_PUBLIC_COGNITO_DOMAIN) {
        vercelVars.NEXT_PUBLIC_COGNITO_DOMAIN = awsConfig.NEXT_PUBLIC_COGNITO_DOMAIN;
        vercelVars.NEXT_PUBLIC_COGNITO_CLIENT_ID = awsConfig.COGNITO_CLIENT_ID;
    }

    return vercelVars;
}

/**
 * Vercel環境変数を更新
 */
async function updateVercelEnvironmentVariables(config) {
    try {
        const {
            awsConfig,
            environment,
            vercelEnvironment,
            apiToken,
            projectId,
            authSecret,
            forceUpdate = false,
            dryRun = false,
            debug = false
        } = config;

        log.debug('Starting Vercel environment variables update...', { debug });

        // 入力検証
        if (!apiToken) {
            throw new Error('Vercel API token is required');
        }

        if (!projectId) {
            throw new Error('Vercel project ID is required');
        }

        // Vercel環境の決定
        const targetVercelEnv = vercelEnvironment || mapEnvironmentToVercel(environment);
        log.debug(`Target Vercel environment: ${targetVercelEnv}`, { debug });

        // Vercelクライアント初期化
        const vercelClient = new VercelClient(apiToken, projectId);

        // Vercel環境変数を生成
        const vercelVars = generateVercelEnvironmentVariables(awsConfig, environment, {
            authSecret: authSecret
        });

        log.debug(`Generated ${Object.keys(vercelVars).length} environment variables`, { debug });

        // 設定内容の表示
        log.info(`🔧 Vercel Environment Variables (${targetVercelEnv}):`);
        
        for (const [key, value] of Object.entries(vercelVars)) {
            if (key.includes('SECRET') || key.includes('COGNITO_CLIENT_SECRET')) {
                console.log(`   ${key}: ${value.substring(0, 8)}...`);
            } else {
                console.log(`   ${key}: ${value}`);
            }
        }
        console.log('');

        if (dryRun) {
            log.warning('🧪 DRY-RUN MODE: Vercel variables would be updated but no changes made');
            return {
                dryRun: true,
                environment: targetVercelEnv,
                variables: Object.keys(vercelVars),
                summary: 'No changes made (dry-run mode)'
            };
        }

        // 環境変数を更新
        const updateResults = await vercelClient.updateEnvironmentVariables(
            vercelVars,
            targetVercelEnv,
            { forceUpdate: true }
        );

        // 結果サマリーの表示
        const { created, updated, unchanged, errors } = updateResults;

        log.info(`📊 Update Results for ${targetVercelEnv}:`);
        
        if (created.length > 0) {
            console.log(`   ✅ Created: ${created.length} variables`);
            created.forEach(item => {
                const value = vercelVars[item.key];
                const displayValue = formatValueForDisplay(item.key, value);
                console.log(`      - ${item.key}: ${displayValue}`);
            });
        }

        if (updated.length > 0) {
            console.log(`   🔄 Updated: ${updated.length} variables`);
            updated.forEach(item => {
                const value = vercelVars[item.key];
                const displayValue = formatValueForDisplay(item.key, value);
                console.log(`      - ${item.key}: ${displayValue}`);
            });
        }

        if (unchanged.length > 0) {
            console.log(`   ℹ️  Unchanged: ${unchanged.length} variables`);
            unchanged.forEach(item => console.log(`      - ${item.key} (${item.reason})`));
        }

        if (errors.length > 0) {
            console.log(`   ❌ Errors: ${errors.length} variables`);
            errors.forEach(item => console.log(`      - ${item.key}: ${item.error}`));
        }

        console.log('');

        return {
            success: true,
            environment: targetVercelEnv,
            results: updateResults,
            summary: generateUpdateSummary(updateResults)
        };

    } catch (error) {
        throw new Error(`Failed to update Vercel environment variables: ${error.message}`);
    }
}

/**
 * 表示用に値をフォーマット（センシティブ情報をマスク）
 */
function formatValueForDisplay(key, value) {
    if (!value) return '(not set)';
    
    // センシティブ情報はマスク表示
    if (key.includes('SECRET') || key.includes('COGNITO_CLIENT_SECRET')) {
        return `${value.substring(0, 8)}...`;
    }
    
    return value;
}

/**
 * 更新サマリーの生成
 */
function generateUpdateSummary(results) {
    const { created, updated, unchanged, errors } = results;
    const total = created.length + updated.length + unchanged.length + errors.length;
    
    const parts = [];
    if (created.length > 0) parts.push(`${created.length} created`);
    if (updated.length > 0) parts.push(`${updated.length} updated`);
    if (unchanged.length > 0) parts.push(`${unchanged.length} unchanged`);
    if (errors.length > 0) parts.push(`${errors.length} errors`);

    return `${total} variables processed: ${parts.join(', ')}`;
}

/**
 * 共通AUTH_SECRETの取得
 */
async function getExistingAuthSecret(apiToken, projectId) {
    try {
        const vercelClient = new VercelClient(apiToken, projectId);
        
        // production環境からAUTH_SECRETを取得（共通値として使用）
        const existingVars = await vercelClient.getEnvironmentVariables(VERCEL_ENVIRONMENTS.PRODUCTION);
        const authSecretVar = existingVars.find(v => v.key === VERCEL_ENV_VAR_KEYS.AUTH_SECRET);
        
        if (authSecretVar) {
            log.debug('Found existing AUTH_SECRET in production environment');
            return authSecretVar.value;
        }

        // preview環境も確認
        const previewVars = await vercelClient.getEnvironmentVariables(VERCEL_ENVIRONMENTS.PREVIEW);
        const previewAuthSecret = previewVars.find(v => v.key === VERCEL_ENV_VAR_KEYS.AUTH_SECRET);
        
        if (previewAuthSecret) {
            log.debug('Found existing AUTH_SECRET in preview environment');
            return previewAuthSecret.value;
        }

        return null;
    } catch (error) {
        log.warning(`Failed to retrieve existing AUTH_SECRET: ${error.message}`);
        return null;
    }
}

// ============================================================
// .env.local 生成 (旧 env-local-module.js)
// ============================================================

/**
 * .env.local生成処理
 */
async function updateLocalEnv(config) {
    try {
        const { awsConfig, authSecret, envFilePath, debug = false } = config;

        // authSecretをawsConfigに追加
        awsConfig.authSecret = authSecret;

        log.debug(`Updating env file: ${envFilePath}`, { debug });

        let envContent = [];

        // 既存ファイルの読み込み
        try {
            const existingContent = await fs.readFile(envFilePath, 'utf8');
            envContent = existingContent.split('\n');
            log.debug(`Read existing file with ${envContent.length} lines`, { debug });
        } catch (error) {
            if (error.code === 'ENOENT') {
                log.info('Creating new .env.local file...');
                envContent = [];
            } else {
                throw error;
            }
        }

        // 既存のAUTH_SECRETを保持するために、まず抽出
        let existingAuthSecret = null;
        const authSecretLine = envContent.find(line => line.trim().startsWith('AUTH_SECRET='));
        if (authSecretLine) {
            const match = authSecretLine.match(/^AUTH_SECRET=(.+)$/);
            if (match) {
                existingAuthSecret = match[1].replace(/['"]/g, '');
                log.debug('Preserving existing AUTH_SECRET', { debug });
            }
        }

        // AUTH_SECRETを使用（既存の値を優先）
        const finalAuthSecret = existingAuthSecret || authSecret;

        // 関連する既存設定を削除
        const keysToRemove = [
            'NEXT_PUBLIC_API_ENDPOINT',
            'COGNITO_CLIENT_ID',
            'COGNITO_CLIENT_SECRET',
            'COGNITO_ISSUER',
            'NEXT_PUBLIC_COGNITO_DOMAIN',
            'NEXT_PUBLIC_COGNITO_CLIENT_ID',
            'NEXT_PUBLIC_APP_URL',
            'NEXTAUTH_URL'
        ];

        // AUTH_SECRETも一時的に削除（後で正しい位置に配置するため）
        const keysToRemoveIncludingAuthSecret = [...keysToRemove, 'AUTH_SECRET'];

        const filteredContent = envContent.filter(line => {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('#') && (
                trimmedLine.includes('API Endpoint') ||
                trimmedLine.includes('Cognito') ||
                trimmedLine.includes('Auth.js')
            )) {
                return false; // コメント行も削除
            }
            return !keysToRemoveIncludingAuthSecret.some(key => trimmedLine.startsWith(`${key}=`));
        });

        // 連続する空行を1つにまとめる
        let cleanedContent = [];
        let lastWasEmpty = false;

        for (const line of filteredContent) {
            if (line.trim() === '') {
                if (!lastWasEmpty) {
                    cleanedContent.push(line);
                    lastWasEmpty = true;
                }
            } else {
                cleanedContent.push(line);
                lastWasEmpty = false;
            }
        }

        // AUTH_SECRETとNEXTAUTH_URLセクションを追加
        if (!cleanedContent.some(line => line.includes('# Auth.js設定'))) {
            if (cleanedContent.length > 0 && cleanedContent[cleanedContent.length - 1].trim() !== '') {
                cleanedContent.push('');
            }
            cleanedContent.push('# Auth.js設定');
        }
        
        // AUTH_SECRET追加（既存の値を優先）
        cleanedContent.push(`AUTH_SECRET="${finalAuthSecret}"`);
        cleanedContent.push(`NEXTAUTH_URL=${APP_URLS.LOCAL}`);
    
        // 新しい設定を追加
        const newSettings = [
            '',
            '# API Endpoint設定',
            `NEXT_PUBLIC_API_ENDPOINT=https://${CUSTOM_DOMAINS.getApiDomain(ENVIRONMENTS.DEV)}`,
            '',
            '# Cognito設定',
            `COGNITO_CLIENT_ID=${awsConfig.COGNITO_CLIENT_ID}`,
            `COGNITO_CLIENT_SECRET=${awsConfig.COGNITO_CLIENT_SECRET}`,
            `COGNITO_ISSUER=${awsConfig.COGNITO_ISSUER}`
        ];

        // Cognito Domain設定（存在する場合のみ）
        if (awsConfig.NEXT_PUBLIC_COGNITO_DOMAIN) {
            newSettings.push(
                '',
                '# Cognito Logout設定',
                `NEXT_PUBLIC_COGNITO_DOMAIN=${awsConfig.NEXT_PUBLIC_COGNITO_DOMAIN}`,
                `NEXT_PUBLIC_COGNITO_CLIENT_ID=${awsConfig.COGNITO_CLIENT_ID}`,
                `NEXT_PUBLIC_APP_URL=${APP_URLS.LOCAL}`
            );
        }

        // 最終的なコンテンツを結合
        const finalContent = cleanedContent.concat(newSettings);

        // 末尾の余分な空行を削除
        while (finalContent.length > 0 && finalContent[finalContent.length - 1].trim() === '') {
            finalContent.pop();
        }

        // ファイルに書き込み
        await fs.writeFile(envFilePath, finalContent.join('\n') + '\n', 'utf8');
        log.success(`✅ Updated .env.local file: ${envFilePath}`);

        return finalContent;

    } catch (error) {
        throw new Error(`Failed to update env file: ${error.message}`);
    }
}

/**
 * .env.localからAUTH_SECRETを読み取り
 */
async function readAuthSecretFromEnvLocal(envFilePath) {
    try {
        const envContent = await fs.readFile(envFilePath, 'utf8');
        const authSecretMatch = envContent.match(/^AUTH_SECRET=["']?(.+?)["']?$/m);
        if (authSecretMatch) {
            log.debug('Found AUTH_SECRET in .env.local', { debug: true });
            // Remove potential quotes around the secret
            const secret = authSecretMatch[1].replace(/["']$/g, '');
            return secret;
        }
        return null;
    } catch (error) {
        if (error.code === 'ENOENT') {
            log.debug(`File not found: ${envFilePath}`, { debug: true });
        } else {
            log.error(`Error reading ${envFilePath}: ${error.message}`);
        }
        return null;
    }
}

// エクスポート
module.exports = {
    // Vercel API クライアント
    VercelClient,
    
    // デプロイメント
    triggerDeployment,
    mapEnvironmentToVercel,
    
    // 環境変数管理
    generateVercelEnvironmentVariables,
    updateVercelEnvironmentVariables,
    getExistingAuthSecret,
    
    // ユーティリティ
    generateAuthSecret,
    
    // .env.local 管理
    updateLocalEnv,
    readAuthSecretFromEnvLocal
};