import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

import { EnvironmentConfig } from './environment-settings';
import type {
    CommonTags,
    LambdaCreationOptions,
    DynamoDbCreationOptions,
    OutputConfig,
    Environment
} from '../types/config-types';

/**
 * CDK共通ヘルパークラス
 * リソース命名、作成、設定の統一管理
 */
export class CdkHelpers {
    private static readonly SYSTEM_PREFIX = 'sankey';

    // ==========================================
    // リソース命名関連
    // ==========================================

    /**
     * Lambda関数名を生成
     */
    static generateLambdaName(baseName: string, environment: string): string {
        return `${this.SYSTEM_PREFIX}-${baseName}-${environment}`;
    }

    /**
     * DynamoDBテーブル名を生成
     */
    static generateTableName(baseName: string, environment: string): string {
        return `${this.SYSTEM_PREFIX}-${baseName}-${environment}`;
    }

    /**
     * SQSキュー名を生成
     */
    static generateQueueName(baseName: string, environment: string): string {
        return `${this.SYSTEM_PREFIX}-${baseName}-${environment}`;
    }

    /**
     * Cognitoユーザープール名を生成
     */
    static generateUserPoolName(environment: string): string {
        return `${this.SYSTEM_PREFIX}-users-${environment}`;
    }

    /**
     * API Gateway名を生成
     */
    static generateApiName(environment: string): string {
        return `${this.SYSTEM_PREFIX}-api-${environment}`;
    }

    /**
     * CloudWatch LogGroup名を生成
     */
    static generateLogGroupName(serviceName: string, environment: string): string {
        return `/aws/lambda/${this.SYSTEM_PREFIX}-${serviceName}-${environment}`;
    }

    /**
     * 汎用リソース名生成
     */
    static generateResourceName(baseName: string, environment: string, resourceType?: string): string {
        const parts = [this.SYSTEM_PREFIX, baseName];
        if (resourceType) parts.push(resourceType);
        parts.push(environment);
        return parts.join('-');
    }

    // ==========================================
    // 共通設定・タグ関連
    // ==========================================

    /**
     * 共通タグを生成
     */
    static getCommonTags(environment: string, component?: string): Record<string, string> {
        const tags: Record<string, string> = {
            Environment: environment,
            Project: 'SankeyLicenseService',
            Owner: 'DevTeam',
            ManagedBy: 'CDK',
            DeployedAt: new Date().toISOString(),
        };

        if (component) {
            tags.Component = component;
        }

        return tags;
    }

    /**
     * スコープに共通タグを適用
     */
    static applyCommonTags(scope: Construct, environment: string, component?: string): void {
        const tags = this.getCommonTags(environment, component);
        Object.entries(tags).forEach(([key, value]) => {
            cdk.Tags.of(scope).add(key, value);
        });
    }

    // ==========================================
    // Lambda関連
    // ==========================================

    /**
     * Lambda関数のデフォルト設定を取得
     */
    static getLambdaDefaults(environment: string): Partial<lambda.FunctionProps> {
        const config = EnvironmentConfig.get(environment);

        return {
            runtime: lambda.Runtime.NODEJS_22_X,
            memorySize: config.lambda.memorySize,
            timeout: cdk.Duration.seconds(config.lambda.timeoutSeconds),
            environment: {
                LOG_LEVEL: config.logLevel,
                POWERTOOLS_LOG_LEVEL: config.logLevel,
                ENVIRONMENT: environment,
            },
            tracing: config.monitoring.enableXRayTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.PASS_THROUGH,
        };
    }

    /**
     * Node.js Lambda関数を作成
     */
    static createNodejsFunction(
        scope: Construct,
        id: string,
        baseName: string,
        environment: string,
        options: LambdaCreationOptions
    ): NodejsFunction {
        const functionName = this.generateLambdaName(baseName, environment);
        const defaultProps = this.getLambdaDefaults(environment);

        const lambdaFunction = new NodejsFunction(scope, id, {
            ...defaultProps,
            entry: options.entry,
            handler: 'handler',
            functionName,
            timeout: options.timeout || defaultProps.timeout,
            memorySize: options.memorySize || defaultProps.memorySize,
            environment: {
                ...defaultProps.environment,
                POWERTOOLS_SERVICE_NAME: baseName,
                ...options.environment,
            },
            bundling: options.bundling,
        });

        return lambdaFunction;
    }

    // ==========================================
    // DynamoDB関連
    // ==========================================

    /**
     * DynamoDBテーブルを作成
     */
    static createDynamoTable(
        scope: Construct,
        id: string,
        baseName: string,
        environment: string,
        options: DynamoDbCreationOptions
    ): dynamodb.Table {
        const config = EnvironmentConfig.get(environment);
        const tableName = this.generateTableName(baseName, environment);

        // 課金モードに応じてプロパティを構築
        let tableProps: dynamodb.TableProps;

        if (config.dynamodb.billingMode === 'PAY_PER_REQUEST') {
            tableProps = {
                tableName,
                partitionKey: options.partitionKey,
                sortKey: options.sortKey,
                removalPolicy: config.removalPolicy,
                timeToLiveAttribute: options.timeToLiveAttribute,
                billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            };
        } else {
            tableProps = {
                tableName,
                partitionKey: options.partitionKey,
                sortKey: options.sortKey,
                removalPolicy: config.removalPolicy,
                timeToLiveAttribute: options.timeToLiveAttribute,
                billingMode: dynamodb.BillingMode.PROVISIONED,
                readCapacity: config.dynamodb.readCapacity,
                writeCapacity: config.dynamodb.writeCapacity,
            };
        }

        const table = new dynamodb.Table(scope, id, tableProps);

        // GSIの追加
        if (options.globalSecondaryIndexes) {
            options.globalSecondaryIndexes.forEach(gsi => {
                let gsiProps: dynamodb.GlobalSecondaryIndexProps;

                if (config.dynamodb.billingMode === 'PAY_PER_REQUEST') {
                    gsiProps = {
                        indexName: gsi.indexName,
                        partitionKey: gsi.partitionKey,
                        sortKey: gsi.sortKey,
                        projectionType: gsi.projectionType || dynamodb.ProjectionType.ALL,
                    };
                } else {
                    gsiProps = {
                        indexName: gsi.indexName,
                        partitionKey: gsi.partitionKey,
                        sortKey: gsi.sortKey,
                        projectionType: gsi.projectionType || dynamodb.ProjectionType.ALL,
                        readCapacity: config.dynamodb.readCapacity,
                        writeCapacity: config.dynamodb.writeCapacity,
                    };
                }

                table.addGlobalSecondaryIndex(gsiProps);
            });
        }

        return table;
    }

    // ==========================================
    // SQS関連
    // ==========================================

    /**
     * SQSキューを作成
     */
    static createSqsQueue(
        scope: Construct,
        id: string,
        baseName: string,
        environment: string,
        options: {
            visibilityTimeout?: cdk.Duration;
            retentionPeriod?: cdk.Duration;
            deadLetterQueue?: {
                maxReceiveCount: number;
                retentionPeriod?: cdk.Duration;
            };
        } = {}
    ): sqs.Queue {
        const queueName = this.generateQueueName(baseName, environment);

        let dlq: sqs.Queue | undefined;
        if (options.deadLetterQueue) {
            dlq = new sqs.Queue(scope, `${id}DLQ`, {
                queueName: `${queueName}-dlq`,
                retentionPeriod: options.deadLetterQueue.retentionPeriod || cdk.Duration.days(14),
            });
        }

        const queue = new sqs.Queue(scope, id, {
            queueName,
            visibilityTimeout: options.visibilityTimeout || cdk.Duration.minutes(5),
            retentionPeriod: options.retentionPeriod || cdk.Duration.days(14),
            deadLetterQueue: dlq ? {
                queue: dlq,
                maxReceiveCount: options.deadLetterQueue!.maxReceiveCount,
            } : undefined,
        });

        return queue;
    }

    // ==========================================
    // Cognito関連
    // ==========================================

    /**
     * Cognitoユーザープールを作成
     */
    static createUserPool(
        scope: Construct,
        id: string,
        environment: string
    ): cognito.UserPool {
        const config = EnvironmentConfig.get(environment);
        const userPoolName = this.generateUserPoolName(environment);

        return new cognito.UserPool(scope, id, {
            userPoolName,
            selfSignUpEnabled: true,
            signInAliases: { email: true },
            signInCaseSensitive: false,
            autoVerify: { email: true },
            standardAttributes: {
                email: { required: true, mutable: false },
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: config.removalPolicy,
        });
    }

    /**
     * Cognitoユーザープールクライアントを作成
     */
    static createUserPoolClient(
        scope: Construct,
        id: string,
        userPool: cognito.UserPool,
        environment: string
    ): cognito.UserPoolClient {
        const config = EnvironmentConfig.get(environment);
        const clientName = this.generateResourceName('client', environment);

        return userPool.addClient(id, {
            userPoolClientName: clientName,
            authFlows: {
                userPassword: true,
                userSrp: true,
                adminUserPassword: true,
            },
            generateSecret: true,
            preventUserExistenceErrors: true,
            oAuth: {
                flows: { authorizationCodeGrant: true },
                scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
                callbackUrls: config.auth.callbackUrls,
                logoutUrls: config.auth.logoutUrls,
            },
            accessTokenValidity: cdk.Duration.hours(1),
            idTokenValidity: cdk.Duration.hours(1),
            refreshTokenValidity: cdk.Duration.days(30),
        });
    }

    // ==========================================
    // API Gateway関連
    // ==========================================

    /**
     * デフォルトのCORS設定を取得
     */
    static getDefaultCorsOptions(environment: string): apigw.CorsOptions {
        const config = EnvironmentConfig.get(environment);

        return {
            allowOrigins: config.security.corsOrigins,
            allowMethods: ['OPTIONS', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'],
            allowHeaders: [
                'Content-Type', 'X-Amz-Date', 'Authorization', 'X-API-Key',
                'X-Amz-Security-Token', 'Accept', 'Cache-Control', 'X-Requested-With',
            ],
            allowCredentials: false,
            maxAge: cdk.Duration.seconds(86400),
        };
    }

    /**
     * 標準のメソッドレスポンスを取得
     */
    static getStandardMethodResponses(): apigw.MethodResponse[] {
        return [
            { statusCode: '200' },
            { statusCode: '400' },
            { statusCode: '401' },
            { statusCode: '404' },
            { statusCode: '500' },
        ];
    }

    /**
     * REST API を作成
     */
    static createRestApi(
        scope: Construct,
        id: string,
        environment: string,
        options: {
            description?: string;
            throttlingRateLimit?: number;
            throttlingBurstLimit?: number;
        } = {}
    ): apigw.RestApi {
        const apiName = this.generateApiName(environment);
        const corsOptions = this.getDefaultCorsOptions(environment);

        return new apigw.RestApi(scope, id, {
            restApiName: apiName,
            description: options.description || 'Sankey Application API',
            defaultCorsPreflightOptions: corsOptions,
            deployOptions: {
                stageName: environment,
                throttlingRateLimit: options.throttlingRateLimit || 2,
                throttlingBurstLimit: options.throttlingBurstLimit || 5,
            },
            apiKeySourceType: apigw.ApiKeySourceType.HEADER,
        });
    }

    // ==========================================
    // IAM・セキュリティ関連
    // ==========================================

    /**
     * SSMパラメータアクセス用のポリシーステートメントを作成
     */
    static createSsmPolicy(region: string, account: string, parameterPath: string): iam.PolicyStatement {
        return new iam.PolicyStatement({
            actions: ['ssm:GetParameter', 'ssm:GetParameters'],
            resources: [`arn:aws:ssm:${region}:${account}:parameter${parameterPath}`],
        });
    }

    // ==========================================
    // CloudFormation出力関連
    // ==========================================

    /**
     * CloudFormation出力を作成
     */
    static createOutputs(
        scope: Construct,
        stackName: string,
        outputs: OutputConfig[]
    ): void {
        outputs.forEach(({ id, value, description }) => {
            new cdk.CfnOutput(scope, id, {
                value,
                description,
                exportName: `${stackName}-${id}`,
            });
        });
    }

    // ==========================================
    // ユーティリティ
    // ==========================================

    /**
     * PascalCase変換
     */
    static toPascalCase(str: string): string {
        return str.split('-').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join('');
    }

    /**
     * 環境がProduction環境かチェック
     */
    static isProduction(environment: string): boolean {
        return EnvironmentConfig.isProduction(environment);
    }

    /**
     * 環境設定を取得（再エクスポート）
     */
    static getEnvironmentConfig(environment: string) {
        return EnvironmentConfig.get(environment);
    }
}