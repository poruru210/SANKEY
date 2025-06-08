#!/usr/bin/env node

require('dotenv').config();
const { Command } = require('commander');
const path = require('path');
const crypto = require('crypto');

// 共通ライブラリ
const { log, displayTitle } = require('./lib/logger');
const { validateOptions, Timer } = require('./lib/cli-helpers');

// 機能別モジュール
const { getAwsConfiguration } = require('./modules/aws-config-module');
const { setupCustomDomain } = require('./modules/custom-domain-module');
const { updateLocalEnv } = require('./modules/env-local-module');
const { updateVercelEnvironmentVariables, getExistingAuthSecret } = require('./modules/vercel-env-module');
const { triggerDeployment } = require('./lib/vercel-helpers');

// コマンドライン引数の設定
const program = new Command();

program
    .name('setup-environment')
    .description('Complete environment setup: AWS + Custom Domain + .env.local + Vercel')
    .version('1.0.0')
    .requiredOption('-p, --profile <profile>', 'AWS SSO profile name')
    .option('-e, --environment <env>', 'Environment to setup (dev/prod)')
    .option('-r, --region <region>', 'AWS region (defaults to profile default)')
    .option('--vercel-env <env>', 'Vercel environment (preview/production)', 'auto')
    .option('--env-file <file>', 'Environment file path', '.env.local')
    .option('--skip-custom-domain', 'Skip custom domain setup')
    .option('--skip-env-local', 'Skip .env.local generation')
    .option('--skip-vercel', 'Skip Vercel environment variables')
    .option('--skip-deploy', 'Skip Vercel deployment (even with --force-update)')
    .option('--force-update', 'Force update existing configurations')
    .option('--dry-run', 'Show what would be done without making changes')
    .option('--require-approval <type>', 'Require approval for changes', 'always')
    .option('--debug', 'Enable debug output');

/**
 * AUTH_SECRETを取得または新規作成
 * @param {string} environment - 環境 (dev/prod)
 * @param {string} envFilePath - .env.localファイルパス
 * @param {Object} vercelConfig - Vercel設定 {apiToken, projectId}
 * @returns {string} AUTH_SECRET
 */
async function getOrCreateAuthSecret(environment, envFilePath, vercelConfig) {
    
    // 1. .env.localから取得を試行（dev環境のみ）
    if (environment === 'dev') {
        try {
            const fs = require('fs').promises;
            const envContent = await fs.readFile(envFilePath, 'utf8');
            const authSecretMatch = envContent.match(/^AUTH_SECRET=(.+)$/m);
            if (authSecretMatch) {
                log.debug('Found existing AUTH_SECRET in .env.local', { debug: true });
                return authSecretMatch[1].replace(/['"]/g, ''); // クォート除去
            }
        } catch (error) {
            log.debug('No existing .env.local file found', { debug: true });
        }
    }

    // 2. Vercelから取得を試行
    if (vercelConfig.apiToken && vercelConfig.projectId) {
        try {
            const existingSecret = await getExistingAuthSecret(
                vercelConfig.apiToken, 
                vercelConfig.projectId
            );
            if (existingSecret) {
                log.debug('Found existing AUTH_SECRET in Vercel', { debug: true });
                return existingSecret;
            }
        } catch (error) {
            log.debug(`Failed to get AUTH_SECRET from Vercel: ${error.message}`, { debug: true });
        }
    }

    // 3. 新規生成
    const newSecret = crypto.randomBytes(32).toString('base64');
    log.info('Generated new AUTH_SECRET');
    return newSecret;
}

/**
 * 環境変数の検証
 */
function validateEnvironmentVariables(options) {
    const required = [];

    // Vercelが有効でDeploy Hookが有効な場合
    if (!options.skipVercel) {
        const deployHookProd = process.env.VERCEL_DEPLOY_HOOK_PROD;
        const deployHookDev = process.env.VERCEL_DEPLOY_HOOK_DEV;
        
        if (!deployHookDev) {
            required.push('VERCEL_DEPLOY_HOOK_DEV');
        }
        if (!deployHookProd) {
            required.push('VERCEL_DEPLOY_HOOK_PROD');
        }
    }

    // Custom Domainが有効な場合の必須環境変数
    if (!options.skipCustomDomain) {
        if (!process.env.CLOUDFLARE_API_TOKEN) {
            required.push('CLOUDFLARE_API_TOKEN');
        }
        if (!process.env.CLOUDFLARE_ZONE_ID) {
            required.push('CLOUDFLARE_ZONE_ID');
        }
    }

    if (required.length > 0) {
        log.error(`Missing required environment variables: ${required.join(', ')}`);
        log.warning('Please set these variables in your .env file or environment');
        process.exit(1);
    }
}

/**
 * Vercel環境の自動決定
 */
function determineVercelEnvironment(environment, vercelEnvOption) {
    if (vercelEnvOption !== 'auto') {
        return vercelEnvOption;
    }

    const mapping = {
        'dev': 'preview',
        'prod': 'production'
    };

    return mapping[environment] || 'preview';
}

/**
 * 設定サマリーの表示
 */
function displayConfigurationSummary(options, vercelEnv) {
    log.info('📋 Configuration Summary:');
    console.log(`   AWS Profile: ${options.profile}`);
    console.log(`   AWS Region: ${options.region || 'profile default'}`);
    console.log(`   Environment: ${options.environment}`);
    console.log(`   Vercel Environment: ${vercelEnv}`);
    console.log(`   Environment File: ${options.envFile}`);
    console.log('');
    console.log('📝 Operations to perform:');
    console.log(`   ✅ AWS Configuration Retrieval`);
    console.log(`   ${options.skipCustomDomain ? '⏭️' : '✅'} Custom Domain Setup`);
    console.log(`   ${options.environment !== 'dev' ? '⏭️' : options.skipEnvLocal ? '⏭️' : '✅'} .env.local Generation`);
    console.log(`   ${options.skipVercel ? '⏭️' : '✅'} Vercel Environment Variables`);
    console.log(`   ${options.skipDeploy || !options.forceUpdate ? '⏭️' : '✅'} Vercel Deployment`);
    
    if (options.dryRun) {
        console.log('');
        log.warning('🧪 DRY-RUN MODE: No changes will be made');
    }
}

/**
 * メイン処理
 */
async function main() {
    const timer = new Timer();

    try {
        // コマンドライン引数をパース
        program.parse();
        const options = program.opts();

        // 引数検証
        validateOptions(options, ['profile']);

        // 環境変数検証
        validateEnvironmentVariables(options);

        // Vercel環境の決定
        const vercelEnv = determineVercelEnvironment(options.environment, options.vercelEnv);

        // タイトル表示
        displayTitle('Sankey Environment Setup - Complete Automation');

        // 設定サマリー表示
        displayConfigurationSummary(options, vercelEnv);

        // Step 1: AWS設定取得
        log.info('🔍 Step 1: Retrieving AWS Configuration...');
        const awsConfig = await getAwsConfiguration({
            profile: options.profile,
            environment: options.environment,
            region: options.region,
            debug: options.debug,
            requireApproval: options.requireApproval
        });

        if (!awsConfig) {
            throw new Error('Failed to retrieve AWS configuration');
        }

        log.success('✅ AWS configuration retrieved successfully');
        log.debug(`AWS Config: ${JSON.stringify(awsConfig, null, 2)}`, options);

        // AUTH_SECRET取得
        const envFilePath = path.resolve(process.cwd(), options.envFile);
        const authSecret = await getOrCreateAuthSecret(
            options.environment,
            envFilePath,
            { 
                apiToken: process.env.VERCEL_TOKEN, 
                projectId: process.env.VERCEL_PROJECT_ID 
            }
        );

        // Step 2: Custom Domain設定
        if (!options.skipCustomDomain) {
            log.info('🚪 Step 2: Setting up Custom Domain...');
            await setupCustomDomain({
                awsConfig,
                environment: options.environment,
                profile: options.profile,
                region: options.region,
                dryRun: options.dryRun,
                forceRenew: options.forceUpdate,
                debug: options.debug
            });
            log.success('✅ Custom domain setup completed');
        } else {
            log.info('⏭️ Step 2: Skipping Custom Domain setup');
        }

        // Step 3: .env.local生成（dev環境のみ）
        if (options.environment === 'dev' && !options.skipEnvLocal) {
            log.info('📝 Step 3: Generating .env.local file...');
            await updateLocalEnv({
                awsConfig,
                authSecret,
                envFilePath,
                debug: options.debug
            });
            log.success('✅ .env.local file updated');
        } else {
            log.info('⏭️ Step 3: Skipping .env.local (not dev environment)');
        }

        // Step 4: Vercel環境変数設定
        let vercelUpdated = false;
        if (!options.skipVercel) {
            log.info('🔧 Step 4: Setting up Vercel Environment Variables...');
            const vercelResults = await updateVercelEnvironmentVariables({
                awsConfig,
                environment: options.environment,
                vercelEnvironment: vercelEnv,
                apiToken: process.env.VERCEL_TOKEN,
                projectId: process.env.VERCEL_PROJECT_ID,
                authSecret,
                forceUpdate: options.forceUpdate,
                dryRun: options.dryRun,
                debug: options.debug
            });
            
            // 環境変数が更新された場合はデプロイが必要
            vercelUpdated = vercelResults.results && 
                (vercelResults.results.created.length > 0 || vercelResults.results.updated.length > 0);
            
            log.success('✅ Vercel environment variables updated');
        } else {
            log.info('⏭️ Step 4: Skipping Vercel environment variables');
        }

        // Step 5: Vercel デプロイ（--force-update時のみ）
        if (!options.skipVercel && !options.skipDeploy && options.forceUpdate && vercelUpdated && !options.dryRun) {
            log.info('🚀 Step 5: Triggering Vercel Deployment...');
            try {
                const deployResult = await triggerDeployment(
                    vercelEnv,
                    {
                        debug: options.debug
                    }
                );
                log.success('✅ Vercel deployment triggered successfully');
                if (deployResult.url) {
                    log.info(`🔗 Deployment URL: ${deployResult.url}`);
                }
            } catch (error) {
                log.warning(`⚠️ Deployment failed: ${error.message}`);
                log.info('You may need to deploy manually from Vercel dashboard or check Vercel CLI installation');
            }
        } else if (options.forceUpdate && vercelUpdated) {
            if (options.skipDeploy) {
                log.info('⏭️ Step 5: Skipping Vercel deployment (--skip-deploy)');
            } else if (options.dryRun) {
                log.info('⏭️ Step 5: Skipping Vercel deployment (dry-run mode)');
            } else {
                log.info('⏭️ Step 5: Skipping Vercel deployment (no --force-update)');
            }
            log.warning('💡 Environment variables were updated. Consider deploying manually.');
        } else {
            log.info('⏭️ Step 5: No deployment needed (no environment variable changes)');
        }

        // 完了報告
        console.log('');
        log.complete('🎉 Environment setup completed successfully!');
        
        console.log('\n📋 Summary:');
        console.log(`   Environment: ${options.environment.toUpperCase()}`);
        console.log(`   AWS Profile: ${options.profile}`);
        console.log(`   Vercel Environment: ${vercelEnv}`);
        
        if (options.environment === 'dev' && !options.skipEnvLocal) {
            console.log(`   Environment File: ${options.envFile}`);
        }

        console.log('\n🚀 Next Steps:');
        if (options.environment === 'dev' && !options.skipEnvLocal) {
            console.log('   1. Restart your Next.js application: npm run dev');
        }
        console.log('   2. Test your API endpoints');
        console.log('   3. Verify authentication flow');
        if (!vercelUpdated || options.skipDeploy) {
            console.log('   4. Deploy your frontend: git push');
        }

        timer.log('🎯 Total setup time');

    } catch (error) {
        log.error(`Setup failed: ${error.message}`);

        // 詳細なエラー情報（デバッグモード時）
        if (program.opts().debug) {
            console.error('\n🔍 Debug Information:');
            console.error(error.stack);
        }

        // エラー別のヘルプメッセージ
        if (error.message.includes('profile')) {
            log.warning('💡 Make sure you have run: aws sso login --profile ' + (program.opts().profile || '<profile>'));
        }

        if (error.message.includes('VERCEL_TOKEN')) {
            log.warning('💡 Get your Vercel token from: https://vercel.com/account/tokens');
        }

        if (error.message.includes('CLOUDFLARE_API_TOKEN')) {
            log.warning('💡 Get your Cloudflare token from: https://dash.cloudflare.com/profile/api-tokens');
        }

        process.exit(1);
    }
}

// エラーハンドリング
process.on('uncaughtException', (error) => {
    log.error(`Uncaught exception: ${error.message}`);
    if (program.opts()?.debug) {
        console.error(error.stack);
    }
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    log.error(`Unhandled rejection: ${reason}`);
    process.exit(1);
});

// 実行
if (require.main === module) {
    main();
}