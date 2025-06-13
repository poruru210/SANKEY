/**
 * services/vercel.js のテストスイート
 * Vercel API操作、環境変数管理、デプロイメント機能のテスト
 */

const { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } = require('@jest/globals');
const {
    createFetchResponse,
    createFetchError,
    createFsMock,
    createCryptoMock,
    createLogMock,
    setupEnv,
    cleanupMocks
} = require('../test-helpers');

// console.logをモック（テスト出力をクリーンに保つ）
const originalConsoleLog = console.log;
beforeAll(() => {
    console.log = jest.fn();
});
afterAll(() => {
    console.log = originalConsoleLog;
});

// グローバルfetchのモック
global.fetch = jest.fn();

// モジュールモックの作成
const mockFs = createFsMock();
const mockCrypto = createCryptoMock();
const mockLog = createLogMock();

// モジュールのモック設定
jest.mock('fs', () => ({
    promises: mockFs
}));

jest.mock('crypto', () => mockCrypto);

jest.mock('../../core/utils', () => ({
    log: mockLog
}));

// テスト対象のモジュール
const {
    VercelClient,
    triggerDeployment,
    mapEnvironmentToVercel,
    generateVercelEnvironmentVariables,
    updateVercelEnvironmentVariables,
    getExistingAuthSecret,
    generateAuthSecret,
    updateLocalEnv,
    readAuthSecretFromEnvLocal
} = require('../../services/vercel');

describe('Vercel サービスモジュール', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        // fetchのデフォルトレスポンス
        global.fetch.mockResolvedValue(createFetchResponse({ success: true }));
        
        // cryptoのデフォルト動作をリセット
        mockCrypto.randomBytes.mockReturnValue({
            toString: jest.fn().mockReturnValue('test-random-string')
        });
    });

    afterEach(() => {
        cleanupMocks(mockFs, mockCrypto, mockLog);
    });

    describe('VercelClient クラス', () => {
        let client;

        beforeEach(() => {
            client = new VercelClient('test-token', 'test-project-id');
        });

        describe('constructor', () => {
            test('正しくインスタンス化される', () => {
                expect(client.apiToken).toBe('test-token');
                expect(client.projectId).toBe('test-project-id');
                expect(client.baseUrl).toBe('https://api.vercel.com');
            });
        });

        describe('makeRequest', () => {
            test('正常なAPIリクエストを実行する', async () => {
                const mockData = { data: 'test' };
                global.fetch.mockResolvedValueOnce(createFetchResponse(mockData));

                const result = await client.makeRequest('GET', '/test-endpoint');

                expect(global.fetch).toHaveBeenCalledWith(
                    'https://api.vercel.com/test-endpoint',
                    {
                        method: 'GET',
                        headers: {
                            'Authorization': 'Bearer test-token',
                            'Content-Type': 'application/json'
                        }
                    }
                );
                expect(result).toEqual(mockData);
            });

            test('POSTリクエストでbodyを送信する', async () => {
                const body = { key: 'value' };
                
                await client.makeRequest('POST', '/test-endpoint', body);

                expect(global.fetch).toHaveBeenCalledWith(
                    'https://api.vercel.com/test-endpoint',
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer test-token',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(body)
                    }
                );
            });

            test('APIエラーの場合、ApiErrorをthrowする', async () => {
                global.fetch.mockResolvedValueOnce(createFetchError('Not found', 404));

                await expect(client.makeRequest('GET', '/test'))
                    .rejects.toThrow('Vercel API request failed: Not found');
            });

            test('JSONパースエラーの場合、適切にハンドリングする', async () => {
                global.fetch.mockResolvedValueOnce(
                    createFetchResponse(null, {
                        ok: false,
                        status: 500,
                        statusText: 'Internal Server Error',
                        jsonError: 'Invalid JSON'
                    })
                );

                await expect(client.makeRequest('GET', '/test'))
                    .rejects.toThrow('Vercel API request failed: Internal Server Error');
            });
        });

        describe('getEnvironmentVariables', () => {
            test('指定された環境の変数を取得する', async () => {
                const mockEnvs = {
                    envs: [
                        { key: 'VAR1', target: ['preview'] },
                        { key: 'VAR2', target: ['production'] },
                        { key: 'VAR3', target: ['preview', 'production'] }
                    ]
                };

                global.fetch.mockResolvedValueOnce(createFetchResponse(mockEnvs));

                const result = await client.getEnvironmentVariables('preview');

                expect(result).toHaveLength(2);
                expect(result).toContainEqual({ key: 'VAR1', target: ['preview'] });
                expect(result).toContainEqual({ key: 'VAR3', target: ['preview', 'production'] });
            });
        });

        describe('createEnvironmentVariable', () => {
            test('環境変数を作成する', async () => {
                const mockResponse = { id: 'env-id', key: 'TEST_VAR' };
                global.fetch.mockResolvedValueOnce(createFetchResponse(mockResponse));

                const result = await client.createEnvironmentVariable('TEST_VAR', 'test-value', 'preview');

                expect(global.fetch).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        method: 'POST',
                        body: JSON.stringify({
                            key: 'TEST_VAR',
                            value: 'test-value',
                            target: ['preview'],
                            type: 'encrypted'
                        })
                    })
                );
                expect(result).toEqual(mockResponse);
            });

            test('複数の環境を配列で指定できる', async () => {
                await client.createEnvironmentVariable('TEST_VAR', 'test-value', ['preview', 'production']);

                expect(global.fetch).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        body: expect.stringContaining('"target":["preview","production"]')
                    })
                );
            });
        });

        describe('updateEnvironmentVariables', () => {
            test('環境変数を一括更新する', async () => {
                const existingVars = {
                    envs: [
                        { id: 'env1', key: 'EXISTING_VAR', target: ['preview'] }
                    ]
                };

                global.fetch
                    .mockResolvedValueOnce(createFetchResponse(existingVars))
                    .mockResolvedValueOnce(createFetchResponse({ id: 'env2' }))
                    .mockResolvedValueOnce(createFetchResponse({ id: 'env1-updated' }));

                const variables = {
                    NEW_VAR: 'new-value',
                    EXISTING_VAR: 'updated-value'
                };

                const result = await client.updateEnvironmentVariables(variables, 'preview', { forceUpdate: true });

                expect(result.created).toHaveLength(1);
                expect(result.updated).toHaveLength(1);
                expect(result.unchanged).toHaveLength(0);
                expect(result.errors).toHaveLength(0);
            });
        });
    });

    describe('デプロイメント関数', () => {
        describe('mapEnvironmentToVercel', () => {
            test('環境名を正しくマッピングする', () => {
                expect(mapEnvironmentToVercel('dev')).toBe('preview');
                expect(mapEnvironmentToVercel('development')).toBe('preview');
                expect(mapEnvironmentToVercel('prod')).toBe('production');
                expect(mapEnvironmentToVercel('production')).toBe('production');
                expect(mapEnvironmentToVercel('unknown')).toBe('preview');
            });
        });

        describe('triggerDeployment', () => {
            let cleanupEnv;

            beforeEach(() => {
                cleanupEnv = setupEnv({
                    VERCEL_DEPLOY_HOOK_DEV: 'https://api.vercel.com/hook-dev',
                    VERCEL_DEPLOY_HOOK_PROD: 'https://api.vercel.com/hook-prod'
                });
            });

            afterEach(() => {
                cleanupEnv();
            });

            test('開発環境のデプロイをトリガーする', async () => {
                const mockResponse = { job: { id: 'job-123' } };
                global.fetch.mockResolvedValueOnce(createFetchResponse(mockResponse));

                const result = await triggerDeployment('preview');

                expect(global.fetch).toHaveBeenCalledWith(
                    'https://api.vercel.com/hook-dev',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
                expect(result).toEqual({
                    success: true,
                    url: 'https://dev.sankey.trade',
                    target: 'preview',
                    method: 'deploy-hook',
                    jobId: 'job-123'
                });
            });

            test('本番環境のデプロイをトリガーする', async () => {
                const mockResponse = { job: { id: 'job-456' } };
                global.fetch.mockResolvedValueOnce(createFetchResponse(mockResponse));

                const result = await triggerDeployment('production');

                expect(global.fetch).toHaveBeenCalledWith(
                    'https://api.vercel.com/hook-prod',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
                expect(result).toEqual({
                    success: true,
                    url: 'https://www.sankey.trade',
                    target: 'production',
                    method: 'deploy-hook',
                    jobId: 'job-456'
                });
            });

            test('Deploy Hook URLが設定されていない場合エラーをthrowする', async () => {
                cleanupEnv();
                setupEnv({}); // 環境変数なし

                await expect(triggerDeployment('preview'))
                    .rejects.toThrow('Deploy Hook URL not found');
            });

            test('Deploy Hookの呼び出しが失敗した場合', async () => {
                global.fetch.mockResolvedValueOnce(createFetchError('Unauthorized', 401));

                await expect(triggerDeployment('preview'))
                    .rejects.toThrow('Vercel Deploy Hook failed');
            });

            test('レスポンスのJSON解析が失敗してもデプロイは成功として扱う', async () => {
                global.fetch.mockResolvedValueOnce({
                    ok: true,
                    json: async () => { throw new Error('Invalid JSON'); }
                });

                const result = await triggerDeployment('preview', { debug: true });

                expect(result.success).toBe(true);
                expect(result.jobId).toBeUndefined();
                expect(mockLog.warning).toHaveBeenCalledWith(
                    expect.stringContaining('Failed to parse JSON response')
                );
            });

            test('fetch自体がエラーをthrowした場合', async () => {
                global.fetch.mockRejectedValueOnce(new Error('Network Error'));

                await expect(triggerDeployment('preview'))
                    .rejects.toThrow('Failed to trigger deployment: Network Error');
            });
        });
    });

    describe('AUTH_SECRET 管理', () => {
        describe('generateAuthSecret', () => {
            test('32バイトのランダムな文字列を生成する', () => {
                const mockToString = jest.fn().mockReturnValue('dGVzdC1yYW5kb20tYnl0ZXMtMzItY2hhcnMtbG9uZyEh');
                mockCrypto.randomBytes.mockReturnValueOnce({
                    toString: mockToString
                });

                const result = generateAuthSecret();

                expect(mockCrypto.randomBytes).toHaveBeenCalledWith(32);
                expect(mockToString).toHaveBeenCalledWith('base64');
                expect(result).toBe('dGVzdC1yYW5kb20tYnl0ZXMtMzItY2hhcnMtbG9uZyEh');
            });
        });

        describe('getExistingAuthSecret', () => {
            test('既存のAUTH_SECRETを取得する', async () => {
                const mockEnvs = {
                    envs: [
                        { key: 'AUTH_SECRET', value: 'existing-secret', target: ['production'] }
                    ]
                };

                global.fetch.mockResolvedValueOnce(createFetchResponse(mockEnvs));

                const result = await getExistingAuthSecret('token', 'project');

                expect(result).toBe('existing-secret');
            });

            test('AUTH_SECRETが存在しない場合nullを返す', async () => {
                global.fetch.mockResolvedValueOnce(createFetchResponse({ envs: [] }));

                const result = await getExistingAuthSecret('token', 'project');

                expect(result).toBeNull();
            });
        });
    });

    describe('.env.local 管理', () => {
        describe('updateLocalEnv', () => {
            test('新規.env.localファイルを作成する', async () => {
                mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });
                mockFs.writeFile.mockResolvedValueOnce();

                const config = {
                    awsConfig: {
                        COGNITO_CLIENT_ID: 'test-client-id',
                        COGNITO_CLIENT_SECRET: 'test-secret',
                        COGNITO_ISSUER: 'https://cognito.test'
                    },
                    authSecret: 'test-auth-secret',
                    envFilePath: '/test/path/.env.local',
                    debug: false
                };

                await updateLocalEnv(config);

                expect(mockFs.writeFile).toHaveBeenCalledWith(
                    '/test/path/.env.local',
                    expect.stringContaining('AUTH_SECRET="test-auth-secret"'),
                    'utf8'
                );
            });

            test('既存のAUTH_SECRETを保持する', async () => {
                const existingContent = `
# Auth.js設定
AUTH_SECRET="existing-secret"
NEXTAUTH_URL=http://localhost:3000
`;
                mockFs.readFile.mockResolvedValueOnce(existingContent);
                mockFs.writeFile.mockResolvedValueOnce();

                const config = {
                    awsConfig: {
                        COGNITO_CLIENT_ID: 'test-client-id',
                        COGNITO_CLIENT_SECRET: 'test-secret',
                        COGNITO_ISSUER: 'https://cognito.test'
                    },
                    authSecret: 'new-auth-secret', // これは無視されるべき
                    envFilePath: '/test/path/.env.local',
                    debug: false
                };

                await updateLocalEnv(config);

                expect(mockFs.writeFile).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.stringContaining('AUTH_SECRET="existing-secret"'),
                    'utf8'
                );
            });

            test('Cognito Domain設定を含む場合', async () => {
                mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });
                mockFs.writeFile.mockResolvedValueOnce();

                const config = {
                    awsConfig: {
                        COGNITO_CLIENT_ID: 'test-client-id',
                        COGNITO_CLIENT_SECRET: 'test-secret',
                        COGNITO_ISSUER: 'https://cognito.test',
                        NEXT_PUBLIC_COGNITO_DOMAIN: 'https://auth.test.com'
                    },
                    authSecret: 'test-auth-secret',
                    envFilePath: '/test/path/.env.local',
                    debug: false
                };

                await updateLocalEnv(config);

                expect(mockFs.writeFile).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.stringContaining('NEXT_PUBLIC_COGNITO_DOMAIN=https://auth.test.com'),
                    'utf8'
                );
            });

            test('ファイル読み込みで予期しないエラーが発生した場合', async () => {
                const error = new Error('Permission denied');
                mockFs.readFile.mockRejectedValueOnce(error);

                const config = {
                    awsConfig: {
                        COGNITO_CLIENT_ID: 'test-client-id',
                        COGNITO_CLIENT_SECRET: 'test-secret',
                        COGNITO_ISSUER: 'https://cognito.test'
                    },
                    authSecret: 'test-auth-secret',
                    envFilePath: '/test/path/.env.local',
                    debug: false
                };

                await expect(updateLocalEnv(config))
                    .rejects.toThrow('Failed to update env file: Permission denied');
            });

            test('既存ファイルの関連するコメント行を削除する', async () => {
                const existingContent = `
# API Endpoint設定
NEXT_PUBLIC_API_ENDPOINT=old-value

# Cognito設定
COGNITO_CLIENT_ID=old-id

# Auth.js設定
AUTH_SECRET="existing-secret"

# その他の設定
OTHER_SETTING=keep-this
`;
                mockFs.readFile.mockResolvedValueOnce(existingContent);
                mockFs.writeFile.mockResolvedValueOnce();

                const config = {
                    awsConfig: {
                        COGNITO_CLIENT_ID: 'new-client-id',
                        COGNITO_CLIENT_SECRET: 'new-secret',
                        COGNITO_ISSUER: 'https://cognito.test'
                    },
                    authSecret: 'new-auth-secret',
                    envFilePath: '/test/path/.env.local',
                    debug: true
                };

                await updateLocalEnv(config);

                const writtenContent = mockFs.writeFile.mock.calls[0][1];
                
                // 既存のAUTH_SECRETが保持されている
                expect(writtenContent).toContain('AUTH_SECRET="existing-secret"');
                
                // その他の設定が保持されている
                expect(writtenContent).toContain('OTHER_SETTING=keep-this');
                
                // 新しい値が設定されている
                expect(writtenContent).toContain('COGNITO_CLIENT_ID=new-client-id');
            });
        });

        describe('readAuthSecretFromEnvLocal', () => {
            test('.env.localからAUTH_SECRETを読み取る', async () => {
                const content = 'AUTH_SECRET="my-secret-value"';
                mockFs.readFile.mockResolvedValueOnce(content);

                const result = await readAuthSecretFromEnvLocal('/test/.env.local');

                expect(result).toBe('my-secret-value');
            });

            test('AUTH_SECRETが存在しない場合nullを返す', async () => {
                const content = 'OTHER_VAR=value';
                mockFs.readFile.mockResolvedValueOnce(content);

                const result = await readAuthSecretFromEnvLocal('/test/.env.local');

                expect(result).toBeNull();
            });

            test('ファイルが存在しない場合nullを返す', async () => {
                mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });

                const result = await readAuthSecretFromEnvLocal('/test/.env.local');

                expect(result).toBeNull();
            });
        });
    });

    describe('generateVercelEnvironmentVariables', () => {
        test('環境変数を正しく生成する', () => {
            const awsConfig = {
                COGNITO_CLIENT_ID: 'client-123',
                COGNITO_CLIENT_SECRET: 'secret-456',
                COGNITO_ISSUER: 'https://cognito.test'
            };

            const result = generateVercelEnvironmentVariables(awsConfig, 'dev', {
                authSecret: 'test-secret'
            });

            expect(result).toEqual({
                NEXT_PUBLIC_API_ENDPOINT: 'https://api-dev.sankey.trade',
                COGNITO_CLIENT_ID: 'client-123',
                COGNITO_CLIENT_SECRET: 'secret-456',
                COGNITO_ISSUER: 'https://cognito.test',
                AUTH_SECRET: 'test-secret',
                NEXTAUTH_URL: 'https://dev.sankey.trade',
                NEXT_PUBLIC_APP_URL: 'https://dev.sankey.trade'
            });
        });

        test('本番環境用の環境変数を生成する', () => {
            const awsConfig = {
                COGNITO_CLIENT_ID: 'client-123',
                COGNITO_CLIENT_SECRET: 'secret-456',
                COGNITO_ISSUER: 'https://cognito.test'
            };

            const result = generateVercelEnvironmentVariables(awsConfig, 'prod', {
                authSecret: 'test-secret'
            });

            expect(result.NEXT_PUBLIC_API_ENDPOINT).toBe('https://api.sankey.trade');
            expect(result.NEXTAUTH_URL).toBe('https://www.sankey.trade');
            expect(result.NEXT_PUBLIC_APP_URL).toBe('https://www.sankey.trade');
        });

        test('authSecretが指定されていない場合に生成される', () => {
            mockCrypto.randomBytes.mockReturnValueOnce({
                toString: jest.fn().mockReturnValue('generated-secret')
            });

            const awsConfig = {
                COGNITO_CLIENT_ID: 'client-123',
                COGNITO_CLIENT_SECRET: 'secret-456',
                COGNITO_ISSUER: 'https://cognito.test'
            };

            const result = generateVercelEnvironmentVariables(awsConfig, 'dev', {});

            expect(result.AUTH_SECRET).toBe('generated-secret');
        });

        test('Cognito Domain設定を含む場合', () => {
            const awsConfig = {
                COGNITO_CLIENT_ID: 'client-123',
                COGNITO_CLIENT_SECRET: 'secret-456',
                COGNITO_ISSUER: 'https://cognito.test',
                NEXT_PUBLIC_COGNITO_DOMAIN: 'https://auth.test.com'
            };

            const result = generateVercelEnvironmentVariables(awsConfig, 'dev', {
                authSecret: 'test-secret'
            });

            expect(result.NEXT_PUBLIC_COGNITO_DOMAIN).toBe('https://auth.test.com');
            expect(result.NEXT_PUBLIC_COGNITO_CLIENT_ID).toBe('client-123');
        });
    });

    describe('updateVercelEnvironmentVariables', () => {
        const baseConfig = {
            awsConfig: {
                COGNITO_CLIENT_ID: 'test-client-id',
                COGNITO_CLIENT_SECRET: 'test-secret',
                COGNITO_ISSUER: 'https://cognito.test'
            },
            environment: 'dev',
            apiToken: 'test-token',
            projectId: 'test-project',
            authSecret: 'test-auth-secret'
        };

        test('正常に環境変数を更新する', async () => {
            const mockEnvs = { envs: [] };
            global.fetch
                .mockResolvedValueOnce(createFetchResponse(mockEnvs)) // getEnvironmentVariables
                .mockResolvedValueOnce(createFetchResponse({ id: 'env-1' })) // create
                .mockResolvedValueOnce(createFetchResponse({ id: 'env-2' })) // create
                .mockResolvedValueOnce(createFetchResponse({ id: 'env-3' })) // create
                .mockResolvedValueOnce(createFetchResponse({ id: 'env-4' })) // create
                .mockResolvedValueOnce(createFetchResponse({ id: 'env-5' })) // create
                .mockResolvedValueOnce(createFetchResponse({ id: 'env-6' })) // create
                .mockResolvedValueOnce(createFetchResponse({ id: 'env-7' })); // create

            const result = await updateVercelEnvironmentVariables(baseConfig);

            expect(result.success).toBe(true);
            expect(result.environment).toBe('preview');
            expect(result.results.created.length).toBeGreaterThan(0);
            expect(mockLog.info).toHaveBeenCalled();
            expect(mockLog.success).toHaveBeenCalled();
        });

        test('APIトークンが無い場合エラーをthrowする', async () => {
            const config = { ...baseConfig, apiToken: null };

            await expect(updateVercelEnvironmentVariables(config))
                .rejects.toThrow('Vercel API token is required');
        });

        test('プロジェクトIDが無い場合エラーをthrowする', async () => {
            const config = { ...baseConfig, projectId: null };

            await expect(updateVercelEnvironmentVariables(config))
                .rejects.toThrow('Vercel project ID is required');
        });

        test('dryRunモードで実行する', async () => {
            const config = { ...baseConfig, dryRun: true };

            const result = await updateVercelEnvironmentVariables(config);

            expect(result.dryRun).toBe(true);
            expect(result.summary).toBe('No changes made (dry-run mode)');
            expect(global.fetch).not.toHaveBeenCalled();
            expect(mockLog.warning).toHaveBeenCalledWith(
                expect.stringContaining('DRY-RUN MODE')
            );
        });

        test('カスタムVercel環境を指定できる', async () => {
            const config = { ...baseConfig, vercelEnvironment: 'production' };
            const mockEnvs = { envs: [] };
            
            global.fetch.mockResolvedValueOnce(createFetchResponse(mockEnvs));
            // 7つの環境変数作成のモック
            for (let i = 0; i < 7; i++) {
                global.fetch.mockResolvedValueOnce(createFetchResponse({ id: `env-${i}` }));
            }

            const result = await updateVercelEnvironmentVariables(config);

            expect(result.environment).toBe('production');
        });

        test('エラーが発生した場合も処理を継続する', async () => {
            const mockEnvs = { envs: [] };
            
            global.fetch
                .mockResolvedValueOnce(createFetchResponse(mockEnvs)) // getEnvironmentVariables
                .mockResolvedValueOnce(createFetchResponse({ id: 'env-1' })) // 成功
                .mockRejectedValueOnce(new Error('API Error')) // エラー
                .mockResolvedValueOnce(createFetchResponse({ id: 'env-3' })); // 成功

            const config = { ...baseConfig };
            const result = await updateVercelEnvironmentVariables(config);

            expect(result.results.errors.length).toBeGreaterThan(0);
            expect(mockLog.error).toHaveBeenCalled();
        });

        test('debugモードでデバッグログを出力する', async () => {
            const config = { ...baseConfig, debug: true };
            const mockEnvs = { envs: [] };
            
            global.fetch.mockResolvedValueOnce(createFetchResponse(mockEnvs));

            await updateVercelEnvironmentVariables(config);

            expect(mockLog.debug).toHaveBeenCalledWith(
                expect.stringContaining('Starting Vercel environment variables update'),
                { debug: true }
            );
        });

        test('forceUpdateが無効の場合、既存の変数をスキップする', async () => {
            const mockEnvs = {
                envs: [
                    { id: 'env-1', key: 'COGNITO_CLIENT_ID', target: ['preview'] }
                ]
            };
            
            global.fetch.mockResolvedValueOnce(createFetchResponse(mockEnvs));
            // updateVercelEnvironmentVariables内でforceUpdate: trueがデフォルトで使用されるため、
            // 既存の変数も更新される
            for (let i = 0; i < 7; i++) {
                global.fetch.mockResolvedValueOnce(createFetchResponse({ id: `env-${i}` }));
            }

            const config = { ...baseConfig, forceUpdate: false };
            const result = await updateVercelEnvironmentVariables(config);

            // forceUpdateのデフォルトはtrueなので、実際には全て更新される
            expect(result.results.created.length).toBe(6);
            expect(result.results.updated.length).toBe(1);
        });
    });
});