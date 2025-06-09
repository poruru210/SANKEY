const readline = require('readline');
const { log, colors, displayTitle } = require('../lib/logger');
const { ENVIRONMENTS } = require('../lib/constants');
const { BaseError, ConfigurationError, ApiError, CdkNotDeployedError, ResourceNotFoundError } = require('../lib/errors');

/**
 * カーソル選択可能なインタラクティブメニューモジュール
 */

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
        id: 'setup-custom-domain',
        label: '🌐 Setup Custom Domain DNS',
        description: 'Configure DNS for API Gateway custom domain'
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
 * インタラクティブメニュー表示とカーソル選択
 */
class InteractiveMenu {
    constructor(items) {
        this.items = items;
        this.selectedIndex = 0;
        this.rl = null;
    }

    /**
     * メニューを表示して選択を待つ
     */
    async show(context) {
        return new Promise((resolve) => {
            this.rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            // カーソルを非表示
            process.stdout.write('\x1B[?25l');

            // キー入力のハンドリング
            readline.emitKeypressEvents(process.stdin, this.rl);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
            }

            // 初回描画
            this.render(context);

            // キーイベントリスナー
            process.stdin.on('keypress', (str, key) => {
                if (key.name === 'up') {
                    this.moveUp();
                    this.render(context);
                } else if (key.name === 'down') {
                    this.moveDown();
                    this.render(context);
                } else if (key.name === 'return' || key.name === 'enter') {
                    this.cleanup();
                    resolve(this.items[this.selectedIndex]);
                } else if (key.ctrl && key.name === 'c') {
                    this.cleanup();
                    process.exit(0);
                } else if (key.name === 'escape') {
                    this.cleanup();
                    resolve(this.items.find(item => item.id === 'exit'));
                }
                // 数字キーでの直接選択もサポート
                else if (str && str >= '1' && str <= '9') {
                    const index = parseInt(str) - 1;
                    if (index < this.items.length) {
                        this.selectedIndex = index;
                        this.cleanup();
                        resolve(this.items[this.selectedIndex]);
                    }
                }
            });
        });
    }

    /**
     * カーソルを上に移動
     */
    moveUp() {
        this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
    }

    /**
     * カーソルを下に移動
     */
    moveDown() {
        this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
    }

    /**
     * メニューを描画
     */
    render(context) {
        // 画面クリア
        console.clear();
        
        // タイトル表示
        displayTitle('Sankey Environment Setup', 'cyan');
        console.log('━'.repeat(40));
        console.log(`AWS Profile: ${colors.green}${context.profile}${colors.reset}`);
        if (context.region) {
            console.log(`AWS Region: ${colors.green}${context.region}${colors.reset}`);
        }
        console.log('');
        console.log('Use ↑↓ arrows to navigate, Enter to select, Esc to exit');
        console.log('Or press 1-6 to select directly');
        console.log('');

        // メニュー項目表示
        this.items.forEach((item, index) => {
            const isSelected = index === this.selectedIndex;
            const prefix = isSelected ? `${colors.cyan}▶${colors.reset} ` : '  ';
            const number = `${colors.yellow}${index + 1}.${colors.reset}`;
            const label = isSelected ? `${colors.bright}${item.label}${colors.reset}` : item.label;
            
            console.log(`${prefix}${number} ${label}`);
            
            // 選択中の項目の説明を表示
            if (isSelected && item.description) {
                console.log(`     ${colors.gray}${item.description}${colors.reset}`);
            }
        });
    }

    /**
     * クリーンアップ
     */
    cleanup() {
        // カーソルを表示
        process.stdout.write('\x1B[?25h');
        
        // Rawモードを解除
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        
        // リスナーを削除
        process.stdin.removeAllListeners('keypress');
        
        // readline インターフェースを閉じる
        if (this.rl) {
            this.rl.close();
        }
    }
}

/**
 * メインメニュー表示（カーソル選択版）
 */
async function displayMainMenu(context) {
    try {
        // TTYチェック（CI環境などでは数値入力にフォールバック）
        if (!process.stdin.isTTY) {
            log.info('Non-interactive environment detected. Using number selection.');
            return await displayMainMenuFallback(context);
        }

        const menu = new InteractiveMenu(MENU_ITEMS);
        const selected = await menu.show(context);
        
        console.log('');
        log.info(`Selected: ${selected.label}`);
        console.log('');
        
        return selected.id;
        
    } catch (error) {
        // エラー時は数値入力にフォールバック
        log.warning('Interactive menu failed, falling back to number selection');
        return await displayMainMenuFallback(context);
    }
}

/**
 * フォールバック用の数値入力メニュー
 */
async function displayMainMenuFallback(context) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
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

        const answer = await new Promise((resolve) => {
            rl.question(`Please select an option (1-${MENU_ITEMS.length}): `, resolve);
        });

        const selection = parseInt(answer.trim());

        if (isNaN(selection) || selection < 1 || selection > MENU_ITEMS.length) {
            log.error(`Invalid selection. Please enter a number between 1 and ${MENU_ITEMS.length}.`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return await displayMainMenuFallback(context);
        }

        const selectedItem = MENU_ITEMS[selection - 1];
        console.log('');
        log.info(`Selected: ${selectedItem.label}`);
        console.log('');

        return selectedItem.id;

    } finally {
        rl.close();
    }
}

/**
 * 環境選択メニュー
 */
async function selectEnvironment(context) {
    const environments = [
        { id: ENVIRONMENTS.DEV, label: `Development (${ENVIRONMENTS.DEV})`, description: 'For testing and development' },
        { id: ENVIRONMENTS.PROD, label: `Production (${ENVIRONMENTS.PROD})`, description: 'Live production environment' }
    ];

    try {
        if (!process.stdin.isTTY) {
            return await selectEnvironmentFallback(context);
        }

        const menu = new InteractiveMenu(environments);
        const selected = await menu.show({
            ...context,
            profile: `${context.profile} - Select Environment`
        });

        log.info(`Selected environment: ${selected.label}`);
        return selected.id;

    } catch (error) {
        return await selectEnvironmentFallback(context);
    }
}

/**
 * 環境選択フォールバック
 */
async function selectEnvironmentFallback(context) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        console.log(`${colors.cyan}Select target environment:${colors.reset}`);
        console.log(`  ${colors.yellow}1.${colors.reset} Development (${ENVIRONMENTS.DEV})`);
        console.log(`  ${colors.yellow}2.${colors.reset} Production (${ENVIRONMENTS.PROD})`);
        console.log('');

        const answer = await new Promise((resolve) => {
            rl.question('Please select environment (1-2): ', resolve);
        });

        const selection = parseInt(answer.trim());

        if (selection === 1) {
            return ENVIRONMENTS.DEV;
        } else if (selection === 2) {
            return ENVIRONMENTS.PROD;
        } else {
            log.error('Invalid selection. Please enter 1 or 2.');
            await new Promise(resolve => setTimeout(resolve, 1500));
            return await selectEnvironmentFallback(context);
        }

    } finally {
        rl.close();
    }
}

/**
 * 実行確認プロンプト
 */
async function confirmExecution(action, details = {}) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        console.log(`${colors.yellow}⚠️  Confirm Execution:${colors.reset}`);
        console.log(`   Action: ${action}`);
        
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
 */
async function handleMenuError(error, options = {}) {
    if (error instanceof CdkNotDeployedError) {
        log.error(`❌ CDK Setup Incomplete: ${error.message}`);
        log.warning(`Environment: ${error.environment || 'N/A'}`);
        if (error.missingResources && error.missingResources.length > 0) {
            log.warning(`Missing: ${error.missingResources.join(', ')}`);
        }
        log.info("Please ensure CDK resources are deployed before running this operation.");
    } else if (error instanceof ConfigurationError) {
        log.error(`❌ Configuration Error: ${error.message}`);
        if (error.cause) log.warning(`Cause: ${error.cause.message || error.cause}`);
        log.info("Please check your environment variables and configuration files.");
    } else if (error instanceof ApiError) {
        log.error(`❌ API Error (${error.serviceName || 'Unknown Service'}): ${error.message}`);
        if (error.statusCode) log.warning(`Status Code: ${error.statusCode}`);
        if (error.cause) log.warning(`Cause: ${error.cause.message || error.cause}`);
    } else if (error instanceof ResourceNotFoundError) {
        log.error(`❌ Resource Not Found: ${error.message}`);
    } else if (error instanceof BaseError) { // Catch any other custom errors
        log.error(`❌ An operation failed: ${error.message}`);
        if (error.cause) log.warning(`Cause: ${error.cause.message || error.cause}`);
    }
     else {
        log.error(`An unexpected error occurred: ${error.message}`);
    }

    if (options.showStack && error.stack) {
        console.error('\n🔍 Stack trace:');
        console.error(error.stack);
    }
    await confirmContinue();
}

/**
 * 進捗表示ヘルパー
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
 */
function getMenuItem(menuId) {
    return MENU_ITEMS.find(item => item.id === menuId);
}

/**
 * バッチ実行用のメニューID配列取得
 */
function getBatchMenuItems() {
    return [
        'prepare-certificate',
        'setup-custom-domain',
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