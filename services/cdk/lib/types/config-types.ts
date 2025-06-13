import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

/**
 * ログレベルの型定義
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * 環境名の型定義
 */
export type Environment = 'dev' | 'prod';

/**
 * DynamoDB課金モードの型定義
 */
export type DynamoDbBillingMode = 'PROVISIONED' | 'PAY_PER_REQUEST';

/**
 * Lambda設定の型定義
 */
export interface LambdaSettings {
    memorySize: number;
    timeoutSeconds: number;
    runtime: string;
}

/**
 * DynamoDB設定の型定義
 */
export interface DynamoDbSettings {
    billingMode: DynamoDbBillingMode;
    readCapacity?: number;
    writeCapacity?: number;
}

/**
 * モニタリング設定の型定義
 */
export interface MonitoringSettings {
    enableDetailedMonitoring: boolean;
    enableXRayTracing: boolean;
    createAlarms: boolean;
}

/**
 * セキュリティ設定の型定義
 */
export interface SecuritySettings {
    enableDeletionProtection: boolean;
    corsOrigins: string[];
}

/**
 * 認証設定の型定義
 */
export interface AuthSettings {
    authDomainPrefix: string;
    callbackUrls: string[];
    logoutUrls: string[];
}

/**
 * 通知設定の型定義
 */
export interface NotificationSettings {
    emailFromAddress: string;
    defaultTtlMonths: number;
    sqsDelaySeconds: number;
}

/**
 * 環境別設定の型定義
 */
export interface EnvironmentSettings {
    // 基本設定
    logLevel: LogLevel;
    removalPolicy: cdk.RemovalPolicy;
    domain: string;

    // セキュリティ設定
    security: SecuritySettings;

    // 認証設定
    auth: AuthSettings;

    // Lambda設定
    lambda: LambdaSettings;

    // DynamoDB設定
    dynamodb: DynamoDbSettings;

    // モニタリング設定
    monitoring: MonitoringSettings;

    // 通知設定
    notification: NotificationSettings;
}

/**
 * リソース命名のオプション
 */
export interface ResourceNamingOptions {
    prefix?: string;
    suffix?: string;
    includeEnvironment?: boolean;
}

/**
 * Lambda作成オプション
 */
export interface LambdaCreationOptions {
    entry: string;
    timeout?: cdk.Duration;
    memorySize?: number;
    environment?: Record<string, string>;
    bundling?: any;
}

/**
 * DynamoDB作成オプション
 */
export interface DynamoDbCreationOptions {
    partitionKey: { name: string; type: dynamodb.AttributeType };
    sortKey?: { name: string; type: dynamodb.AttributeType };
    timeToLiveAttribute?: string;
    globalSecondaryIndexes?: GlobalSecondaryIndexConfig[];
    // 個別のキャパシティ設定を追加
    readCapacity?: number;
    writeCapacity?: number;
    // 課金モードの個別指定も可能にする
    billingMode?: DynamoDbBillingMode;
}

/**
 * Global Secondary Index設定
 */
export interface GlobalSecondaryIndexConfig {
    indexName: string;
    partitionKey: { name: string; type: dynamodb.AttributeType };
    sortKey?: { name: string; type: dynamodb.AttributeType };
    projectionType?: dynamodb.ProjectionType;
    // GSI個別のキャパシティ設定
    readCapacity?: number;
    writeCapacity?: number;
}

/**
 * CloudFormation出力設定
 */
export interface OutputConfig {
    id: string;
    value: string;
    description: string;
}

/**
 * 共通タグの型定義
 */
export interface CommonTags {
    Environment: string;
    Project: string;
    Owner: string;
    ManagedBy: string;
    Component?: string;
    DeployedAt: string;
    [key: string]: string | undefined;
}