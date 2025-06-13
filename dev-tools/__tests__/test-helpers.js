/**
 * テスト用のヘルパー関数
 * モックの作成と管理を簡単にするユーティリティ
 */

/**
 * fetchのモックレスポンスを作成
 */
function createFetchResponse(data, options = {}) {
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
function createFetchError(message, status = 500) {
    return createFetchResponse(
        { error: { message } },
        { ok: false, status, statusText: message }
    );
}

/**
 * fs.promisesのモックを作成
 */
function createFsMock() {
    return {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        access: jest.fn(),
        mkdir: jest.fn(),
        unlink: jest.fn()
    };
}

/**
 * cryptoのモックを作成
 */
function createCryptoMock() {
    return {
        randomBytes: jest.fn((size) => ({
            toString: jest.fn((encoding) => {
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
function createLogMock() {
    return {
        info: jest.fn(),
        success: jest.fn(),
        warning: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        progress: jest.fn(),
        search: jest.fn(),
        generate: jest.fn(),
        database: jest.fn(),
        complete: jest.fn(),
        user: jest.fn(),
        email: jest.fn()
    };
}

/**
 * 環境変数のセットアップ
 */
function setupEnv(envVars = {}) {
    const originalEnv = process.env;
    process.env = { ...originalEnv, ...envVars };
    
    return () => {
        process.env = originalEnv;
    };
}

/**
 * モックのクリーンアップ
 */
function cleanupMocks(...mocks) {
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

module.exports = {
    createFetchResponse,
    createFetchError,
    createFsMock,
    createCryptoMock,
    createLogMock,
    setupEnv,
    cleanupMocks
};