import { asFunction, asValue, AwilixContainer } from 'awilix';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { DIContainer } from '../../di/dependencies';

/**
 * AWS関連のクライアントを登録するモジュール
 */
export function registerAWSModule(container: AwilixContainer<DIContainer>): void {
    // PowerTools
    registerPowerTools(container);

    // AWS SDK Clients
    registerAWSClients(container);
}

/**
 * AWS Lambda PowerToolsの登録
 */
function registerPowerTools(container: AwilixContainer<DIContainer>): void {
    const serviceName = process.env.SERVICE_NAME || 'lambda-service';
    const logLevel = (process.env.LOG_LEVEL as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') || 'INFO';

    const logger = new Logger({
        serviceName,
        logLevel,
    });

    const tracer = new Tracer({
        serviceName,
    });

    container.register({
        logger: asValue(logger),
        tracer: asValue(tracer),
    });
}

/**
 * AWS SDK v3 クライアントの登録
 */
function registerAWSClients(container: AwilixContainer<DIContainer>): void {
    container.register({
        // SSM Client
        ssmClient: asFunction(({ region, tracer }) => {
            const client = new SSMClient({ region });
            return tracer.captureAWSv3Client(client);
        })
            .singleton()
            .inject(() => ({
                region: container.resolve('region'),
                tracer: container.resolve('tracer'),
            })),

        // DynamoDB Client
        ddbClient: asFunction(({ region, tracer }) => {
            const client = new DynamoDBClient({ region });
            return tracer.captureAWSv3Client(client);
        })
            .singleton()
            .inject(() => ({
                region: container.resolve('region'),
                tracer: container.resolve('tracer'),
            })),

        // DynamoDB Document Client
        docClient: asFunction(({ ddbClient }) => {
            return DynamoDBDocumentClient.from(ddbClient, {
                marshallOptions: {
                    removeUndefinedValues: true,
                    convertEmptyValues: false,
                    convertClassInstanceToMap: false,
                },
                unmarshallOptions: {
                    wrapNumbers: false,
                },
            });
        })
            .singleton()
            .inject(() => ({
                ddbClient: container.resolve('ddbClient'),
            })),

        // SQS Client
        sqsClient: asFunction(({ region, tracer }) => {
            const client = new SQSClient({ region });
            return tracer.captureAWSv3Client(client);
        })
            .singleton()
            .inject(() => ({
                region: container.resolve('region'),
                tracer: container.resolve('tracer'),
            })),

        // Cognito Client
        cognitoClient: asFunction(({ region, tracer }) => {
            const client = new CognitoIdentityProviderClient({ region });
            return tracer.captureAWSv3Client(client);
        })
            .singleton()
            .inject(() => ({
                region: container.resolve('region'),
                tracer: container.resolve('tracer'),
            })),

        // API Gateway Client
        apiGatewayClient: asFunction(({ region, tracer }) => {
            const client = new APIGatewayClient({ region });
            return tracer.captureAWSv3Client(client);
        })
            .singleton()
            .inject(() => ({
                region: container.resolve('region'),
                tracer: container.resolve('tracer'),
            })),
    });
}

/**
 * カスタムAWSクライアント設定
 */
export interface AWSClientConfig {
    region?: string;
    endpoint?: string;
    maxAttempts?: number;
    retryMode?: 'standard' | 'adaptive';
}

/**
 * 環境別のAWSクライアント設定を取得
 */
export function getAWSClientConfig(environment: string): AWSClientConfig {
    switch (environment) {
        case 'local':
            return {
                region: 'ap-northeast-1',
                endpoint: process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566',
            };
        case 'test':
            return {
                region: 'ap-northeast-1',
                maxAttempts: 1,
            };
        default:
            return {
                region: process.env.AWS_REGION || 'ap-northeast-1',
                maxAttempts: 3,
                retryMode: 'adaptive',
            };
    }
}