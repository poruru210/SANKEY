const fs = require('fs').promises;
const crypto = require('crypto');
const { log } = require('../lib/logger');

/**
 * .env.local生成モジュール (dev環境専用)
 * ローカル開発用の環境変数ファイルを生成
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

        // AUTH_SECRETの追加（なければ）
        const hasAuthSecret = cleanedContent.some(line => line.startsWith('AUTH_SECRET='));
        if (!hasAuthSecret) {
            if (!cleanedContent.some(line => line.includes('# Auth.js設定'))) {
                cleanedContent.push('', '# Auth.js設定');
            }
            cleanedContent.push(`AUTH_SECRET="${awsConfig.authSecret}"`);
        }

        // ✅ NEXTAUTH_URL を常に上書き
        cleanedContent = cleanedContent.filter(line => !line.startsWith('NEXTAUTH_URL='));
        cleanedContent.push(`NEXTAUTH_URL=http://localhost:3000`);

        // 新しい設定を追加
        const newSettings = [
            '',
            '# API Endpoint設定',
            `NEXT_PUBLIC_API_ENDPOINT=https://api-dev.sankey.trade`,
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
                `NEXT_PUBLIC_APP_URL=http://localhost:3000`
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
 * .env.local の内容を検証
 * @param {Array} content - File content lines
 * @returns {Object} Validation result
 */
function validateEnvContent(content) {
    const requiredKeys = [
        'NEXT_PUBLIC_API_ENDPOINT',
        'COGNITO_CLIENT_ID',
        'COGNITO_CLIENT_SECRET',
        'COGNITO_ISSUER',
        'AUTH_SECRET',
        'NEXTAUTH_URL'
    ];

    const presentKeys = [];
    const missingKeys = [];

    for (const key of requiredKeys) {
        const found = content.some(line => line.startsWith(`${key}=`));
        if (found) {
            presentKeys.push(key);
        } else {
            missingKeys.push(key);
        }
    }

    return {
        valid: missingKeys.length === 0,
        presentKeys,
        missingKeys
    };
}

/**
 * .env.local ファイルの存在確認
 * @param {string} envFilePath - File path
 * @returns {boolean} File exists
 */
async function checkEnvFileExists(envFilePath) {
    try {
        await fs.access(envFilePath);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * .env.local のバックアップ作成
 * @param {string} envFilePath - File path
 * @returns {string} Backup file path
 */
async function createEnvBackup(envFilePath) {
    try {
        const exists = await checkEnvFileExists(envFilePath);
        if (!exists) {
            return null;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${envFilePath}.backup.${timestamp}`;
        
        const content = await fs.readFile(envFilePath, 'utf8');
        await fs.writeFile(backupPath, content, 'utf8');
        
        log.info(`📄 Backup created: ${backupPath}`);
        return backupPath;
    } catch (error) {
        log.warning(`Failed to create backup: ${error.message}`);
        return null;
    }
}

/**
 * 設定値の表示（センシティブ情報をマスク）
 * @param {Object} awsConfig - AWS configuration
 */
function displayConfigSummary(awsConfig) {
    log.info('📋 Configuration to be written:');
    
    console.log(`   API Endpoint: https://api-dev.sankey.trade`);
    console.log(`   Cognito Client ID: ${awsConfig.COGNITO_CLIENT_ID}`);
    console.log(`   Cognito Client Secret: ${awsConfig.COGNITO_CLIENT_SECRET.substring(0, 8)}...`);
    console.log(`   Cognito Issuer: ${awsConfig.COGNITO_ISSUER}`);
    
    if (awsConfig.NEXT_PUBLIC_COGNITO_DOMAIN) {
        console.log(`   Cognito Domain: ${awsConfig.NEXT_PUBLIC_COGNITO_DOMAIN}`);
        console.log(`   App URL: http://localhost:3000`);
    }
}

module.exports = {
    updateLocalEnv,
    validateEnvContent,
    checkEnvFileExists,
    createEnvBackup,
    displayConfigSummary
};