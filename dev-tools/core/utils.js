/**
 * 統合版ユーティリティモジュール
 * logger + cli-helpers + interactive-menu を統合
 */

const readline = require('readline');
const { ENVIRONMENTS, APPROVAL_MODES } = require('./constants');
const { BaseError, ConfigurationError, ApiError, CdkNotDeployedError, ResourceNotFoundError } = require('./errors');

// ============================================================
// ログ機能 (旧 logger.js)
// ============================================================

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
    info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
    warning: (msg) => console.log(`${colors.yellow}⚠️${colors.reset} ${msg}`),
    error: (msg) => console.error(`${colors.red}❌${colors.reset} ${msg}`),
    debug: (msg, options) => {
        if (options?.debug) {
            console.log(`${colors.gray}🔍 DEBUG:${colors.reset} ${msg}`);
        }
    },
    progress: (msg) => console.log(`${colors.yellow}🔄${colors.reset} ${msg}`),
    search: (msg) => console.log(`${colors.blue}🔍${colors.reset} ${msg}`),
    generate: (msg) => console.log(`${colors.magenta}🎲${colors.reset} ${msg}`),
    database: (msg) => console.log(`${colors.blue}📊${colors.reset} ${msg}`),
    complete: (msg) => console.log(`${colors.green}🎉${colors.reset} ${msg}`),
    user: (msg) => console.log(`${colors.cyan}👤${colors.reset} ${msg}`),
    email: (msg) => console.log(`${colors.yellow}📧${colors.reset} ${msg}`)
};

/**
 * タイトル表示関数
 */
function displayTitle(title, color = 'green') {
    const colorCode = colors[color] || colors.green;
    console.log(`${colorCode}=== ${title} ===${colors.reset}`);
}

/**
 * セクション表示関数
 */
function displaySection(section, color = 'cyan') {
    const colorCode = colors[color] || colors.cyan;
    console.log(`\n${colorCode}📋 ${section}:${colors.reset}`);
}

/**
 * ユーザー一覧表示関数
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

// ============================================================
// CLI ヘルパー機能 (旧 cli-helpers.js)
// ============================================================

/**
 * ユーザー選択関数（スタック組み合わせ用）
 */
async function selectStackCombination(stackCombinations, options) {
    // 自動承認の場合
    if (options.requireApproval === APPROVAL_MODES.NEVER && stackCombinations.length === 1) {
        log.info(`🚀 Auto-selecting: ${stackCombinations[0].environment.toUpperCase()} Environment`);
        return stackCombinations[0];
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        console.log(''); // 空行

        const answer = await new Promise((resolve) => {
            rl.question(`Please select a combination (1-${stackCombinations.length}): `, resolve);
        });

        const selection = parseInt(answer.trim());

        if (isNaN(selection) || selection < 1 || selection > stackCombinations.length) {
            throw new Error(`Invalid selection: ${answer}. Please enter a number between 1 and ${stackCombinations.length}.`);
        }

        const selectedCombination = stackCombinations[selection - 1];
        log.success(`Selected: ${selectedCombination.environment.toUpperCase()} Environment`);

        return selectedCombination;

    } finally {
        rl.close();
    }
}

/**
 * ユーザー選択関数（Cognitoユーザー用）
 */
async function selectUser(users, options) {
    // 自動承認またはユーザーが1人の場合
    if ((options.requireApproval === APPROVAL_MODES.NEVER && users.length === 1) || users.length === 1) {
        log.info(`🚀 Auto-selecting user: ${users[0].email}`);
        return users[0];
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        console.log(''); // 空行

        const answer = await new Promise((resolve) => {
            rl.question(`Please select a user (1-${users.length}): `, resolve);
        });

        const selection = parseInt(answer.trim());

        if (isNaN(selection) || selection < 1 || selection > users.length) {
            throw new Error(`Invalid selection: ${answer}. Please enter a number between 1 and ${users.length}.`);
        }

        const selectedUser = users[selection - 1];
        log.success(`Selected user: ${selectedUser.email} (${selectedUser.userId})`);

        return selectedUser;

    } finally {
        rl.close();
    }
}

/**
 * 確認プロンプト関数
 */
async function confirm(message, defaultValue = false) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const defaultText = defaultValue ? '[Y/n]' : '[y/N]';
        const answer = await new Promise((resolve) => {
            rl.question(`${message} ${defaultText}: `, resolve);
        });

        const trimmed = answer.trim().toLowerCase();

        if (trimmed === '') {
            return defaultValue;
        }

        return trimmed === 'y' || trimmed === 'yes';

    } finally {
        rl.close();
    }
}

/**
 * 入力プロンプト関数
 */
async function prompt(message, defaultValue = '') {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const defaultText = defaultValue ? ` (default: ${defaultValue})` : '';
        const answer = await new Promise((resolve) => {
            rl.question(`${message}${defaultText}: `, resolve);
        });

        return answer.trim() || defaultValue;

    } finally {
        rl.close();
    }
}

/**
 * 数値入力プロンプト関数
 */
async function promptNumber(message, defaultValue = 0, min = 0, max = Infinity) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        while (true) {
            const defaultText = defaultValue !== undefined ? ` (default: ${defaultValue})` : '';
            const rangeText = max !== Infinity ? ` [${min}-${max}]` : ` [${min}+]`;

            const answer = await new Promise((resolve) => {
                rl.question(`${message}${rangeText}${defaultText}: `, resolve);
            });

            if (answer.trim() === '' && defaultValue !== undefined) {
                return defaultValue;
            }

            const number = parseInt(answer.trim());

            if (isNaN(number)) {
                log.error('Please enter a valid number.');
                continue;
            }

            if (number < min || number > max) {
                log.error(`Please enter a number between ${min} and ${max}.`);
                continue;
            }

            return number;
        }

    } finally {
        rl.close();
    }
}

/**
 * 選択肢プロンプト関数
 */
async function promptChoice(message, choices, defaultValue = null) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        console.log(`\n${message}`);
        choices.forEach((choice, index) => {
            const marker = choice === defaultValue ? ' (default)' : '';
            console.log(`  ${index + 1}. ${choice}${marker}`);
        });

        while (true) {
            const answer = await new Promise((resolve) => {
                rl.question(`Please select (1-${choices.length}): `, resolve);
            });

            if (answer.trim() === '' && defaultValue !== null) {
                return defaultValue;
            }

            const selection = parseInt(answer.trim());

            if (isNaN(selection) || selection < 1 || selection > choices.length) {
                log.error(`Please enter a number between 1 and ${choices.length}.`);
                continue;
            }

            return choices[selection - 1];
        }

    } finally {
        rl.close();
    }
}

/**
 * コマンドライン引数の検証
 */
function validateOptions(options, requiredOptions = []) {
    const missing = [];

    for (const required of requiredOptions) {
        if (!options[required]) {
            missing.push(required);
        }
    }

    if (missing.length > 0) {
        log.error(`Missing required options: ${missing.join(', ')}`);
        process.exit(1);
    }
}

/**
 * 実行時間測定ユーティリティ
 */
class Timer {
    constructor() {
        this.startTime = Date.now();
    }

    elapsed() {
        return Date.now() - this.startTime;
    }

    elapsedFormatted() {
        const elapsed = this.elapsed();

        if (elapsed < 1000) {
            return `${elapsed}ms`;
        } else if (elapsed < 60000) {
            return `${(elapsed / 1000).toFixed(1)}s`;
        } else {
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            return `${minutes}m ${seconds}s`;
        }
    }
}

// ============================================================
// インタラクティブメニュー機能 (旧 interactive-menu-module.js)
// ============================================================

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
        description: 'Execute steps 1-4 in sequence (excluding test data)'
    },
    {
        id: 'generate-env-local',
        label: '📝 Generate .env.local (Local Development)',
        description: 'Create local environment file for development'
    },
    {
        id: 'generate-test-data',
        label: '🎲 Generate Test Data (DynamoDB)',
        description: 'Create, delete, or reset test data in DynamoDB tables'
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

    moveUp() {
        this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
    }

    moveDown() {
        this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
    }

    render(context) {
        console.clear();
        
        displayTitle('Sankey Environment Setup', 'cyan');
        console.log('━'.repeat(40));
        console.log(`AWS Profile: ${colors.green}${context.profile}${colors.reset}`);
        if (context.region) {
            console.log(`AWS Region: ${colors.green}${context.region}${colors.reset}`);
        }
        console.log('');
        console.log('Use ↑↓ arrows to navigate, Enter to select, Esc to exit');
        console.log('Or press 1-8 to select directly');
        console.log('');

        this.items.forEach((item, index) => {
            const isSelected = index === this.selectedIndex;
            const prefix = isSelected ? `${colors.cyan}▶${colors.reset} ` : '  ';
            const number = `${colors.yellow}${index + 1}.${colors.reset}`;
            const label = isSelected ? `${colors.bright}${item.label}${colors.reset}` : item.label;
            
            console.log(`${prefix}${number} ${label}`);
            
            if (isSelected && item.description) {
                console.log(`     ${colors.gray}${item.description}${colors.reset}`);
            }
        });
    }

    cleanup() {
        process.stdout.write('\x1B[?25h');
        
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        
        process.stdin.removeAllListeners('keypress');
        
        if (this.rl) {
            this.rl.close();
        }
    }
}

/**
 * メインメニュー表示
 */
async function displayMainMenu(context) {
    try {
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
        await new Promise((resolve) => {
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
    } else if (error instanceof BaseError) {
        log.error(`❌ An operation failed: ${error.message}`);
        if (error.cause) log.warning(`Cause: ${error.cause.message || error.cause}`);
    } else {
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

// エクスポート
module.exports = {
    // ログ機能
    log,
    colors,
    displayTitle,
    displaySection,
    displayUserList,
    displayProgress,
    
    // CLIヘルパー機能
    selectStackCombination,
    selectUser,
    confirm,
    prompt,
    promptNumber,
    promptChoice,
    validateOptions,
    Timer,
    
    // メニュー機能
    displayMainMenu,
    selectEnvironment,
    confirmExecution,
    confirmContinue,
    handleMenuError,
    showProgress,
    getBatchMenuItems
};