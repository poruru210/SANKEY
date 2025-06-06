#!/usr/bin/env node

const { Command } = require('commander');
// 共通ライブラリからインポート
const { createAwsClients, findSankeyStacks, getStackOutputs, getCognitoDetails } = require('./lib/aws-helpers');
const { log, displayTitle, displayStackOptions, displayConfigValues } = require('./lib/logger');
const { selectStackCombination, validateOptions, Timer } = require('./lib/cli-helpers');
const path = require('path');
const fs = require('fs').promises;

// コマンドライン引数の設定
const program = new Command();

program
    .name('update-env')
    .description('Update .env.local with AWS Cognito and API endpoint configurations')
    .version('1.0.0')
    .requiredOption('-p, --profile <profile>', 'AWS SSO profile name')
    .option('-r, --region <region>', 'AWS region (defaults to profile default)')
    .option('-f, --env-file <file>', 'Environment file path', '.env.local')
    .option('--require-approval <type>', 'Require approval for changes', 'always')
    .option('--debug', 'Enable debug output');

// .env.local更新関数（update-env.js固有の機能）
async function updateEnvFile(envFilePath, configValues, options) {
    try {
        log.debug(`Updating env file: ${envFilePath}`, options);

        let envContent = [];

        // 既存ファイルの読み込み
        try {
            const existingContent = await fs.readFile(envFilePath, 'utf8');
            envContent = existingContent.split('\n');
            log.debug(`Read existing file with ${envContent.length} lines`, options);
        } catch (error) {
            if (error.code === 'ENOENT') {
                log.info('Creating new .env.local file...');
                envContent = [];
            } else {
                throw error;
            }
        }

        // 関連する既存設定を削除
        const keysToRemove = [
            'NEXT_PUBLIC_API_ENDPOINT',
            'COGNITO_CLIENT_ID',
            'COGNITO_CLIENT_SECRET',
            'COGNITO_ISSUER',
            'NEXT_PUBLIC_COGNITO_DOMAIN',
            'NEXT_PUBLIC_COGNITO_CLIENT_ID',
            'NEXT_PUBLIC_APP_URL'
        ];

        const filteredContent = envContent.filter(line => {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('#') && (
                trimmedLine.includes('API Endpoint') ||
                trimmedLine.includes('Cognito') ||
                trimmedLine.includes('Auth.js')
            )) {
                return false; // コメント行も削除
            }
            return !keysToRemove.some(key => trimmedLine.startsWith(`${key}=`));
        });

        // 連続する空行を1つにまとめる
        const cleanedContent = [];
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

        // Auth.js設定を確認・追加
        const hasAuthSecret = cleanedContent.some(line => line.startsWith('AUTH_SECRET='));
        const hasNextAuthUrl = cleanedContent.some(line => line.startsWith('NEXTAUTH_URL='));

        if (!hasAuthSecret) {
            // ランダムなAUTH_SECRETを生成
            const randomBytes = require('crypto').randomBytes(32);
            const authSecret = randomBytes.toString('base64');

            if (!cleanedContent.some(line => line.includes('# Auth.js設定'))) {
                cleanedContent.push('', '# Auth.js設定');
            }
            cleanedContent.push(`AUTH_SECRET="${authSecret}"`);
        }

        if (!hasNextAuthUrl) {
            const appUrl = configValues.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
            cleanedContent.push(`NEXTAUTH_URL=${appUrl}`);
        }

        // 新しい設定を追加
        const newSettings = [
            '',
            '# API Endpoint設定',
            `NEXT_PUBLIC_API_ENDPOINT=${configValues.NEXT_PUBLIC_API_ENDPOINT}`,
            '',
            '# Cognito設定',
            `COGNITO_CLIENT_ID=${configValues.COGNITO_CLIENT_ID}`,
            `COGNITO_CLIENT_SECRET=${configValues.COGNITO_CLIENT_SECRET}`,
            `COGNITO_ISSUER=${configValues.COGNITO_ISSUER}`
        ];

        // Cognito Domain設定（存在する場合のみ）
        if (configValues.NEXT_PUBLIC_COGNITO_DOMAIN) {
            newSettings.push(
                '',
                '# Cognito Logout設定',
                `NEXT_PUBLIC_COGNITO_DOMAIN=${configValues.NEXT_PUBLIC_COGNITO_DOMAIN}`,
                `NEXT_PUBLIC_COGNITO_CLIENT_ID=${configValues.NEXT_PUBLIC_COGNITO_CLIENT_ID}`,
                `NEXT_PUBLIC_APP_URL=${configValues.NEXT_PUBLIC_APP_URL}`
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
        log.success(`Updated .env.local file: ${envFilePath}`);

        return finalContent;

    } catch (error) {
        throw new Error(`Failed to update env file: ${error.message}`);
    }
}

// メイン処理
async function main() {
    const timer = new Timer();

    try {
        // コマンドライン引数をパース
        program.parse();
        const options = program.opts();

        // 引数検証
        validateOptions(options, ['profile']);

        // タイトル表示
        displayTitle('SanKey Environment Updater');

        log.info(`📧 Profile: ${options.profile}`);

        if (options.region) {
            log.info(`🌍 Region: ${options.region} (specified)`);
        } else {
            log.info(`🌍 Region: Using profile default`);
        }

        log.info(`📁 Env file: ${options.envFile}`);

        // 環境ファイルのパス解決
        const envFilePath = path.resolve(process.cwd(), options.envFile);
        log.debug(`Resolved env file path: ${envFilePath}`, options);

        // AWS クライアントの初期化
        log.info('🔧 Initializing AWS clients...');
        const clients = createAwsClients(options.profile, options.region);
        log.success('AWS clients initialized successfully');

        // Step 2: スタック検索
        log.info('🔍 Searching for Sankey stacks...');
        const stackCombinations = await findSankeyStacks(clients.cloudFormation, options);

        if (stackCombinations.length === 0) {
            log.error('No Sankey stacks found. Please check:');
            log.error('- Stack naming convention: Sankey{Environment}{Type}Stack');
            log.error('- AWS region and profile settings');
            return;
        }

        log.success(`Found ${stackCombinations.length} stack combination(s):`);
        displayStackOptions(stackCombinations);

        // Step 3: ユーザー選択
        log.info('🎯 Selecting stack combination...');
        const selectedCombination = await selectStackCombination(stackCombinations, options);

        // Step 4: 設定取得
        log.info('📋 Retrieving configuration values...');

        // AuthStackからの設定取得
        const authOutputs = await getStackOutputs(
            clients.cloudFormation,
            selectedCombination.authStack.StackName,
            ['UserPoolId', 'UserPoolClientId', 'UserPoolDomainUrl'],
            options
        );

        // APIStackからの設定取得
        const apiOutputs = await getStackOutputs(
            clients.cloudFormation,
            selectedCombination.apiStack.StackName,
            ['ApiEndpoint'],
            options
        );

        // 必須の設定値チェック
        if (!authOutputs.UserPoolId || !authOutputs.UserPoolClientId) {
            throw new Error('Required Auth stack outputs not found (UserPoolId, UserPoolClientId)');
        }

        if (!apiOutputs.ApiEndpoint) {
            throw new Error('Required API stack output not found (ApiEndpoint)');
        }

        // Cognito詳細取得
        log.info('🔐 Retrieving Cognito client details...');
        const cognitoDetails = await getCognitoDetails(
            clients.cognito,
            authOutputs.UserPoolId,
            authOutputs.UserPoolClientId,
            options
        );

        if (!cognitoDetails.clientSecret) {
            throw new Error('Cognito Client Secret not found. Make sure the User Pool Client has a secret generated.');
        }

        // 設定値の準備
        const region = options.region || process.env.AWS_DEFAULT_REGION || 'ap-northeast-1';
        const cognitoIssuer = `https://cognito-idp.${region}.amazonaws.com/${authOutputs.UserPoolId}`;
        const apiEndpoint = apiOutputs.ApiEndpoint.replace(/\/$/, ''); // 末尾スラッシュ削除
        const appUrl = 'http://localhost:3000'; // デフォルト

        const configValues = {
            NEXT_PUBLIC_API_ENDPOINT: apiEndpoint,
            COGNITO_CLIENT_ID: authOutputs.UserPoolClientId,
            COGNITO_CLIENT_SECRET: cognitoDetails.clientSecret,
            COGNITO_ISSUER: cognitoIssuer
        };

        // Cognito Domain設定（オプション）
        if (authOutputs.UserPoolDomainUrl) {
            configValues.NEXT_PUBLIC_COGNITO_DOMAIN = authOutputs.UserPoolDomainUrl;
            configValues.NEXT_PUBLIC_COGNITO_CLIENT_ID = authOutputs.UserPoolClientId;
            configValues.NEXT_PUBLIC_APP_URL = appUrl;
        }

        // 設定値の表示
        displayConfigValues(configValues);

        // .env.local更新
        log.info('📝 Updating .env.local file...');
        await updateEnvFile(envFilePath, configValues, options);

        log.success('🎉 Environment configuration updated successfully!');
        log.info(`📁 File updated: ${envFilePath}`);

        // 注意事項の表示
        console.log(`\n📋 Next Steps:`);
        console.log(`   1. Restart your Next.js application: npm run dev`);
        console.log(`   2. Verify the configuration in your app`);

        if (!configValues.NEXT_PUBLIC_COGNITO_DOMAIN) {
            console.log(`\n⚠️  Note: Cognito Domain URL not found.`);
            console.log(`   If you need logout functionality, configure the domain in AWS Console.`);
        }

        if (cognitoDetails.logoutUrls.length === 0) {
            console.log(`\n⚠️  Note: No logout URLs configured in Cognito.`);
            console.log(`   Add logout URLs in AWS Cognito Console if needed.`);
        }

        timer.log('🎉 Operation completed');

    } catch (error) {
        log.error(`Error: ${error.message}`);

        if (error.message.includes('profile')) {
            log.warning('Make sure you have run: aws sso login --profile ' + (program.opts().profile || '<profile>'));
        }

        process.exit(1);
    }
}

// エラーハンドリング
process.on('uncaughtException', (error) => {
    log.error(`Uncaught exception: ${error.message}`);
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