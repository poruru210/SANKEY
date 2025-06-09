#!/usr/bin/env node

require('dotenv').config();
const { Command } = require('commander');
const path = require('path');
const crypto = require('crypto');

// 共通ライブラリ
const { log, displayTitle } = require('./lib/logger');
const { validateOptions, Timer } = require('./lib/cli-helpers');
const { SSM_PARAMETERS } = require('./lib/constants');

// メニューシステム
const { 
    displayMainMenu, 
    selectEnvironment, 
    confirmExecution, 
    confirmContinue,
    handleMenuError,
    showProgress,
    getBatchMenuItems
} = require('./modules/interactive-menu-module');

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
    .version('1.1.0')
    .requiredOption('-p, --profile <profile>', 'AWS SSO profile name')
    .option('-r, --region <region>', 'AWS region (defaults to profile default)')
    .option('--debug', 'Enable debug output')
    // 直接実行モード用（後方互換性）
    .option('--prepare-certificate', 'Prepare wildcard certificate only')
    .option('--generate-env-local', 'Generate .env.local only')
    .option('--setup-vercel', 'Setup Vercel environment variables only')
    .option('--trigger-deploy', 'Trigger Vercel deployment only')
    .option('--run-all', 'Run all steps')
    .option('-e, --environment <env>', 'Environment for direct execution (dev/prod)')
    .option('--force-update', 'Force update existing configurations')
    .option('--dry-run', 'Show what would be done without making changes');

/**
 * AUTH_SECRETを取得または新規作成
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
                return authSecretMatch[1].replace(/['"]/g, '');
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
function validateEnvironmentVariables() {
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

/**
 * 証明書準備処理
 */
async function executeCertificatePreparation(context) {
    try {
        showProgress('Preparing wildcard certificate for *.sankey.trade');

        // 環境変数チェック
        if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ZONE_ID) {
            throw new Error('Certificate preparation requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID');
        }

        // 証明書モジュールが実装されたら以下を有効化
        const { prepareWildcardCertificate } = require('./modules/certificate-module');
        const result = await prepareWildcardCertificate(context);
        
        if (result.success && !result.renewed) {
            log.info(`Certificate is valid for ${result.daysUntilExpiration} more days - no action needed`);
        }
        
        await confirmContinue();
        return { success: true };

    } catch (error) {
        await handleMenuError(error, { showStack: context.debug });
        return { success: false, error };
    }
}

/**
 * .env.local生成処理
 */
async function executeEnvLocalGeneration(context) {
    try {
        showProgress('Generating .env.local for development environment');

        // AWS設定取得（CDKデプロイ確認）
        let awsConfig = null;
        try {
            awsConfig = await getAwsConfiguration({
                profile: context.profile,
                environment: 'dev',
                region: context.region,
                debug: context.debug,
                requireApproval: 'never'
            });
        } catch (error) {
            // CDK未デプロイの場合
            console.log('');
            log.error('❌ CDK has not been deployed yet!');
            log.warning('AWS CloudFormation stacks not found or incomplete.');
            console.log('');
            console.log('📋 Required steps:');
            console.log('   1. Deploy CDK stacks first:');
            console.log(`      ${colors.cyan}npm run cdk:deploy:dev${colors.reset}`);
            console.log('   2. After successful CDK deployment, run this setup again');
            console.log('');
            console.log('ℹ️  .env.local generation requires:');
            console.log('   - Cognito Client ID and Secret from CDK');
            console.log('   - API Gateway endpoint from CDK');
            console.log('');
            
            await confirmContinue();
            return { success: false, error: 'cdk-not-deployed' };
        }

        if (!awsConfig) {
            throw new Error('Failed to retrieve AWS configuration');
        }

        // AUTH_SECRET取得
        const envFilePath = path.resolve(process.cwd(), '.env.local');
        const authSecret = await getOrCreateAuthSecret(
            'dev',
            envFilePath,
            { 
                apiToken: process.env.VERCEL_TOKEN, 
                projectId: process.env.VERCEL_PROJECT_ID 
            }
        );

        // .env.local生成
        await updateLocalEnv({
            awsConfig,
            authSecret,
            envFilePath,
            debug: context.debug
        });

        log.success('✅ .env.local file generated successfully');
        console.log('\n🚀 Next steps:');
        console.log('   1. Restart your Next.js application: npm run dev');
        console.log('   2. Test your API endpoints');

        await confirmContinue();
        return { success: true };

    } catch (error) {
        await handleMenuError(error, { showStack: context.debug });
        return { success: false, error };
    }
}

/**
 * Vercel環境変数設定処理
 */
async function executeVercelSetup(context) {
    try {
        // 環境選択
        const environment = context.environment || await selectEnvironment(context);
        showProgress(`Setting up Vercel environment variables for ${environment}`);

        // 環境変数チェック
        if (!process.env.VERCEL_TOKEN || !process.env.VERCEL_PROJECT_ID) {
            throw new Error('Vercel setup requires VERCEL_TOKEN and VERCEL_PROJECT_ID');
        }

        // AWS設定取得を試みる（CDKデプロイ確認）
        let awsConfig = null;
        try {
            awsConfig = await getAwsConfiguration({
                profile: context.profile,
                environment,
                region: context.region,
                debug: context.debug,
                requireApproval: 'never'
            });
        } catch (error) {
            // CDK未デプロイの場合
            console.log('');
            log.error('❌ CDK has not been deployed yet!');
            log.warning('AWS CloudFormation stacks not found or incomplete.');
            console.log('');
            console.log('📋 Required steps:');
            console.log('   1. Deploy CDK stacks first:');
            console.log(`      ${colors.cyan}npm run cdk:deploy:${environment}${colors.reset}`);
            console.log('   2. After successful CDK deployment, run this setup again');
            console.log('');
            console.log('ℹ️  CDK deployment creates:');
            console.log('   - Cognito User Pool and Client');
            console.log('   - API Gateway');
            console.log('   - DynamoDB tables');
            console.log('   - Lambda functions');
            console.log('');
            
            await confirmContinue();
            return { success: false, error: 'cdk-not-deployed' };
        }

        // AUTH_SECRET取得
        const authSecret = await getOrCreateAuthSecret(
            environment,
            path.resolve(process.cwd(), '.env.local'),
            { 
                apiToken: process.env.VERCEL_TOKEN, 
                projectId: process.env.VERCEL_PROJECT_ID 
            }
        );

        // Vercel環境の決定
        const vercelEnv = environment === 'prod' ? 'production' : 'preview';

        // 環境変数更新
        const results = await updateVercelEnvironmentVariables({
            awsConfig,
            environment,
            vercelEnvironment: vercelEnv,
            apiToken: process.env.VERCEL_TOKEN,
            projectId: process.env.VERCEL_PROJECT_ID,
            authSecret,
            forceUpdate: context.forceUpdate,
            dryRun: context.dryRun,
            debug: context.debug
        });

        if (results.results) {
            const { created, updated } = results.results;
            if (created.length > 0 || updated.length > 0) {
                log.warning('💡 Environment variables were updated. Consider deploying to apply changes.');
            }
        }

        await confirmContinue();
        return { success: true, results };

    } catch (error) {
        await handleMenuError(error, { showStack: context.debug });
        return { success: false, error };
    }
}

/**
 * Vercelデプロイ実行処理
 */
async function executeVercelDeploy(context) {
    try {
        // 環境選択
        const environment = context.environment || await selectEnvironment(context);
        showProgress(`Triggering Vercel deployment for ${environment}`);

        // 環境変数チェック
        const deployHookVar = environment === 'prod' ? 'VERCEL_DEPLOY_HOOK_PROD' : 'VERCEL_DEPLOY_HOOK_DEV';
        if (!process.env[deployHookVar]) {
            throw new Error(`Deployment requires ${deployHookVar}`);
        }

        // 確認
        const confirmed = await confirmExecution('Vercel Deployment', {
            Environment: environment,
            'Deploy Hook': deployHookVar
        });

        if (!confirmed) {
            log.info('Deployment cancelled');
            return { success: false, cancelled: true };
        }

        // デプロイ実行
        const vercelEnv = environment === 'prod' ? 'production' : 'preview';
        const deployResult = await triggerDeployment(vercelEnv, { debug: context.debug });

        log.success('✅ Vercel deployment triggered successfully');
        if (deployResult.url) {
            log.info(`🔗 Deployment URL: ${deployResult.url}`);
        }

        await confirmContinue();
        return { success: true, deployResult };

    } catch (error) {
        await handleMenuError(error, { showStack: context.debug });
        return { success: false, error };
    }
}

/**
 * 全ステップ実行処理
 */
async function executeAllSteps(context) {
    try {
        showProgress('Running all setup steps');

        const steps = getBatchMenuItems();
        const results = {};

        for (const step of steps) {
            console.log('\n' + '─'.repeat(40));
            
            switch (step) {
                case 'prepare-certificate':
                    results.certificate = await executeCertificatePreparation(context);
                    break;
                    
                case 'setup-vercel':
                    // 環境を一度だけ選択
                    if (!context.environment) {
                        context.environment = await selectEnvironment(context);
                    }
                    results.vercel = await executeVercelSetup(context);
                    // CDK未デプロイエラーの場合は中断
                    if (results.vercel && !results.vercel.success && results.vercel.error === 'cdk-not-deployed') {
                        log.error('Cannot continue without CDK deployment');
                        break;
                    }
                    break;
                    
                case 'trigger-deploy':
                    // Vercel設定が成功した場合のみ実行
                    if (results.vercel && results.vercel.success) {
                        results.deploy = await executeVercelDeploy(context);
                    } else {
                        log.info('⏭️ Skipping deployment (Vercel setup not completed)');
                    }
                    break;
            }

            // エラーがあれば中断
            if (results[step] && !results[step].success && !results[step].cancelled) {
                log.error('Setup failed. Stopping execution.');
                break;
            }
        }

        console.log('\n' + '═'.repeat(40));
        log.complete('🎉 Setup process completed!');
        
        await confirmContinue();
        return results;

    } catch (error) {
        await handleMenuError(error, { showStack: context.debug });
        return { success: false, error };
    }
}

/**
 * メインメニューループ
 */
async function runInteractiveMode(context) {
    while (true) {
        const selection = await displayMainMenu(context);

        switch (selection) {
            case 'prepare-certificate':
                await executeCertificatePreparation(context);
                break;

            case 'generate-env-local':
                await executeEnvLocalGeneration(context);
                break;

            case 'setup-vercel':
                await executeVercelSetup(context);
                break;

            case 'trigger-deploy':
                await executeVercelDeploy(context);
                break;

            case 'run-all':
                await executeAllSteps(context);
                break;

            case 'exit':
                log.info('👋 Goodbye!');
                process.exit(0);
                break;
        }
    }
}

/**
 * 直接実行モード（後方互換性）
 */
async function runDirectMode(options) {
    const context = {
        profile: options.profile,
        region: options.region,
        environment: options.environment,
        debug: options.debug,
        forceUpdate: options.forceUpdate,
        dryRun: options.dryRun
    };

    if (options.prepareCertificate) {
        await executeCertificatePreparation(context);
    } else if (options.generateEnvLocal) {
        await executeEnvLocalGeneration(context);
    } else if (options.setupVercel) {
        await executeVercelSetup(context);
    } else if (options.triggerDeploy) {
        await executeVercelDeploy(context);
    } else if (options.runAll) {
        await executeAllSteps(context);
    } else {
        // デフォルトは対話モード
        await runInteractiveMode(context);
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

        // 環境変数の検証（警告のみ）
        validateEnvironmentVariables();

        // 実行コンテキストの準備
        const context = {
            profile: options.profile,
            region: options.region,
            debug: options.debug,
            forceUpdate: options.forceUpdate,
            dryRun: options.dryRun
        };

        // 直接実行モードの判定
        const isDirectMode = options.prepareCertificate || 
                           options.generateEnvLocal || 
                           options.setupVercel || 
                           options.triggerDeploy || 
                           options.runAll;

        if (isDirectMode) {
            // 直接実行モード
            await runDirectMode(options);
        } else {
            // 対話モード
            await runInteractiveMode(context);
        }

    } catch (error) {
        log.error(`Setup failed: ${error.message}`);

        if (program.opts().debug) {
            console.error('\n🔍 Debug Information:');
            console.error(error.stack);
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