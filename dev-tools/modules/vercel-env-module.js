const { VercelClient, mapEnvironmentToVercel, generateVercelEnvironmentVariables } = require('../lib/vercel-helpers');
const { log } = require('../lib/logger');
const { VERCEL_ENVIRONMENTS, VERCEL_ENV_VAR_KEYS } = require('../lib/constants');

/**
 * Vercel環境変数設定モジュール
 * vercel-helpers.js を使用した環境変数自動設定
 */

/**
 * Vercel環境変数を更新
 * @param {Object} config - Configuration object
 * @returns {Object} Update results
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
            authSecret: authSecret // 共通のAUTH_SECRETがある場合
        });

        log.debug(`Generated ${Object.keys(vercelVars).length} environment variables`, { debug });

        // 設定内容の表示
        displayVercelConfigSummary(vercelVars, targetVercelEnv);

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
            { forceUpdate }
        );

        // 結果サマリーの表示
        displayUpdateResults(updateResults, targetVercelEnv);

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
 * Vercel設定内容の表示
 * @param {Object} vercelVars - Vercel environment variables
 * @param {string} environment - Target environment
 */
function displayVercelConfigSummary(vercelVars, environment) {
    log.info(`🔧 Vercel Environment Variables (${environment}):`);
    
    for (const [key, value] of Object.entries(vercelVars)) {
        if (key.includes('SECRET') || key.includes('COGNITO_CLIENT_SECRET')) {
            console.log(`   ${key}: ${value.substring(0, 8)}...`);
        } else {
            console.log(`   ${key}: ${value}`);
        }
    }
    console.log('');
}

/**
 * 更新結果の表示
 * @param {Object} results - Update results
 * @param {string} environment - Target environment
 */
function displayUpdateResults(results, environment) {
    const { created, updated, unchanged, errors } = results;

    log.info(`📊 Update Results for ${environment}:`);
    
    if (created.length > 0) {
        console.log(`   ✅ Created: ${created.length} variables`);
        created.forEach(item => console.log(`      - ${item.key}`));
    }

    if (updated.length > 0) {
        console.log(`   🔄 Updated: ${updated.length} variables`);
        updated.forEach(item => console.log(`      - ${item.key}`));
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
}

/**
 * 更新サマリーの生成
 * @param {Object} results - Update results
 * @returns {string} Summary text
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
 * Vercel環境変数の検証
 * @param {Object} vercelVars - Vercel environment variables
 * @returns {Object} Validation result
 */
function validateVercelEnvironmentVariables(vercelVars) {
    const requiredKeys = [
        'NEXT_PUBLIC_API_ENDPOINT',
        'COGNITO_CLIENT_ID',
        'COGNITO_CLIENT_SECRET',
        'COGNITO_ISSUER',
        'AUTH_SECRET',
        'NEXTAUTH_URL',
        'NEXT_PUBLIC_APP_URL'
    ];

    const missing = requiredKeys.filter(key => !vercelVars[key]);
    const present = requiredKeys.filter(key => vercelVars[key]);

    return {
        valid: missing.length === 0,
        missingKeys: missing,
        presentKeys: present,
        totalKeys: Object.keys(vercelVars).length
    };
}

/**
 * 共通AUTH_SECRETの取得（複数環境で共通値を使用する場合）
 * @param {string} apiToken - Vercel API token
 * @param {string} projectId - Vercel project ID
 * @returns {string|null} Existing AUTH_SECRET or null
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

/**
 * 環境変数の差分確認（冪等性チェック用）
 * @param {Object} config - Configuration
 * @returns {Object} Difference analysis
 */
async function analyzeEnvironmentVariablesDiff(config) {
    try {
        const { awsConfig, environment, vercelEnvironment, apiToken, projectId } = config;
        
        const targetVercelEnv = vercelEnvironment || mapEnvironmentToVercel(environment);
        const vercelClient = new VercelClient(apiToken, projectId);
        
        // 現在のVercel環境変数を取得
        const existingVars = await vercelClient.getEnvironmentVariables(targetVercelEnv);
        
        // 新しい環境変数を生成
        const newVars = generateVercelEnvironmentVariables(awsConfig, environment);
        
        const analysis = {
            environment: targetVercelEnv,
            existing: existingVars.length,
            new: Object.keys(newVars).length,
            changes: []
        };

        // 変更点の分析
        for (const [key, newValue] of Object.entries(newVars)) {
            const existingVar = existingVars.find(v => v.key === key);
            
            if (!existingVar) {
                analysis.changes.push({ key, action: 'create', reason: 'new variable' });
            } else {
                // 暗号化されているため値の比較は困難
                analysis.changes.push({ key, action: 'exists', reason: 'already exists' });
            }
        }

        return analysis;
    } catch (error) {
        throw new Error(`Failed to analyze environment variables diff: ${error.message}`);
    }
}

module.exports = {
    updateVercelEnvironmentVariables,
    validateVercelEnvironmentVariables,
    getExistingAuthSecret,
    analyzeEnvironmentVariablesDiff,
    displayVercelConfigSummary,
    displayUpdateResults
};