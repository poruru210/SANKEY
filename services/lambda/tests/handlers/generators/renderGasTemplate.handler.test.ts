import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../../src/types/dependencies';
import { createTestContainer } from '../../di/testContainer';
import type { RenderGasTemplateHandlerDependencies } from '../../../src/di/types';

// Mustacheのモック
vi.mock('mustache', () => ({
  default: {
    render: vi.fn((template: string, data: any) => {
      return `RENDERED_TEMPLATE_WITH_${JSON.stringify(data)}`;
    })
  }
}));

// fsのモック - モジュール全体をモック
vi.mock('fs');

// pathのモック
vi.mock('path', () => ({
  default: {
    join: vi.fn((...args: string[]) => args.join('/'))
  },
  join: vi.fn((...args: string[]) => args.join('/'))
}));

describe('renderGasTemplate.handler', () => {
  let container: AwilixContainer<DIContainer>;
  let mockJwtKeyService: any;
  let mockLogger: any;
  let mockTracer: any;
  let handler: any;
  let dependencies: RenderGasTemplateHandlerDependencies;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 環境変数の設定
    process.env.API_ENDPOINT = 'https://api.example.com';

    // fsモジュールのモックを設定
    const fs = await import('fs');
    vi.mocked(fs.readFileSync).mockReturnValue('TEMPLATE_CONTENT');

    // モジュールキャッシュをクリア
    vi.resetModules();

    // テストコンテナから依存関係を取得（モックサービスを使用）
    container = createTestContainer({ useRealServices: false });
    mockJwtKeyService = container.resolve('jwtKeyService');
    mockLogger = container.resolve('logger');
    mockTracer = container.resolve('tracer');

    // ハンドラー用の依存関係を構築
    dependencies = {
      jwtKeyService: mockJwtKeyService,
      logger: mockLogger,
      tracer: mockTracer
    };

    // createHandler関数をインポート（モック設定後に行う）
    const handlerModule = await import('../../../src/handlers/generators/renderGasTemplate.handler');
    handler = handlerModule.createHandler(dependencies);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.API_ENDPOINT;
  });

  // ヘルパー関数: テスト用のAPIイベント作成
  const createTestEvent = (overrides: any = {}): APIGatewayProxyEvent => ({
    httpMethod: 'GET',
    path: '/generators/gas-template',
    headers: {},
    body: null,
    isBase64Encoded: false,
    queryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    resource: '',
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api-id',
      authorizer: overrides.authorizer !== undefined
          ? overrides.authorizer
          : {
            claims: {
              sub: 'test-user-id'
            }
          },
      domainName: overrides.domainName !== undefined ? overrides.domainName : 'api.example.com',
      stage: overrides.stage !== undefined ? overrides.stage : 'dev',
      requestId: 'test-request-id',
      requestTime: '01/Jan/2025:00:00:00 +0000',
      requestTimeEpoch: 1735689600000,
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'test-agent',
        cognitoIdentityPoolId: null,
        cognitoIdentityId: null,
        principalOrgId: null,
        cognitoAuthenticationType: null,
        cognitoAuthenticationProvider: null,
        userArn: null,
        user: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        accessKey: null,
        caller: null,
        clientCert: null
      },
      path: '/generators/gas-template',
      httpMethod: 'GET',
      protocol: 'HTTP/1.1',
      resourceId: 'test-resource-id',
      resourcePath: '/generators/gas-template'
    }
  });

  describe('認証チェック', () => {
    it('ユーザーIDが存在しない場合は401エラーを返す', async () => {
      const event = createTestEvent({
        authorizer: { claims: {} }
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toEqual({
        message: 'Unauthorized: User ID not found.'
      });
      expect(mockLogger.error).toHaveBeenCalledWith('User ID (sub) not found in Cognito claims');
    });

    it('authorizerが存在しない場合は401エラーを返す', async () => {
      const event = createTestEvent({
        authorizer: null
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toEqual({
        message: 'Unauthorized: User ID not found.'
      });
    });
  });

  describe('JWT秘密鍵の取得', () => {
    it('JWT秘密鍵を正常に取得してテンプレートをレンダリングする', async () => {
      const mockJwtSecret = 'test-jwt-secret';
      mockJwtKeyService.getJwtSecret.mockResolvedValue(mockJwtSecret);

      const event = createTestEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toMatchObject({
        'Content-Type': 'text/plain',
        'Content-Disposition': 'attachment; filename="sankey_gas_script.gs"',
        'Access-Control-Allow-Origin': '*'
      });
      expect(result.body).toContain('RENDERED_TEMPLATE_WITH_');
      expect(result.body).toContain('"jwtSecret":"test-jwt-secret"');
      expect(result.body).toContain('"userId":"test-user-id"');
      expect(result.body).toContain('"webhookUrl":"https://api.example.com/applications/webhook"');

      expect(mockJwtKeyService.getJwtSecret).toHaveBeenCalledWith('test-user-id');
      expect(mockLogger.info).toHaveBeenCalledWith('Successfully fetched JWT secret from SSM for GAS template.');
    });

    it('JWT秘密鍵が見つからない場合は404エラーを返す', async () => {
      const error = new Error('JWT secret not found for user');
      mockJwtKeyService.getJwtSecret.mockRejectedValue(error);

      const event = createTestEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toEqual({
        message: 'Configuration error: JWT secret not found for user.'
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
          'Error fetching JWT secret for GAS template',
          expect.objectContaining({
            userId: 'test-user-id',
            error: 'JWT secret not found for user'
          })
      );
    });

    it('JWT秘密鍵へのアクセスが拒否された場合は403エラーを返す', async () => {
      const error = new Error('Access denied to parameter');
      mockJwtKeyService.getJwtSecret.mockRejectedValue(error);

      const event = createTestEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body)).toEqual({
        message: 'Access denied to user configuration.'
      });
    });

    it('JWT秘密鍵取得時の一般的なエラーは500エラーを返す', async () => {
      const error = new Error('Unexpected SSM error');
      mockJwtKeyService.getJwtSecret.mockRejectedValue(error);

      const event = createTestEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        message: 'Internal Server Error: Could not retrieve JWT secret.'
      });
    });
  });

  describe('APIエンドポイントの構築', () => {
    it('環境変数にAPI_ENDPOINTが設定されている場合はそれを使用する', async () => {
      process.env.API_ENDPOINT = 'https://custom.api.com';
      mockJwtKeyService.getJwtSecret.mockResolvedValue('test-jwt-secret');

      const event = createTestEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.body).toContain('"webhookUrl":"https://custom.api.com/applications/webhook"');
      expect(mockLogger.info).toHaveBeenCalledWith(
          'Using configured API endpoint:',
          { apiEndpoint: 'https://custom.api.com' }
      );
    });

    it('API_ENDPOINTが未設定の場合はAPI Gatewayコンテキストから動的に構築する', async () => {
      delete process.env.API_ENDPOINT;
      mockJwtKeyService.getJwtSecret.mockResolvedValue('test-jwt-secret');

      const event = createTestEvent({
        domainName: 'dynamic.api.com',
        stage: 'prod'
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.body).toContain('"webhookUrl":"https://dynamic.api.com/prod/applications/webhook"');
      expect(mockLogger.info).toHaveBeenCalledWith(
          'Using dynamic API Gateway endpoint:',
          { apiEndpoint: 'https://dynamic.api.com/prod' }
      );
    });

    it('API Gatewayコンテキストが不完全な場合は500エラーを返す', async () => {
      delete process.env.API_ENDPOINT;

      const event = createTestEvent({
        domainName: null,
        stage: 'dev'
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        message: 'Internal Server Error: API Gateway context not available.'
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
          'API Gateway context (domainName or stage) not found in event.requestContext'
      );
    });
  });

  describe('エラーハンドリング', () => {
    it('予期しないエラーが発生した場合は500エラーを返す', async () => {
      const unexpectedError = new Error('Unexpected error');
      mockJwtKeyService.getJwtSecret.mockRejectedValue(unexpectedError);

      // エラーメッセージを変更して一般的なエラーとして扱う
      unexpectedError.message = 'Something went wrong';

      const event = createTestEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        message: 'Internal Server Error: Could not retrieve JWT secret.'
      });
    });

    it('非Errorオブジェクトがスローされた場合も適切に処理する', async () => {
      mockJwtKeyService.getJwtSecret.mockRejectedValue('String error');

      const event = createTestEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        message: 'Internal Server Error: Could not retrieve JWT secret.'
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
          'Error fetching JWT secret for GAS template',
          expect.objectContaining({
            userId: 'test-user-id',
            error: 'String error'
          })
      );
    });
  });

  describe('テンプレートレンダリング', () => {
    it('正しいデータでMustacheテンプレートをレンダリングする', async () => {
      mockJwtKeyService.getJwtSecret.mockResolvedValue('test-jwt-secret');

      const event = createTestEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);

      // レンダリングされたテンプレートに必要なデータが含まれていることを確認
      const renderedBody = result.body;
      expect(renderedBody).toContain('"webhookUrl":"https://api.example.com/applications/webhook"');
      expect(renderedBody).toContain('"testNotificationUrl":"https://api.example.com/integration/test/gas-connection"');
      expect(renderedBody).toContain('"resultNotificationUrl":"https://api.example.com/integration/result/notification"');
      expect(renderedBody).toContain('"userId":"test-user-id"');
      expect(renderedBody).toContain('"jwtSecret":"test-jwt-secret"');

      // ログの確認
      expect(mockLogger.info).toHaveBeenCalledWith(
          'Template data prepared for rendering',
          expect.objectContaining({
            userId: 'test-user-id',
            hasWebhookUrl: true,
            hasTestNotificationUrl: true,
            hasResultNotificationUrl: true,
            hasJwtSecret: true
          })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
          'GAS Template rendered successfully with JWT_SECRET for secure GAS communication.'
      );
    });
  });
});