/**
 * 色付きコンソール出力のためのログライブラリ
 */

// 色定義
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[37m'
};

/**
 * ログオブジェクト
 */
const log = {
    /**
     * 情報メッセージ
     * @param {string} msg - メッセージ
     */
    info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),

    /**
     * 成功メッセージ
     * @param {string} msg - メッセージ
     */
    success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),

    /**
     * 警告メッセージ
     * @param {string} msg - メッセージ
     */
    warning: (msg) => console.log(`${colors.yellow}⚠️${colors.reset} ${msg}`),

    /**
     * エラーメッセージ
     * @param {string} msg - メッセージ
     */
    error: (msg) => console.error(`${colors.red}❌${colors.reset} ${msg}`),

    /**
     * デバッグメッセージ（オプション有効時のみ表示）
     * @param {string} msg - メッセージ
     * @param {Object} options - オプション（debugフラグをチェック）
     */
    debug: (msg, options) => {
        if (options?.debug) {
            console.log(`${colors.gray}🔍 DEBUG:${colors.reset} ${msg}`);
        }
    },

    /**
     * プログレスメッセージ
     * @param {string} msg - メッセージ
     */
    progress: (msg) => console.log(`${colors.yellow}🔄${colors.reset} ${msg}`),

    /**
     * 検索メッセージ
     * @param {string} msg - メッセージ
     */
    search: (msg) => console.log(`${colors.blue}🔍${colors.reset} ${msg}`),

    /**
     * データ生成メッセージ
     * @param {string} msg - メッセージ
     */
    generate: (msg) => console.log(`${colors.magenta}🎲${colors.reset} ${msg}`),

    /**
     * データベースメッセージ
     * @param {string} msg - メッセージ
     */
    database: (msg) => console.log(`${colors.blue}📊${colors.reset} ${msg}`),

    /**
     * 完了メッセージ
     * @param {string} msg - メッセージ
     */
    complete: (msg) => console.log(`${colors.green}🎉${colors.reset} ${msg}`),

    /**
     * ユーザーメッセージ
     * @param {string} msg - メッセージ
     */
    user: (msg) => console.log(`${colors.cyan}👤${colors.reset} ${msg}`),

    /**
     * メールメッセージ
     * @param {string} msg - メッセージ
     */
    email: (msg) => console.log(`${colors.yellow}📧${colors.reset} ${msg}`)
};

/**
 * タイトル表示関数
 * @param {string} title - タイトル
 * @param {string} color - 色（デフォルト: green）
 */
function displayTitle(title, color = 'green') {
    const colorCode = colors[color] || colors.green;
    console.log(`${colorCode}=== ${title} ===${colors.reset}`);
}

/**
 * セクション表示関数
 * @param {string} section - セクション名
 * @param {string} color - 色（デフォルト: cyan）
 */
function displaySection(section, color = 'cyan') {
    const colorCode = colors[color] || colors.cyan;
    console.log(`\n${colorCode}📋 ${section}:${colors.reset}`);
}

/**
 * オプション表示関数
 * @param {Array} stackCombinations - スタック組み合わせ配列
 */
function displayStackOptions(stackCombinations) {
    displaySection('Available Stack Combinations');

    stackCombinations.forEach((combo, index) => {
        console.log(`${colors.yellow}${index + 1}.${colors.reset} ${colors.bright}${combo.environment.toUpperCase()} Environment${colors.reset}`);
        console.log(`   Auth Stack: ${colors.green}${combo.authStack.StackName}${colors.reset} (${combo.authStack.StackStatus})`);
        console.log(`   API Stack:  ${colors.green}${combo.apiStack.StackName}${colors.reset} (${combo.apiStack.StackStatus})`);

        if (combo.dbStack) {
            console.log(`   DB Stack:   ${colors.green}${combo.dbStack.StackName}${colors.reset} (${combo.dbStack.StackStatus})`);
        }

        if (combo.authStack.Description) {
            console.log(`   Description: ${colors.gray}${combo.authStack.Description}${colors.reset}`);
        }
        console.log('');
    });
}

/**
 * 設定値表示関数
 * @param {Object} configValues - 設定値オブジェクト
 */
function displayConfigValues(configValues) {
    log.success('✅ Configuration values retrieved:');

    if (configValues.NEXT_PUBLIC_API_ENDPOINT) {
        console.log(`${colors.cyan}   API Endpoint:${colors.reset} ${configValues.NEXT_PUBLIC_API_ENDPOINT}`);
    }

    if (configValues.COGNITO_CLIENT_ID) {
        console.log(`${colors.cyan}   Cognito Client ID:${colors.reset} ${configValues.COGNITO_CLIENT_ID}`);
    }

    if (configValues.COGNITO_CLIENT_SECRET) {
        console.log(`${colors.cyan}   Cognito Client Secret:${colors.reset} ${configValues.COGNITO_CLIENT_SECRET.substring(0, 8)}...`);
    }

    if (configValues.COGNITO_ISSUER) {
        console.log(`${colors.cyan}   Cognito Issuer:${colors.reset} ${configValues.COGNITO_ISSUER}`);
    }

    if (configValues.NEXT_PUBLIC_COGNITO_DOMAIN) {
        console.log(`${colors.cyan}   Cognito Domain:${colors.reset} ${configValues.NEXT_PUBLIC_COGNITO_DOMAIN}`);
    }

    if (configValues.tableName) {
        console.log(`${colors.cyan}   Table Name:${colors.reset} ${configValues.tableName}`);
    }

    if (configValues.userPoolId) {
        console.log(`${colors.cyan}   UserPool ID:${colors.reset} ${configValues.userPoolId}`);
    }
}

/**
 * ユーザー一覧表示関数
 * @param {Array} users - ユーザー配列
 */
function displayUserList(users) {
    displaySection('Available Users');

    users.forEach((user, index) => {
        const statusColor = user.userStatus === 'CONFIRMED' ? colors.green : colors.yellow;
        console.log(`   ${index + 1}. ${colors.cyan}${user.email || 'No email'}${colors.reset} - ${statusColor}${user.userStatus}${colors.reset}`);
    });
}

/**
 * プログレスバー表示関数
 * @param {number} current - 現在の値
 * @param {number} total - 合計値
 * @param {string} label - ラベル
 */
function displayProgress(current, total, label = '') {
    const percentage = Math.floor((current / total) * 100);
    const barLength = 20;
    const filledLength = Math.floor((current / total) * barLength);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

    process.stdout.write(`\r${colors.cyan}${label}${colors.reset} [${bar}] ${percentage}% (${current}/${total})`);

    if (current === total) {
        console.log(''); // 改行
    }
}

module.exports = {
    log,
    colors,
    displayTitle,
    displaySection,
    displayStackOptions,
    displayConfigValues,
    displayUserList,
    displayProgress
};