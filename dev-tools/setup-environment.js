#!/usr/bin/env node

require('dotenv').config();
const { Command } = require('commander');
const path = require('path');

// 共通ライブラリ
const { log, displayTitle, colors } = require('./lib/logger'); // Added colors
const { validateOptions, Timer } = require('./lib/cli-helpers');
const {
    SSM_PARAMETERS,
    LOCAL_ENV_FILENAME,
    ERROR_TYPES,
    APPROVAL_MODES,
    ENVIRONMENTS,
    VERCEL_ENVIRONMENTS
} = require('./lib/constants');
const { BaseError, ConfigurationError, ApiError, CdkNotDeployedError, ResourceNotFoundError } = require('./lib/errors');

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
const { updateLocalEnv, readAuthSecretFromEnvLocal } = require('./modules/env-local-module');
const { updateVercelEnvironmentVariables, getExistingAuthSecret } = require('./modules/vercel-env-module');
const { triggerDeployment, generateAuthSecret } = require('./lib/vercel-helpers');

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
                environment: ENVIRONMENTS.DEV,
                region: context.region,
                debug: context.debug,
                requireApproval: APPROVAL_MODES.NEVER
            });
        } catch (error) {
            // CDK未デプロイの場合
            // TODO: aws-config-moduleが具体的なエラータイプ (例: CdkNotDeployedError) を返すように将来的に改善し、
            //       ここでエラータイプを判別して、より適切なメッセージを表示することを検討。
            //       現状は、getAwsConfigurationがエラーをスローするかnullを返した場合のメッセージに依存。
            if (error instanceof CdkNotDeployedError) {
                log.error(`❌ CDK not deployed for '${error.environment || ENVIRONMENTS.DEV}' environment.`);
                if (error.missingResources && error.missingResources.length > 0) {
                    log.warning(`Missing CDK resources: ${error.missingResources.join(', ')}`);
                }
                log.info('📋 Required steps:');
                log.info(`   1. Deploy CDK stacks first: npm run cdk:deploy:${error.environment || ENVIRONMENTS.DEV}`);
                log.info('   2. After successful CDK deployment, run this setup again.');
                log.info('ℹ️  .env.local generation requires Cognito Client ID/Secret and API Gateway endpoint from CDK.');
                await confirmContinue();
                return { success: false, error: error };
            }
            // For other errors, let handleMenuError deal with them
            throw error;
        }

        if (!awsConfig) {
            throw new Error('Failed to retrieve AWS configuration');
        }

        // AUTH_SECRET取得
        const envFilePath = path.resolve(process.cwd(), LOCAL_ENV_FILENAME);
        const authSecret = await getOrCreateAuthSecret(
            ENVIRONMENTS.DEV,
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

        // AWS設定取得を試みる（CDKデプロイ確認）
        // VERCEL_TOKEN と VERCEL_PROJECT_ID のチェックは、VercelClientの初期化や
        // updateVercelEnvironmentVariables 関数内で行われることを期待。
        let awsConfig = null;
        try {
            awsConfig = await getAwsConfiguration({
                profile: context.profile,
                environment,
                region: context.region,
                debug: context.debug,
                requireApproval: APPROVAL_MODES.NEVER
            });
        } catch (error) {
            // CDK未デプロイの場合
            // TODO: aws-config-moduleが具体的なエラータイプ (例: CdkNotDeployedError) を返すように将来的に改善し、
            //       ここでエラータイプを判別して、より適切なメッセージを表示することを検討。
            //       現状は、getAwsConfigurationがエラーをスローするかnullを返した場合のメッセージに依存。
            if (error instanceof CdkNotDeployedError) {
                log.error(`❌ CDK not deployed for '${error.environment || environment}' environment.`);
                 if (error.missingResources && error.missingResources.length > 0) {
                    log.warning(`Missing CDK resources: ${error.missingResources.join(', ')}`);
                }
                log.info('📋 Required steps:');
                log.info(`   1. Deploy CDK stacks first: npm run cdk:deploy:${error.environment || environment}`);
                log.info('   2. After successful CDK deployment, run this setup again.');
                log.info('ℹ️  CDK deployment creates Cognito User Pool/Client, API Gateway, DynamoDB tables, and Lambda functions.');
                await confirmContinue();
                return { success: false, error: error };
            }
            // For other errors, let handleMenuError deal with them
            throw error;
        }

        // AUTH_SECRET取得
        const authSecret = await getOrCreateAuthSecret(
            environment,
            path.resolve(process.cwd(), LOCAL_ENV_FILENAME),
            { 
                apiToken: process.env.VERCEL_TOKEN, 
                projectId: process.env.VERCEL_PROJECT_ID 
            }
        );

        // Vercel環境の決定
        const vercelEnv = environment === ENVIRONMENTS.PROD ? VERCEL_ENVIRONMENTS.PRODUCTION : VERCEL_ENVIRONMENTS.PREVIEW;

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

        // 確認
        // デプロイフックURLのチェックは vercel-helpers.js の triggerDeployment 関数内で行われます。
        const confirmed = await confirmExecution('Vercel Deployment', {
            Environment: environment
        });

        if (!confirmed) {
            log.info('Deployment cancelled');
            return { success: false, cancelled: true };
        }

        // デプロイ実行
        const vercelEnv = environment === ENVIRONMENTS.PROD ? VERCEL_ENVIRONMENTS.PRODUCTION : VERCEL_ENVIRONMENTS.PREVIEW;
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
                    if (results.vercel && !results.vercel.success && results.vercel.error === ERROR_TYPES.CDK_NOT_DEPLOYED) {
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
        log.info(`🎉 Operation completed in ${timer.elapsedFormatted()}`);
    } catch (error) {
        if (error instanceof CdkNotDeployedError) {
            log.error(`❌ CDK Setup Incomplete: ${error.message}`);
            log.warning(`Environment: ${error.environment || 'N/A'}`);
            if (error.missingResources && error.missingResources.length > 0) {
                log.warning(`Missing: ${error.missingResources.join(', ')}`);
            }
            log.info("Please ensure CDK resources are deployed before running this tool.");
        } else if (error instanceof ConfigurationError) {
            log.error(`❌ Configuration Error: ${error.message}`);
            if (error.cause) log.warning(`Cause: ${error.cause}`);
            log.info("Please check your environment variables and configuration files.");
        } else if (error instanceof ApiError) {
            log.error(`❌ API Error (${error.serviceName || 'Unknown Service'}): ${error.message}`);
            if (error.statusCode) log.warning(`Status Code: ${error.statusCode}`);
            if (error.cause) log.warning(`Cause: ${error.cause}`);
        } else if (error instanceof ResourceNotFoundError) {
            log.error(`❌ Resource Not Found: ${error.message}`);
        } else if (error instanceof BaseError) { // Catch any other custom errors
            log.error(`❌ An operation failed: ${error.message}`);
            if (error.cause) log.warning(`Cause: ${error.cause}`);
        }
        else {
            log.error(`An unexpected error occurred during setup: ${error.message}`);
        }

        if (program.opts().debug && error.stack) {
            console.error('\n🔍 Debug Information (Stack Trace):');
            console.error(error.stack);
        }
        process.exit(1);
    }
}

// グローバルエラーハンドリング (主に予期せぬエラーや非同期処理の漏れをキャッチ)
process.on('uncaughtException', (error) => {
    log.error(`💥 Uncaught Exception: ${error.message}`);
    if (program.opts()?.debug && error.stack) {
        console.error(error.stack);
    }
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    log.error(`💥 Unhandled Rejection:`);
    if (reason instanceof Error) {
        log.error(`  Message: ${reason.message}`);
        if (program.opts()?.debug && reason.stack) {
            console.error(reason.stack);
        }
    } else {
        log.error(reason);
    }
    promise.catch(err => { // Attach a catch handler to the promise to avoid further unhandled rejections
        log.error(`  (Promise rejection caught)`);
    });
    process.exit(1);
});

// 実行
if (require.main === module) {
    main();
}