import { createContainer, asValue, asClass, AwilixContainer } from 'awilix';
import { vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { DIContainer } from '../../src/di/dependencies';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

// 実際のサービスクラスをインポート
import { JWTKeyService } from '../../src/services/jwtKeyService';
import { MasterKeyService } from '../../src/services/masterKeyService';
import { IntegrationTestService } from '../../src/services/integrationTestService';
import { IntegrationTestProgressService } from '../../src/services/integrationTestProgressService';

// リポジトリクラスをインポート
import { EAApplicationRepository } from '../../src/repositories/eaApplicationRepository';
import { IntegrationTestRepository } from '../../src/repositories/integrationTestRepository';
import {UserProfileRepository} from "../../src/repositories/userProfileRepository";

/**
 * テスト用のDIコンテナを作成
 * @param options - コンテナ作成オプション
 */
export function createTestContainer(options?: {
    mockLogger?: boolean;
    mockTracer?: boolean;
    useRealServices?: boolean; // 実際のサービスクラスを使用するかどうか
}): AwilixContainer<DIContainer> {
    const container = createContainer<DIContainer>();

    // AWS SDK モックの作成
    const ssmClientMock = mockClient(SSMClient);
    const ddbClientMock = mockClient(DynamoDBClient);
    const sqsClientMock = mockClient(SQSClient);
    const cognitoClientMock = mockClient(CognitoIdentityProviderClient);
    const apiGatewayClientMock = mockClient(APIGatewayClient);

    // DynamoDBDocumentClientのモック
    const docClientMock = mockClient(DynamoDBDocumentClient);

    // モックの作成と登録
    container.register({
        // 設定値
        environment: asValue('test'),
        region: asValue('ap-northeast-1'),
        tableName: asValue('test-ea-applications'),
        integrationTestTableName: asValue('test-integration-tests'),

        // Logger (オプションでモックか実インスタンスを選択)
        logger: asValue(
            options?.mockLogger !== false // デフォルトはモック
                ? {
                    info: vi.fn(),
                    error: vi.fn(),
                    debug: vi.fn(),
                    warn: vi.fn(),
                    addContext: vi.fn(),
                    appendKeys: vi.fn(),
                    removeKeys: vi.fn(),
                    injectLambdaContext: vi.fn(),
                    refreshSampleRateCalculation: vi.fn(),
                } as unknown as Logger
                : new Logger({
                    serviceName: 'test-service',
                    logLevel: 'ERROR', // テストではERRORレベルに設定してノイズを減らす
                })
        ),

        // Tracer (オプションでモックか実インスタンスを選択)
        tracer: asValue(
            options?.mockTracer !== false // デフォルトはモック
                ? {
                    captureAWSv3Client: vi.fn((client: any) => client),
                    putAnnotation: vi.fn(),
                    putMetadata: vi.fn(),
                    getSegment: vi.fn(),
                    setSegment: vi.fn(),
                    isTracingEnabled: vi.fn().mockReturnValue(true),
                    annotateColdStart: vi.fn(),
                    addServiceNameAnnotation: vi.fn(),
                    addResponseAsMetadata: vi.fn(),
                    addErrorAsMetadata: vi.fn(),
                    captureLambdaHandler: vi.fn(),
                } as unknown as Tracer
                : new Tracer({
                    serviceName: 'test-service',
                    enabled: false, // テストではトレーシングを無効化
                })
        ),

        ssmClient: asValue(new SSMClient({})),
        ddbClient: asValue(new DynamoDBClient({})),
        docClient: asValue(DynamoDBDocumentClient.from(new DynamoDBClient({}))),
        sqsClient: asValue(new SQSClient({})),
        cognitoClient: asValue(new CognitoIdentityProviderClient({})),
        apiGatewayClient: asValue(new APIGatewayClient({})),

        jwtKeyService: options?.useRealServices !== false
            ? asClass(JWTKeyService)
                .singleton()
                .inject(() => ({
                    ssmClient: container.resolve('ssmClient'),
                    logger: container.resolve('logger'),
                }))
            : asValue({
                ensureJwtSecretExists: vi.fn(),
                getJwtSecret: vi.fn(),
                hasJwtSecret: vi.fn(),
                verifyJWT: vi.fn(),
                verifyUserRequest: vi.fn(),
                validateJwtAccess: vi.fn(),
            } as any),

        masterKeyService: options?.useRealServices !== false
            ? asClass(MasterKeyService)
                .singleton()
                .inject(() => ({
                    ssmClient: container.resolve('ssmClient'),
                    logger: container.resolve('logger'),
                }))
            : asValue({
                ensureMasterKeyExists: vi.fn(),
                getUserMasterKey: vi.fn(),
                getUserMasterKeyForEncryption: vi.fn(),
                getUserMasterKeyForDecryption: vi.fn(),
                getUserMasterKeyRaw: vi.fn(),
                hasMasterKey: vi.fn(),
            } as any),

        integrationTestService: options?.useRealServices !== false
            ? asClass(IntegrationTestService)
                .singleton()
                .inject(() => ({
                    docClient: container.resolve('docClient'),
                    integrationTestRepository: container.resolve('integrationTestRepository'),
                    eaApplicationRepository: container.resolve('eaApplicationRepository'),
                    logger: container.resolve('logger'),
                }))
            : asValue({
                startIntegrationTest: vi.fn(),
                recordTestStarted: vi.fn(),
                recordProgress: vi.fn(),
                cleanupIntegrationTestData: vi.fn(),
                getIntegrationTestStatus: vi.fn(),
                isIntegrationTestApplication: vi.fn(),
                findIntegrationTestApplications: vi.fn(),
            } as any),

        integrationTestProgressService: options?.useRealServices !== false
            ? asClass(IntegrationTestProgressService)
                .singleton()
                .inject(() => ({
                    logger: container.resolve('logger'),
                }))
            : asValue({
                createInitialProgress: vi.fn(),
                updateProgress: vi.fn(),
                validateProgress: vi.fn(),
                getNextStep: vi.fn(),
                isStepCompleted: vi.fn(),
                isAllStepsCompleted: vi.fn(),
            } as any),

        eaApplicationRepository: options?.useRealServices !== false
            ? asClass(EAApplicationRepository)
                .singleton()
                .inject(() => ({
                    docClient: container.resolve('docClient'),
                    tableName: container.resolve('tableName'),
                    logger: container.resolve('logger'),
                }))
            : asValue({
                createApplication: vi.fn(),
                getApplication: vi.fn(),
                getApplicationsByStatus: vi.fn(),
                getAllApplications: vi.fn(),
                getActiveApplicationByBrokerAccount: vi.fn(),
                updateStatus: vi.fn(),
                recordHistory: vi.fn(),
                setHistoryTTL: vi.fn(),
                updateStatusWithHistoryTTL: vi.fn(),
                activateApplicationWithLicense: vi.fn(),
                cancelApplication: vi.fn(),
                getApplicationHistories: vi.fn(),
                deleteApplication: vi.fn(),
                updateApprovalInfo: vi.fn(),
                expireApplication: vi.fn(),
                adjustTTL: vi.fn(),
            } as any),

        integrationTestRepository: options?.useRealServices !== false
            ? asClass(IntegrationTestRepository)
                .singleton()
                .inject(() => ({
                    docClient: container.resolve('docClient'),  // 修正: dynamoClient → docClient
                    tableName: process.env.USER_PROFILE_TABLE_NAME || 'user-profiles',
                    logger: container.resolve('logger'),
                }))
            : asValue({
                getUserProfile: vi.fn(),
                updateIntegrationTest: vi.fn(),
                initializeIntegrationTest: vi.fn(),
                clearIntegrationTest: vi.fn(),
                updateSetupTest: vi.fn(),  // 追加
                updateSetupPhase: vi.fn(), // 追加
            } as any),

        userProfileRepository: options?.useRealServices !== false
            ? asClass(UserProfileRepository)
                .singleton()
                .inject(() => ({
                    docClient: container.resolve('docClient'),
                    tableName: process.env.USER_PROFILE_TABLE_NAME || 'user-profiles',
                    logger: container.resolve('logger'),
                }))
            : asValue({
                getUserProfile: vi.fn(),
                createUserProfile: vi.fn(),
                updateUserProfile: vi.fn(),
                createOrUpdateUserProfile: vi.fn(),
            } as any),
    });

    return container;
}

/**
 * AWS SDK モックを取得するヘルパー関数
 */
export function getAWSMocks() {
    return {
        ssmClientMock: mockClient(SSMClient),
        ddbClientMock: mockClient(DynamoDBClient),
        docClientMock: mockClient(DynamoDBDocumentClient),
        sqsClientMock: mockClient(SQSClient),
        cognitoClientMock: mockClient(CognitoIdentityProviderClient),
        apiGatewayClientMock: mockClient(APIGatewayClient),
    };
}

/**
 * モックをリセットするヘルパー関数
 */
export function resetMocks(container: AwilixContainer<DIContainer>): void {
    const cradle = container.cradle;

    // AWS SDK モックをリセット
    const mocks = getAWSMocks();
    Object.values(mocks).forEach(mock => mock.reset());

    // すべてのモック関数をリセット
    Object.values(cradle).forEach((service) => {
        if (service && typeof service === 'object') {
            Object.values(service).forEach((method) => {
                if (typeof method === 'function' && 'mockReset' in method) {
                    (method as any).mockReset();
                }
            });
        }
    });
}

/**
 * テスト用のヘルパー関数
 */
export function getMockLogger(container: AwilixContainer<DIContainer>) {
    return container.resolve('logger');
}

export function getMockDocClient(container: AwilixContainer<DIContainer>) {
    return container.resolve('docClient');
}

export function getMockService<K extends keyof DIContainer>(
    container: AwilixContainer<DIContainer>,
    serviceName: K
): DIContainer[K] {
    return container.resolve(serviceName);
}