import { vi } from 'vitest';

/**
 * テスト用のヘルパー関数
 * モックの作成と管理を簡単にするユーティリティ
 */

/**
 * fetchのモックレスポンスを作成
 */
export function createFetchResponse(data, options = {}) {
    const { ok = true, status = 200, statusText = 'OK' } = options;
    
    return {
        ok,
        status,
        statusText,
        json: async () => {
            if (options.jsonError) {
                throw new Error(options.jsonError);
            }
            return data;
        },
        text: async () => JSON.stringify(data)
    };
}

/**
 * fetchのエラーレスポンスを作成
 */
export function createFetchError(message, status = 500) {
    return createFetchResponse(
        { error: { message } },
        { ok: false, status, statusText: message }
    );
}

/**
 * fs.promisesのモックを作成
 */
export function createFsMock() {
    return {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        access: vi.fn(),
        mkdir: vi.fn(),
        unlink: vi.fn()
    };
}

/**
 * cryptoのモックを作成
 */
export function createCryptoMock() {
    return {
        randomBytes: vi.fn((size) => ({
            toString: vi.fn((encoding) => {
                if (encoding === 'base64') {
                    return Buffer.from('test-random-bytes').toString('base64');
                }
                return 'test-random-bytes';
            })
        }))
    };
}

/**
 * logモジュールのモックを作成
 */
export function createLogMock() {
    return {
        info: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        progress: vi.fn(),
        search: vi.fn(),
        generate: vi.fn(),
        database: vi.fn(),
        complete: vi.fn(),
        user: vi.fn(),
        email: vi.fn()
    };
}

/**
 * 環境変数のセットアップ
 */
export function setupEnv(envVars = {}) {
    const originalEnv = process.env;
    process.env = { ...originalEnv, ...envVars };
    
    return () => {
        process.env = originalEnv;
    };
}

/**
 * モックのクリーンアップ
 */
export function cleanupMocks(...mocks) {
    mocks.forEach(mock => {
        if (mock && typeof mock === 'object') {
            Object.values(mock).forEach(fn => {
                if (typeof fn === 'function' && fn.mockClear) {
                    fn.mockClear();
                }
            });
        }
    });
}