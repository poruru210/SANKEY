import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PostConfirmationTriggerEvent } from 'aws-lambda';
import { AwilixContainer } from 'awilix';
import { createTestContainer } from '../di/testContainer';
import { createHandler } from '../../src/handlers/postConfirmation.handler';
import { DIContainer, PostConfirmationHandlerDependencies } from '../../src/di/dependencies';

// Mock event data
const mockEvent: PostConfirmationTriggerEvent = {
  version: '1',
  region: 'us-east-1',
  userPoolId: 'us-east-1_test',
  userName: 'abc123',
  callerContext: {
    awsSdkVersion: '2.1.1',
    clientId: 'test-client-id'
  },
  triggerSource: 'PostConfirmation_ConfirmSignUp',
  request: {
    userAttributes: {
      sub: 'user-123',
      email: 'test@example.com'
    }
  },
  response: {}
};

describe('postConfirmation.handler', () => {
  let container: AwilixContainer<DIContainer>;
  let mockMasterKeyService: any;
  let mockJWTKeyService: any;
  let mockUserProfileRepository: any;
  let mockLogger: any;
  let mockTracer: any;
  let handler: any;
  let dependencies: PostConfirmationHandlerDependencies;

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.USER_PROFILE_TABLE_NAME = 'test-user-profile-table';
    process.env.ENVIRONMENT = 'dev';
    process.env.STAGE = 'dev';

    // テストコンテナから依存関係を取得（モックサービスを使用）
    container = createTestContainer({ useRealServices: false });
    mockMasterKeyService = container.resolve('masterKeyService');
    mockJWTKeyService = container.resolve('jwtKeyService');
    mockUserProfileRepository = container.resolve('userProfileRepository');
    mockLogger = container.resolve('logger');
    mockTracer = container.resolve('tracer');

    // ハンドラー用の依存関係を構築
    dependencies = {
      masterKeyService: mockMasterKeyService,
      jwtKeyService: mockJWTKeyService,
      userProfileRepository: mockUserProfileRepository,
      logger: mockLogger,
      tracer: mockTracer
    };

    handler = createHandler(dependencies);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.USER_PROFILE_TABLE_NAME;
    delete process.env.ENVIRONMENT;
    delete process.env.STAGE;
  });

  it('creates master key, jwt secret and user profile successfully', async () => {
    // UserProfileRepositoryのモック
    mockUserProfileRepository.createUserProfile.mockResolvedValue(undefined);

    const result = await handler(mockEvent);

    expect(mockMasterKeyService.ensureMasterKeyExists).toHaveBeenCalledWith('user-123', 'test@example.com');
    expect(mockJWTKeyService.ensureJwtSecretExists).toHaveBeenCalledWith('user-123', 'test@example.com');
    expect(mockUserProfileRepository.createUserProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          setupPhase: 'SETUP',
          notificationEnabled: true,
          createdAt: expect.any(String),
          updatedAt: expect.any(String)
        })
    );

    expect(result).toEqual(mockEvent);
  });

  it('handles existing user profile gracefully', async () => {
    // User profile already existsエラーのモック
    mockUserProfileRepository.createUserProfile.mockRejectedValue(
        new Error('User profile already exists')
    );

    const result = await handler(mockEvent);

    expect(mockMasterKeyService.ensureMasterKeyExists).toHaveBeenCalled();
    expect(mockJWTKeyService.ensureJwtSecretExists).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
        'UserProfile already exists, skipping creation',
        { userId: 'user-123', email: 'test@example.com' }
    );
    expect(result).toEqual(mockEvent);
  });

  it('skips user profile creation when table name not configured', async () => {
    delete process.env.USER_PROFILE_TABLE_NAME;

    // 新しいハンドラーを作成（環境変数の変更を反映）
    handler = createHandler(dependencies);

    const result = await handler(mockEvent);

    expect(mockMasterKeyService.ensureMasterKeyExists).toHaveBeenCalled();
    expect(mockJWTKeyService.ensureJwtSecretExists).toHaveBeenCalled();
    expect(mockUserProfileRepository.createUserProfile).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
        'USER_PROFILE_TABLE_NAME not configured, skipping UserProfile creation'
    );
    expect(result).toEqual(mockEvent);
  });

  it('throws error when master key service fails', async () => {
    const error = new Error('Master key creation failed');
    mockMasterKeyService.ensureMasterKeyExists.mockRejectedValue(error);

    await expect(handler(mockEvent)).rejects.toThrow('Master key creation failed');
  });

  it('throws error when JWT service fails', async () => {
    const error = new Error('JWT secret creation failed');
    mockJWTKeyService.ensureJwtSecretExists.mockRejectedValue(error);

    await expect(handler(mockEvent)).rejects.toThrow('JWT secret creation failed');
  });

  it('logs user profile creation error but does not throw for non-conditional errors', async () => {
    const dbError = new Error('DynamoDB error');
    mockUserProfileRepository.createUserProfile.mockRejectedValue(dbError);

    // エラーが発生してもハンドラーは正常終了する
    const result = await handler(mockEvent);

    expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create UserProfile',
        expect.objectContaining({
          error: 'DynamoDB error',
          userId: 'user-123',
          email: 'test@example.com'
        })
    );
    expect(result).toEqual(mockEvent);
  });
});