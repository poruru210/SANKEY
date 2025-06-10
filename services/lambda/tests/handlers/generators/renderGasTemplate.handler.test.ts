import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { mockClient } from 'aws-sdk-client-mock';

// Vitestでのモック設定
vi.mock('fs');

// DynamoDB Client のモック
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockReturnValue({})
  }
}));

// PowerTools のモック
vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }))
}));

vi.mock('@aws-lambda-powertools/tracer', () => ({
  Tracer: vi.fn().mockImplementation(() => ({
    captureAWSv3Client: vi.fn((client) => client),
    isTracingEnabled: vi.fn(() => false),
    getSegment: vi.fn(),
    setSegment: vi.fn(),
    addAnnotation: vi.fn(),
    addMetadata: vi.fn(),
    putAnnotation: vi.fn(),
    putMetadata: vi.fn(),
    annotateColdStart: vi.fn(),
    addServiceNameAnnotation: vi.fn(),
    addResponseAsMetadata: vi.fn(),
    captureLambdaHandler: vi.fn((handler) => handler),
    captureMethod: vi.fn(),
    captureAsyncFunc: vi.fn()
  }))
}));

// Middyのモック
vi.mock('@middy/core', () => ({
  default: vi.fn((handler) => {
    const wrappedHandler = async (event: any, context: any) => {
      return await handler(event, context);
    };
    wrappedHandler.use = vi.fn().mockReturnValue(wrappedHandler);
    wrappedHandler.before = vi.fn();
    wrappedHandler.after = vi.fn();
    wrappedHandler.onError = vi.fn();
    return wrappedHandler;
  })
}));

// Middyミドルウェアのモック
vi.mock('@middy/http-cors', () => ({
  default: vi.fn(() => ({}))
}));

vi.mock('@aws-lambda-powertools/logger/middleware', () => ({
  injectLambdaContext: vi.fn(() => ({}))
}));

vi.mock('@aws-lambda-powertools/tracer/middleware', () => ({
  captureLambdaHandler: vi.fn(() => ({}))
}));

// Mustacheのモック
vi.mock('mustache', () => ({
  render: vi.fn((template, data) => {
    // テンプレートの変数を実際の値で置換するシンプルな実装
    return template
        .replace(/{{webhookUrl}}/g, data.webhookUrl)
        .replace(/{{userId}}/g, data.userId)
        .replace(/{{masterKey}}/g, data.masterKey);
  })
}));

const ssmMock = mockClient(SSMClient);

const mockGasTemplateString = `
/**
 * EA License Application - Google Apps Script Template (JWT版)
 */

// ============================================
// 設定セクション(ここを編集してください)
// ============================================
var CONFIG = {
  // あなたの設定値(システム管理者から取得)
  WEBHOOK_URL: "{{webhookUrl}}",
  USER_ID: "{{userId}}",
  MASTER_KEY: "{{masterKey}}",

  // フォームの項目名(実際のフォーム項目に合わせて調整)
  FORM_FIELDS: {
    EA_NAME: "EA",
    ACCOUNT_NUMBER: "口座番号",
    BROKER: "ブローカー",
    EMAIL: "メールアドレス",
    X_ACCOUNT: "ユーザー名"
  }
};

function validateConfig() {
  var issues = [];

  if (!CONFIG.WEBHOOK_URL || CONFIG.WEBHOOK_URL.indexOf('your-api') !== -1) {
    issues.push('WEBHOOK_URL が設定されていません');
  }

  if (!CONFIG.USER_ID || CONFIG.USER_ID.indexOf('xxxx') !== -1) {
    issues.push('USER_ID が設定されていません');
  }

  if (!CONFIG.MASTER_KEY || CONFIG.MASTER_KEY.indexOf('your-') !== -1) {
    issues.push('MASTER_KEY が設定されていません');
  }

  if (issues.length > 0) {
    console.error('❌ 設定エラー:', issues);
    return false;
  }

  console.log('✅ 設定は正常です');
  return true;
}
`;

describe('Render GAS Template Handler (Dynamic Webhook URL & GET method)', () => {
  const originalEnv = process.env;
  const mockUserId = 'test-user-sub-123';
  const mockMasterKey = 'testMasterKey1234567890';
  const mockApiDomainName = 'test-domain.execute-api.test-region.amazonaws.com';
  const mockApiStage = 'testProd';
  const testEnvironment = 'test';

  // Vitestでのモック関数の型指定
  const mockedReadFileSync = vi.mocked(fs.readFileSync);

  // handler関数を保持する変数
  let handler: any;

  beforeEach(async () => {
    // 全モックをクリア
    vi.clearAllMocks();

    // SSMクライアントのモックをリセット
    ssmMock.reset();

    // 環境変数のリセット（正しいパス用）
    process.env = {
      ...originalEnv,
      ENVIRONMENT: testEnvironment,  // 'test' 環境を設定
    };

    // ファイル読み込みのモック設定 - 文字列として返す
    mockedReadFileSync.mockReturnValue(mockGasTemplateString);

    // SSMからのマスターキー取得の成功レスポンスをモック（正しいパス使用）
    const correctPath = `/sankey/${testEnvironment}/users/${mockUserId}/master-key`;
    ssmMock.on(GetParameterCommand, {
      Name: correctPath,
      WithDecryption: true
    }).resolves({
      Parameter: {
        Value: mockMasterKey,
        Name: correctPath,
        Type: 'SecureString'
      },
    });

    // モジュールキャッシュをクリアして再インポート
    vi.resetModules();

    // handler関数を動的にインポート
    const handlerModule = await import('../../../src/handlers/generators/renderGasTemplate.handler');
    handler = handlerModule.handler;
  });

  afterEach(() => {
    // 各テスト後にモックをクリア
    vi.clearAllMocks();
  });

  afterAll(() => {
    // 環境変数を元に戻す
    process.env = originalEnv;
  });

  // ヘルパー関数: テスト用のLambdaコンテキスト作成
  const createTestContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'render-gas-template',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:render-gas-template',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/render-gas-template',
    logStreamName: '2025/06/06/[$LATEST]test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: vi.fn(),
    fail: vi.fn(),
    succeed: vi.fn()
  });

  // ヘルパー関数: テスト用のAPIイベント作成
  const createTestEvent = (
      userId?: string | null,
      domainName?: string | null,
      stage?: string | null,
      requestContextPresent: boolean = true
  ): APIGatewayProxyEvent => ({
    httpMethod: 'GET',
    path: '/application/config/gas',
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    body: null,
    isBase64Encoded: false,
    resource: '/application/config/gas',
    requestContext: requestContextPresent ? {
      requestId: 'test-req-id',
      domainName: domainName === null ? undefined as any : (domainName || mockApiDomainName),
      stage: stage === null ? undefined as any : (stage || mockApiStage),
      httpMethod: 'GET',
      path: '/application/config/gas',
      resourcePath: '/application/config/gas',
      apiId: 'mockApiId',
      accountId: 'mockAccountId',
      resourceId: 'mockResourceId',
      requestTime: '09/Apr/2015:12:34:56 +0000',
      requestTimeEpoch: 1428582896000,
      identity: {
        cognitoIdentityPoolId: null,
        cognitoIdentityId: null,
        apiKey: null,
        principalOrgId: null,
        cognitoAuthenticationType: null,
        userArn: null,
        apiKeyId: null,
        userAgent: 'Custom User Agent String',
        accountId: null,
        cognitoAuthenticationProvider: null,
        sourceIp: '127.0.0.1',
        accessKey: null,
        caller: null,
        user: null,
        clientCert: null
      },
      protocol: 'HTTP/1.1',
      authorizer: userId === null ? {} : (userId ? {
        claims: { sub: userId }
      } : {
        claims: {}
      })
    } as any : undefined as any
  });

  describe('正常系テスト', () => {
    it('should successfully render the template for a GET request with correct SSM path', async () => {
      const event = createTestEvent(mockUserId);
      const context = createTestContext();

      const result = await handler(event, context);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toEqual(
          expect.objectContaining({
            'Content-Type': 'text/plain',
            'Content-Disposition': 'attachment; filename="generated_script.gs"',
          })
      );

      const expectedWebhookUrl = `https://${mockApiDomainName}/${mockApiStage}/applications/webhook`;
      expect(result.body).toContain(`WEBHOOK_URL: "${expectedWebhookUrl}"`);
      expect(result.body).toContain(`USER_ID: "${mockUserId}"`);
      expect(result.body).toContain(`MASTER_KEY: "${mockMasterKey}"`);
      expect(result.body).toContain('FORM_FIELDS: {');
      expect(result.body).toContain('EA_NAME: "EA"');

      // 正しいパスでSSMが呼ばれたことを確認
      const calls = ssmMock.commandCalls(GetParameterCommand, {
        Name: `/sankey/${testEnvironment}/users/${mockUserId}/master-key`,
        WithDecryption: true,
      });
      expect(calls.length).toBeGreaterThan(0);
    });

    it('should work with different environments', async () => {
      // 異なる環境での動作確認
      process.env.ENVIRONMENT = 'staging';

      // 新しい環境用のモックを設定
      const stagingPath = `/sankey/staging/users/${mockUserId}/master-key`;
      ssmMock.on(GetParameterCommand, {
        Name: stagingPath,
        WithDecryption: true
      }).resolves({
        Parameter: {
          Value: mockMasterKey,
          Name: stagingPath,
          Type: 'SecureString'
        },
      });

      // モジュールを再インポート
      vi.resetModules();
      const handlerModule = await import('../../../src/handlers/generators/renderGasTemplate.handler');
      const stagingHandler = handlerModule.handler;

      const event = createTestEvent(mockUserId);
      const context = createTestContext();

      const result = await stagingHandler(event, context);

      expect(result.statusCode).toBe(200);

      // staging環境のパスで呼ばれたことを確認
      const calls = ssmMock.commandCalls(GetParameterCommand, {
        Name: stagingPath,
        WithDecryption: true,
      });
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  describe('異常系テスト', () => {
    it('should return 500 if event.requestContext.domainName is missing for a GET request', async () => {
      // Arrange
      const event = createTestEvent(mockUserId, null, mockApiStage);
      const context = createTestContext();

      // Act
      const result = await handler(event, context);

      // Assert
      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toBe('Internal Server Error: API Gateway context not available.');
    });

    it('should return 500 if event.requestContext.stage is missing for a GET request', async () => {
      // Arrange
      const event = createTestEvent(mockUserId, mockApiDomainName, null);
      const context = createTestContext();

      // Act
      const result = await handler(event, context);

      // Assert
      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toBe('Internal Server Error: API Gateway context not available.');
    });

    it('should return 500 if event.requestContext itself is missing for a GET request', async () => {
      // Arrange
      const event = createTestEvent(mockUserId, mockApiDomainName, mockApiStage, false);
      const context = createTestContext();

      // Act
      const result = await handler(event, context);

      // Assert
      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      // requestContextがnullの場合、catch句に入り汎用エラーメッセージになる
      expect(responseBody.message).toBe('Internal Server Error: An unexpected error occurred.');
    });

    it('should return 401 if Cognito user ID (sub) is missing for a GET request', async () => {
      // Arrange
      const event = createTestEvent(undefined, mockApiDomainName, mockApiStage);
      const context = createTestContext();

      // Act
      const result = await handler(event, context);

      // Assert
      expect(result.statusCode).toBe(401);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toBe('Unauthorized: User ID not found.');
    });

    it('should return 401 if Cognito claims are missing entirely for a GET request', async () => {
      // Arrange
      const event = createTestEvent(undefined, mockApiDomainName, mockApiStage);
      const context = createTestContext();
      if (event.requestContext) {
        event.requestContext.authorizer = {};
      }

      // Act
      const result = await handler(event, context);

      // Assert
      expect(result.statusCode).toBe(401);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toBe('Unauthorized: User ID not found.');
    });

    it('should return 401 if authorizer block is missing for a GET request', async () => {
      // Arrange
      const event = createTestEvent(null);
      const context = createTestContext();
      if (event.requestContext) {
        delete event.requestContext.authorizer;
      }

      // Act
      const result = await handler(event, context);

      // Assert
      expect(result.statusCode).toBe(401);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toBe('Unauthorized: User ID not found.');
    });

    it('should return 500 if master key is not found in SSM for a GET request', async () => {
      // Arrange
      ssmMock.reset();
      const correctPath = `/sankey/${testEnvironment}/users/${mockUserId}/master-key`;
      ssmMock.on(GetParameterCommand, {
        Name: correctPath,
        WithDecryption: true
      }).resolves({
        Parameter: undefined
      });

      const event = createTestEvent(mockUserId);
      const context = createTestContext();

      // Act
      const result = await handler(event, context);

      // Assert
      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toBe('Internal Server Error: Could not retrieve master key.');
    });

    it('should return 500 if master key parameter has no Value for a GET request', async () => {
      // Arrange
      ssmMock.reset();
      const correctPath = `/sankey/${testEnvironment}/users/${mockUserId}/master-key`;
      ssmMock.on(GetParameterCommand, {
        Name: correctPath,
        WithDecryption: true
      }).resolves({
        Parameter: {
          Name: correctPath,
          Type: 'SecureString',
          Value: undefined
        } as any
      });

      const event = createTestEvent(mockUserId);
      const context = createTestContext();

      // Act
      const result = await handler(event, context);

      // Assert
      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toBe('Internal Server Error: Could not retrieve master key.');
    });

    it('should return 500 if SSM GetParameterCommand fails for a GET request', async () => {
      // Arrange
      ssmMock.reset();
      const correctPath = `/sankey/${testEnvironment}/users/${mockUserId}/master-key`;
      ssmMock.on(GetParameterCommand, {
        Name: correctPath,
        WithDecryption: true
      }).rejects(new Error('SSM GetParameter failed'));

      const event = createTestEvent(mockUserId);
      const context = createTestContext();

      // Act
      const result = await handler(event, context);

      // Assert
      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toBe('Internal Server Error: Could not retrieve master key.');
    });
  });
});