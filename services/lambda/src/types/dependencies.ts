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

    // Config
    environment: string;
    region: string;
    tableName: string;
    integrationTestTableName: string;
}
