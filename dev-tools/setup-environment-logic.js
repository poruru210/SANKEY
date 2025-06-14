import { log } from './core/utils.js';
import { ENVIRONMENTS } from './core/constants.js';
import {
    readAuthSecretFromEnvLocal,
    getExistingAuthSecret,
    generateAuthSecret
} from './services/vercel.js';

// Functions will be added here
export async function getOrCreateAuthSecret(environment, envFilePath, vercelConfig) {
    let authSecret = null;

    // 1. .env.localから取得を試行 (environment が 'dev' の場合のみ考慮)
    if (environment === ENVIRONMENTS.DEV) {
        authSecret = await readAuthSecretFromEnvLocal(envFilePath);
        if (authSecret) {
            log.debug('AUTH_SECRET found in .env.local', { debug: true });
            return authSecret;
        }
    }

    // 2. Vercelから取得を試行
    if (vercelConfig && vercelConfig.apiToken && vercelConfig.projectId) {
        try {
            authSecret = await getExistingAuthSecret(
                vercelConfig.apiToken,
                vercelConfig.projectId
            );
            if (authSecret) {
                log.debug('AUTH_SECRET found in Vercel environment variables', { debug: true });
                return authSecret;
            }
        } catch (error) {
            log.debug(`Failed to get AUTH_SECRET from Vercel: ${error.message}`, { debug: true });
        }
    }

    // 3. 新規生成
    const newSecret = generateAuthSecret();
    log.info('Generated new AUTH_SECRET');
    return newSecret;
}

export function validateEnvironmentVariables() {
    const warnings = [];

    // 証明書準備に必要な環境変数
    if (!process.env.CLOUDFLARE_API_TOKEN) {
        warnings.push('CLOUDFLARE_API_TOKEN - Required for certificate preparation');
    }
    if (!process.env.CLOUDFLARE_ZONE_ID) {
        warnings.push('CLOUDFLARE_ZONE_ID - Required for certificate preparation');
    }

    // Vercel関連
    if (!process.env.VERCEL_TOKEN) {
        warnings.push('VERCEL_TOKEN - Required for Vercel operations');
    }
    if (!process.env.VERCEL_PROJECT_ID) {
        warnings.push('VERCEL_PROJECT_ID - Required for Vercel operations');
    }
    if (!process.env.VERCEL_DEPLOY_HOOK_DEV) {
        warnings.push('VERCEL_DEPLOY_HOOK_DEV - Required for dev deployment');
    }
    if (!process.env.VERCEL_DEPLOY_HOOK_PROD) {
        warnings.push('VERCEL_DEPLOY_HOOK_PROD - Required for prod deployment');
    }

    if (warnings.length > 0) {
        log.warning('Missing environment variables:');
        warnings.forEach(warning => console.log(`   ⚠️  ${warning}`));
        console.log('\n   Please set these in your .env file to enable all features.\n');
    }

    return warnings;
}
