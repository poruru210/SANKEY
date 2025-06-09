const readline = require('readline');
const { log, colors, displayTitle } = require('../lib/logger');

/**
 * メニュー項目の定義
 */
const MENU_ITEMS = [
    {
        id: 'prepare-certificate',
        label: '🔐 Prepare Wildcard Certificate (*.sankey.trade)',
        description: 'Create/update Cloudflare Origin CA certificate and import to ACM'
    },
    {
        id: 'setup-vercel',
        label: '🔧 Setup Vercel Environment Variables',
        description: 'Configure environment variables in Vercel project'
    },
    {
        id: 'trigger-deploy',
        label: '🚀 Trigger Vercel Deployment',
        description: 'Deploy the application using Vercel Deploy Hook'
    },
    {
        id: 'run-all',
        label: '🎯 Run All Steps (Complete Setup)',
        description: 'Execute steps 1-3 in sequence'
    },
    {
        id: 'generate-env-local',
        label: '📝 Generate .env.local (Local Development)',
        description: 'Create local environment file for development'
    },
    {
        id: 'exit',
        label: '❌ Exit',
        description: 'Exit the setup tool'
    }
];

/**
 * メニュー表示とユーザー選択
 * @param {Object} context - 実行コンテキスト（profile, environment等）
 * @returns {string} 選択されたメニューID
 */
async function displayMainMenu(context) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        // タイトル表示
        console.clear();
        displayTitle('Sankey Environment Setup', 'cyan');
        console.log('━'.repeat(40));
        console.log(`AWS Profile: ${colors.green}${context.profile}${colors.reset}`);
        if (context.region) {
            console.log(`AWS Region: ${colors.green}${context.region}${colors.reset}`);
        }
        console.log('');
        console.log('What would you like to do?');
        console.log('');

        // メニュー項目表示
        MENU_ITEMS.forEach((item, index) => {
            console.log(`${colors.yellow}${index + 1}.${colors.reset} ${item.label}`);
        });

        console.log('');

        // ユーザー入力待ち
        const answer = await new Promise((resolve) => {
            rl.question(`Please select an option (1-${MENU_ITEMS.length}): `, resolve);
        });

        const selection = parseInt(answer.trim());

        if (isNaN(selection) || selection < 1 || selection > MENU_ITEMS.length) {
            log.error(`Invalid selection. Please enter a number between 1 and ${MENU_ITEMS.length}.`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return await displayMainMenu(context); // 再表示
        }

        const selectedItem = MENU_ITEMS[selection - 1];
        console.log('');
        log.info(`Selected: ${selectedItem.label}`);
        
        if (selectedItem.description) {
            console.log(`   ${colors.gray}${selectedItem.description}${colors.reset}`);
        }
        console.log('');

        return selectedItem.id;

    } finally {
        rl.close();
    }
}

/**
 * 環境選択メニュー
 * @param {Object} context - 実行コンテキスト
 * @returns {string} 選択された環境（dev/prod）
 */
async function selectEnvironment(context) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        console.log(`${colors.cyan}Select target environment:${colors.reset}`);
        console.log(`  ${colors.yellow}1.${colors.reset} Development (dev)`);
        console.log(`  ${colors.yellow}2.${colors.reset} Production (prod)`);
        console.log('');

        const answer = await new Promise((resolve) => {
            rl.question('Please select environment (1-2): ', resolve);
        });

        const selection = parseInt(answer.trim());

        if (selection === 1) {
            return 'dev';
        } else if (selection === 2) {
            return 'prod';
        } else {
            log.error('Invalid selection. Please enter 1 or 2.');
            await new Promise(resolve => setTimeout(resolve, 1500));
            return await selectEnvironment(context);
        }

    } finally {
        rl.close();
    }
}

/**
 * 実行確認プロンプト
 * @param {string} action - 実行するアクション
 * @param {Object} details - 詳細情報
 * @returns {boolean} ユーザーの確認結果
 */
async function confirmExecution(action, details = {}) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        console.log(`${colors.yellow}⚠️  Confirm Execution:${colors.reset}`);
        console.log(`   Action: ${action}`);
        
        // 詳細情報の表示
        Object.entries(details).forEach(([key, value]) => {
            console.log(`   ${key}: ${value}`);
        });
        
        console.log('');

        const answer = await new Promise((resolve) => {
            rl.question('Do you want to proceed? [Y/n]: ', resolve);
        });

        const trimmed = answer.trim().toLowerCase();
        return trimmed === '' || trimmed === 'y' || trimmed === 'yes';

    } finally {
        rl.close();
    }
}

/**
 * 処理完了後の継続確認
 * @returns {boolean} 継続するかどうか
 */
async function confirmContinue() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        console.log('');
        const answer = await new Promise((resolve) => {
            rl.question('Press Enter to continue...', resolve);
        });
        return true;

    } finally {
        rl.close();
    }
}

/**
 * エラー表示と継続確認
 * @param {Error} error - エラーオブジェクト
 * @param {Object} options - オプション
 */
async function handleMenuError(error, options = {}) {
    log.error(`Operation failed: ${error.message}`);
    
    if (options.showStack) {
        console.error('\n🔍 Stack trace:');
        console.error(error.stack);
    }

    await confirmContinue();
}

/**
 * 進捗表示ヘルパー
 * @param {string} message - メッセージ
 * @param {Object} options - オプション
 */
function showProgress(message, options = {}) {
    if (options.clear) {
        console.clear();
        displayTitle('Sankey Environment Setup', 'cyan');
        console.log('━'.repeat(40));
    }
    
    log.progress(message);
}

/**
 * メニューアイテムの詳細取得
 * @param {string} menuId - メニューID
 * @returns {Object} メニューアイテム
 */
function getMenuItem(menuId) {
    return MENU_ITEMS.find(item => item.id === menuId);
}

/**
 * バッチ実行用のメニューID配列取得
 * @returns {Array} 実行するメニューIDの配列
 */
function getBatchMenuItems() {
    return [
        'prepare-certificate',
        'setup-vercel',
        'trigger-deploy'
    ];
}

module.exports = {
    displayMainMenu,
    selectEnvironment,
    confirmExecution,
    confirmContinue,
    handleMenuError,
    showProgress,
    getMenuItem,
    getBatchMenuItems,
    MENU_ITEMS
};