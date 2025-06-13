/**
 * core/utils.js のテストスイート
 * TDDアプローチ: まずテストを作成し、実装が期待通りに動作することを確認
 */

const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const readline = require('readline');

// jestオブジェクトはグローバルで利用可能なので、個別にインポートする必要はありません
// const { jest } = require('@jest/globals'); // この行を削除

// テスト対象のモジュール（まだ実装されていないものも含む）
const {
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
}  = require('../../core/utils');

// モック設定
jest.mock('readline');

describe('ログ機能', () => {
    let consoleLogSpy;
    let consoleErrorSpy;
    let stdoutWriteSpy;

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('log オブジェクト', () => {
        test('info() は情報メッセージを適切なフォーマットで出力する', () => {
            const message = 'Test info message';
            log.info(message);
            
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('ℹ')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining(message)
            );
        });

        test('success() は成功メッセージを適切なフォーマットで出力する', () => {
            const message = 'Test success message';
            log.success(message);
            
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('✅')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining(message)
            );
        });

        test('warning() は警告メッセージを適切なフォーマットで出力する', () => {
            const message = 'Test warning message';
            log.warning(message);
            
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('⚠️')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining(message)
            );
        });

        test('error() はエラーメッセージを適切なフォーマットで出力する', () => {
            const message = 'Test error message';
            log.error(message);
            
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('❌')
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining(message)
            );
        });

        test('debug() はdebugオプションがtrueの時のみメッセージを出力する', () => {
            const message = 'Test debug message';
            
            // debugオプションがfalseまたは未定義の場合
            log.debug(message, { debug: false });
            expect(consoleLogSpy).not.toHaveBeenCalled();
            
            log.debug(message, {});
            expect(consoleLogSpy).not.toHaveBeenCalled();
            
            // debugオプションがtrueの場合
            log.debug(message, { debug: true });
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('🔍 DEBUG:')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining(message)
            );
        });
    });

    describe('displayTitle()', () => {
        test('デフォルトの色（緑）でタイトルを表示する', () => {
            displayTitle('Test Title');
            
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringMatching(/=== Test Title ===/)
            );
        });

        test('指定された色でタイトルを表示する', () => {
            displayTitle('Test Title', 'red');
            
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('=== Test Title ===')
            );
        });

        test('無効な色が指定された場合はデフォルトの色を使用する', () => {
            displayTitle('Test Title', 'invalid-color');
            
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('=== Test Title ===')
            );
        });
    });

    describe('displayProgress()', () => {
        test('プログレスバーを正しく表示する', () => {
            displayProgress(50, 100, 'Test Progress');
            
            const output = stdoutWriteSpy.mock.calls[0][0];
            expect(output).toContain('Test Progress');
            expect(output).toContain('[');
            expect(output).toContain(']');
            expect(output).toContain('50%');
            expect(output).toContain('(50/100)');
        });

        test('完了時に改行を追加する', () => {
            displayProgress(100, 100, 'Complete');
            
            expect(stdoutWriteSpy).toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith('');
        });
    });
});

describe('CLIヘルパー機能', () => {
    let mockInterface;

    beforeEach(() => {
        mockInterface = {
            question: jest.fn(),
            close: jest.fn()
        };
        readline.createInterface.mockReturnValue(mockInterface);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Timer クラス', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('経過時間を正しく計測する', () => {
            const timer = new Timer();
            
            jest.advanceTimersByTime(1500);
            expect(timer.elapsed()).toBe(1500);
        });

        test('elapsedFormatted() が適切なフォーマットで時間を返す', () => {
            const timer = new Timer();
            
            // ミリ秒表示
            jest.advanceTimersByTime(500);
            expect(timer.elapsedFormatted()).toBe('500ms');
            
            // 秒表示
            jest.advanceTimersByTime(1500); // 合計2000ms
            expect(timer.elapsedFormatted()).toBe('2.0s');
            
            // 分秒表示
            jest.advanceTimersByTime(58000); // 合計60000ms = 1分
            expect(timer.elapsedFormatted()).toBe('1m 0s');
        });
    });

    describe('validateOptions()', () => {
        test('必須オプションが存在する場合は正常に動作する', () => {
            const mockExit = jest.spyOn(process, 'exit').mockImplementation();
            
            const options = { profile: 'test-profile', region: 'us-west-2' };
            validateOptions(options, ['profile']);
            
            expect(mockExit).not.toHaveBeenCalled();
            mockExit.mockRestore();
        });

        test('必須オプションが欠けている場合はエラーを出力してexitする', () => {
            const mockExit = jest.spyOn(process, 'exit').mockImplementation();
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
            
            const options = { region: 'us-west-2' };
            validateOptions(options, ['profile']);
            
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Missing required options: profile')
            );
            expect(mockExit).toHaveBeenCalledWith(1);
            
            mockExit.mockRestore();
            consoleErrorSpy.mockRestore();
        });
    });

    describe('confirm()', () => {
        test('ユーザーが "y" を入力した場合 true を返す', async () => {
            mockInterface.question.mockImplementationOnce((query, callback) => {
                expect(query).toContain('Test confirmation');
                callback('y');
            });

            const result = await confirm('Test confirmation');
            expect(result).toBe(true);
            expect(mockInterface.close).toHaveBeenCalled();
        });

        test('ユーザーが "n" を入力した場合 false を返す', async () => {
            mockInterface.question.mockImplementationOnce((query, callback) => {
                callback('n');
            });

            const result = await confirm('Test confirmation');
            expect(result).toBe(false);
        });

        test('ユーザーが何も入力しなかった場合、デフォルト値を返す', async () => {
            mockInterface.question.mockImplementationOnce((query, callback) => {
                callback('');
            });

            const result = await confirm('Test confirmation', true);
            expect(result).toBe(true);
        });
    });

    describe('prompt()', () => {
        test('ユーザーの入力を返す', async () => {
            const userInput = 'test input';
            mockInterface.question.mockImplementationOnce((query, callback) => {
                callback(userInput);
            });

            const result = await prompt('Enter value');
            expect(result).toBe(userInput);
        });

        test('空の入力の場合、デフォルト値を返す', async () => {
            mockInterface.question.mockImplementationOnce((query, callback) => {
                callback('');
            });

            const result = await prompt('Enter value', 'default');
            expect(result).toBe('default');
        });
    });

    describe('promptNumber()', () => {
        test('有効な数値を返す', async () => {
            mockInterface.question.mockImplementationOnce((query, callback) => {
                callback('42');
            });

            const result = await promptNumber('Enter number', 0, 0, 100);
            expect(result).toBe(42);
        });

        test('範囲外の数値の場合、再度プロンプトを表示する', async () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
            
            mockInterface.question
                .mockImplementationOnce((query, callback) => callback('150'))
                .mockImplementationOnce((query, callback) => callback('50'));

            const result = await promptNumber('Enter number', 0, 0, 100);
            expect(result).toBe(50);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Please enter a number between 0 and 100')
            );
            
            consoleErrorSpy.mockRestore();
        });
    });
});

describe('メニュー機能', () => {
    describe('getBatchMenuItems()', () => {
        test('バッチ実行用のメニューIDの配列を返す', () => {
            const items = getBatchMenuItems();
            
            expect(items).toEqual([
                'prepare-certificate',
                'setup-custom-domain',
                'setup-vercel',
                'trigger-deploy'
            ]);
        });
    });

    describe('showProgress()', () => {
        let consoleLogSpy;
        let consoleClearSpy;

        beforeEach(() => {
            consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
            consoleClearSpy = jest.spyOn(console, 'clear').mockImplementation();
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('進捗メッセージを表示する', () => {
            showProgress('Processing...');
            
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('🔄')
            );
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Processing...')
            );
        });

        test('clearオプションがtrueの場合、画面をクリアしてタイトルを表示する', () => {
            showProgress('Processing...', { clear: true });
            
            expect(consoleClearSpy).toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('Sankey Environment Setup')
            );
        });
    });
});

describe('エラーハンドリング', () => {
    let consoleLogSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('handleMenuError()', () => {
        test('基本的なエラーを適切に表示する', async () => {
            const mockInterface = {
                question: jest.fn((query, callback) => callback('')),
                close: jest.fn()
            };
            readline.createInterface = jest.fn().mockReturnValue(mockInterface);

            const error = new Error('Test error');
            await handleMenuError(error);
            
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('An unexpected error occurred: Test error')
            );
        });

        test('showStackオプションがtrueの場合、スタックトレースを表示する', async () => {
            const mockInterface = {
                question: jest.fn((query, callback) => callback('')),
                close: jest.fn()
            };
            readline.createInterface = jest.fn().mockReturnValue(mockInterface);

            const error = new Error('Test error');
            await handleMenuError(error, { showStack: true });
            
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Stack trace:')
            );
        });
    });
});