import { AwilixContainer } from 'awilix';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayClient } from '@aws-sdk/client-api-gateway';

// Services
import { IntegrationTestService } from '../services/integrationTestService';
import { IntegrationTestProgressService } from '../services/integrationTestProgressService';
import { MasterKeyService } from '../services/masterKeyService';
import { JWTKeyService } from '../services/jwtKeyService';

// Repositories
import { EAApplicationRepository } from '../repositories/eaApplicationRepository';
import { IntegrationTestRepository } from '../repositories/integrationTestRepository';
import { UserProfileRepository } from '../repositories/userProfileRepository';

// ========================================
// DIコンテナの型定義
// ========================================

/**
 * DIコンテナの型定義
 * すべての依存関係を定義
 */
export interface DIContainer {
    // AWS Clients
    logger: Logger;
    tracer: Tracer;
    ssmClient: SSMClient;
    ddbClient: DynamoDBClient;
    docClient: DynamoDBDocumentClient;
    sqsClient: SQSClient;
    cognitoClient: CognitoIdentityProviderClient;
    apiGatewayClient: APIGatewayClient;

    // Services
    integrationTestService: IntegrationTestService;
    integrationTestProgressService: IntegrationTestProgressService;
    masterKeyService: MasterKeyService;
    jwtKeyService: JWTKeyService;

    // Repositories
    eaApplicationRepository: EAApplicationRepository;
    integrationTestRepository: IntegrationTestRepository;
    userProfileRepository: UserProfileRepository;

    // Config
    environment: string;
    region: string;
    tableName: string;
    integrationTestTableName: string;
}

/**
 * Awilixのインジェクション用型定義
 */
export type Cradle = DIContainer;

/**
 * コンテナ型のエイリアス
 */
export type Container = AwilixContainer<Cradle>;

// ========================================
// 基本依存関係インターフェース
// ========================================

/**
 * 基本サービスの依存関係
 */
export interface ServiceDependencies {
    logger: DIContainer['logger'];
}

/**
 * 基本リポジトリの依存関係
 */
export interface RepositoryDependencies extends ServiceDependencies {
    docClient: DIContainer['docClient'];
    tableName: string;
}

// ========================================
// サービス固有の依存関係インターフェース
// ========================================

/**
 * MasterKeyService の依存関係
 */
export interface MasterKeyServiceDependencies {
    ssmClient: SSMClient;
    logger: Logger;
}

/**
 * JWTKeyService の依存関係
 */
export interface JWTKeyServiceDependencies {
    ssmClient: SSMClient;
    logger: Logger;
}

/**
 * IntegrationTestService の依存関係
 */
export interface IntegrationTestServiceDependencies {
    docClient: DynamoDBDocumentClient;
    integrationTestRepository: IntegrationTestRepository;
    eaApplicationRepository: EAApplicationRepository;
    userProfileRepository: UserProfileRepository;
    logger: Logger;
}

// ========================================
// ハンドラー固有の依存関係インターフェース
// ========================================

/**
 * PostConfirmationHandler の依存関係
 */
export interface PostConfirmationHandlerDependencies {
    masterKeyService: MasterKeyService;
    jwtKeyService: JWTKeyService;
    userProfileRepository: UserProfileRepository;
    logger: Logger;
    tracer: Tracer;
}

/**
 * StartIntegrationTestHandler の依存関係
 */
export interface StartIntegrationTestHandlerDependencies {
    integrationTestService: IntegrationTestService;
    logger: Logger;
    tracer: Tracer;
}

/**
 * ApproveApplicationHandler の依存関係
 */
export interface ApproveApplicationHandlerDependencies {
    eaApplicationRepository: EAApplicationRepository;
    sqsClient: SQSClient;
    logger: Logger;
    tracer: Tracer;
}

/**
 * CancelApprovalHandler の依存関係
 */
export interface CancelApprovalHandlerDependencies {
    eaApplicationRepository: EAApplicationRepository;
    logger: Logger;
    tracer: Tracer;
}

/**
 * GetApplicationHistoriesHandler の依存関係
 */
export interface GetApplicationHistoriesHandlerDependencies {
    eaApplicationRepository: EAApplicationRepository;
    logger: Logger;
    tracer: Tracer;
}

/**
 * GetApplicationsHandler の依存関係
 */
export interface GetApplicationsHandlerDependencies {
    eaApplicationRepository: EAApplicationRepository;
    logger: Logger;
    tracer: Tracer;
}

/**
 * RejectApplicationHandler の依存関係
 */
export interface RejectApplicationHandlerDependencies {
    eaApplicationRepository: EAApplicationRepository;
    logger: Logger;
    tracer: Tracer;
}

/**
 * WebhookHandler の依存関係
 */
export interface WebhookHandlerDependencies {
    eaApplicationRepository: EAApplicationRepository;
    jwtKeyService: JWTKeyService;
    integrationTestService: IntegrationTestService;
    logger: Logger;
    tracer: Tracer;
}

/**
 * GetUserProfileHandler の依存関係
 */
export interface GetUserProfileHandlerDependencies {
    userProfileRepository: UserProfileRepository;
    logger: Logger;
    tracer: Tracer;
}

/**
 * UpdateUserProfileHandler の依存関係
 */
export interface UpdateUserProfileHandlerDependencies {
    userProfileRepository: UserProfileRepository;
    logger: Logger;
    tracer: Tracer;
}

/**
 * EncryptLicenseHandler の依存関係
 */
export interface EncryptLicenseHandlerDependencies {
    masterKeyService: MasterKeyService;
    logger: Logger;
    tracer: Tracer;
}

/**
 * DecryptLicenseHandler の依存関係
 */
export interface DecryptLicenseHandlerDependencies {
    eaApplicationRepository: EAApplicationRepository;
    masterKeyService: MasterKeyService;
    logger: Logger;
    tracer: Tracer;
}

/**
 * RevokeLicenseHandler の依存関係
 */
export interface RevokeLicenseHandlerDependencies {
    eaApplicationRepository: EAApplicationRepository;
    logger: Logger;
    tracer: Tracer;
}

/**
 * CompleteIntegrationTestHandler の依存関係
 */
export interface CompleteIntegrationTestHandlerDependencies {
    jwtKeyService: JWTKeyService;
    integrationTestService: IntegrationTestService;
    docClient: DynamoDBDocumentClient;
    logger: Logger;
    tracer: Tracer;
}

/**
 * TestGasConnectionHandler の依存関係
 */
export interface TestGasConnectionHandlerDependencies {
    jwtKeyService: JWTKeyService;
    docClient: DynamoDBDocumentClient;
    logger: Logger;
    tracer: Tracer;
}

/**
 * RenderGasTemplateHandler の依存関係
 */
export interface RenderGasTemplateHandlerDependencies {
    jwtKeyService: JWTKeyService;
    logger: Logger;
    tracer: Tracer;
}

/**
 * EmailNotificationHandler の依存関係
 */
export interface EmailNotificationHandlerDependencies {
    eaApplicationRepository: EAApplicationRepository;
    masterKeyService: MasterKeyService;
    integrationTestService: IntegrationTestService;
    userProfileRepository: UserProfileRepository;
    ssmClient: SSMClient;
    logger: Logger;
    tracer: Tracer;
}

// ========================================
// リポジトリ固有の依存関係インターフェース
// ========================================

/**
 * IntegrationTestRepository の依存関係
 */
export interface IntegrationTestRepositoryDependencies {
    docClient: DynamoDBDocumentClient;
    logger: Logger;
    tableName: string;
}

/**
 * EAApplicationRepository の依存関係
 */
export interface EAApplicationRepositoryDependencies {
    docClient: DynamoDBDocumentClient;
    logger: Logger;
    tableName: string;
}

/**
 * UserProfileRepository の依存関係
 */
export interface UserProfileRepositoryDependencies {
    docClient: DynamoDBDocumentClient;
    logger: Logger;
    tableName: string;
}

// ========================================
// その他の型定義
// ========================================

/**
 * DIコンテナの設定
 */
export interface ContainerConfig {
    environment: 'development' | 'staging' | 'production';
    region: string;
    tableName: string;
    integrationTestTableName: string;
    logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    serviceName?: string;
}

/**
 * ハンドラーファクトリの型
 */
export type HandlerFactory<TDeps, TEvent, TResult> = (
    dependencies: TDeps
) => (event: TEvent) => Promise<TResult>;