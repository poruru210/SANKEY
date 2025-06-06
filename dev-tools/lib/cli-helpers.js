const readline = require('readline');
const { log, colors } = require('./logger');

/**
 * ユーザー選択関数（スタック組み合わせ用）
 * @param {Array} stackCombinations - スタック組み合わせ配列
 * @param {Object} options - オプション
 * @returns {Object} 選択されたスタック組み合わせ
 */
async function selectStackCombination(stackCombinations, options) {
    // 自動承認の場合
    if (options.requireApproval === 'never' && stackCombinations.length === 1) {
        log.info(`🚀 Auto-selecting: ${stackCombinations[0].environment.toUpperCase()} Environment`);
        return stackCombinations[0];
    }

    // ユーザー選択が必要
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
 * @param {Array} users - ユーザー配列
 * @param {Object} options - オプション
 * @returns {Object} 選択されたユーザー
 */
async function selectUser(users, options) {
    // 自動承認またはユーザーが1人の場合
    if ((options.requireApproval === 'never' && users.length === 1) || users.length === 1) {
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
 * @param {string} message - 確認メッセージ
 * @param {boolean} defaultValue - デフォルト値
 * @returns {boolean} ユーザーの回答
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
 * @param {string} message - プロンプトメッセージ
 * @param {string} defaultValue - デフォルト値
 * @returns {string} ユーザーの入力
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
 * @param {string} message - プロンプトメッセージ
 * @param {number} defaultValue - デフォルト値
 * @param {number} min - 最小値
 * @param {number} max - 最大値
 * @returns {number} ユーザーの入力数値
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
 * @param {string} message - プロンプトメッセージ
 * @param {Array} choices - 選択肢配列
 * @param {string} defaultValue - デフォルト値
 * @returns {string} 選択された値
 */
async function promptChoice(message, choices, defaultValue = null) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        // 選択肢表示
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
 * @param {Object} options - パースされたオプション
 * @param {Array} requiredOptions - 必須オプション配列
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

    /**
     * 経過時間を取得
     * @returns {number} 経過時間（ミリ秒）
     */
    elapsed() {
        return Date.now() - this.startTime;
    }

    /**
     * 経過時間を人間が読みやすい形式で取得
     * @returns {string} フォーマットされた経過時間
     */
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

    /**
     * 経過時間をログ出力
     * @param {string} message - メッセージ
     */
    log(message = 'Operation completed') {
        log.info(`${message} in ${this.elapsedFormatted()}`);
    }
}

module.exports = {
    selectStackCombination,
    selectUser,
    confirm,
    prompt,
    promptNumber,
    promptChoice,
    validateOptions,
    Timer
};