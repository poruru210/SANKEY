import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { EnvironmentConfig, CdkHelpers } from './config';

export interface SankeyDbStackProps extends cdk.StackProps {
    userPool: cognito.UserPool;
    environment?: string;
    removalPolicy?: cdk.RemovalPolicy;
}

export class SankeyDbStack extends cdk.Stack {
    public readonly eaApplicationsTable: dynamodb.Table;  // 既存（リネーム）
    public readonly userProfileTable: dynamodb.Table;     // 新規追加
    public readonly ttlMonths: number;
    private readonly envName: string;
    private readonly config: ReturnType<typeof EnvironmentConfig.get>;

    constructor(scope: Construct, id: string, props: SankeyDbStackProps) {
        super(scope, id, props);

        this.envName = props.environment || 'dev';
        this.config = EnvironmentConfig.get(this.envName);

        // 共通タグを適用
        CdkHelpers.applyCommonTags(this, this.envName, 'Database');

        // TTL期間をパラメータとして設定
        const ttlMonthsParam = new cdk.CfnParameter(this, 'TTLMonths', {
            type: 'Number',
            default: this.config.notification.defaultTtlMonths,
            minValue: 1,
            maxValue: 60,
            description: 'Number of months after which terminal status records will be automatically deleted',
            constraintDescription: 'Must be between 1 and 60 months'
        });

        this.ttlMonths = ttlMonthsParam.valueAsNumber;

        // EAアプリケーション用DynamoDBテーブルの作成
        this.eaApplicationsTable = CdkHelpers.createDynamoTable(
            this,
            'EAApplicationsTable',
            'applications',
            this.envName,
            {
                partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
                sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
                timeToLiveAttribute: 'ttl',
            }
        );

        // BrokerAccountIndex GSI を追加
        this.eaApplicationsTable.addGlobalSecondaryIndex({
            indexName: 'BrokerAccountIndex',
            partitionKey: { name: 'broker', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'accountNumber', type: dynamodb.AttributeType.STRING },
            readCapacity: 1,
            writeCapacity: 1,
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // StatusIndex GSI も追加（統合テスト判定用）
        this.eaApplicationsTable.addGlobalSecondaryIndex({
            indexName: 'StatusIndex',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
            readCapacity: 1,
            writeCapacity: 1,
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // ユーザープロファイル用DynamoDBテーブルの作成
        this.userProfileTable = CdkHelpers.createDynamoTable(
            this,
            'UserProfileTable',
            'user-profiles',
            this.envName,
            {
                partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
                readCapacity: 1,
                writeCapacity: 1,
            }
        );

        this.addTableTags();
        this.createOutputs();
    }

    /**
     * テーブルタグの追加
     */
    private addTableTags() {
        const additionalTags = {
            TTLMonths: this.ttlMonths.toString(),
            TTLDescription: "Records deleted after configured months",
            BillingMode: this.config.dynamodb.billingMode,
            Environment: this.envName,
        };

        // EAアプリケーションテーブルにタグ追加
        Object.entries(additionalTags).forEach(([key, value]) => {
            cdk.Tags.of(this.eaApplicationsTable).add(key, value);
        });

        // ユーザープロファイルテーブルにタグ追加（TTL関連タグは除外）
        const profileTableTags = {
            BillingMode: this.config.dynamodb.billingMode,
            Environment: this.envName,
            TableType: 'UserProfile',
            DataRetention: 'Permanent',
        };

        Object.entries(profileTableTags).forEach(([key, value]) => {
            cdk.Tags.of(this.userProfileTable).add(key, value);
        });
    }

    /**
     * 出力の作成
     */
    private createOutputs() {
        const outputs = [
            // EAアプリケーションテーブル関連
            {
                id: 'SankeyTableName',
                value: this.eaApplicationsTable.tableName,
                description: 'EA Applications DynamoDB Table Name'
            },
            {
                id: 'SankeyTableArn',
                value: this.eaApplicationsTable.tableArn,
                description: 'EA Applications DynamoDB Table ARN'
            },
            {
                id: 'TTLAttributeName',
                value: 'ttl',
                description: 'TTL attribute name for automatic deletion'
            },
            {
                id: 'TTLMonthsValue',
                value: this.ttlMonths.toString(),
                description: "TTL period in months"
            },
            {
                id: 'TTLConfiguration',
                value: JSON.stringify({
                    tableName: this.eaApplicationsTable.tableName,
                    ttlAttribute: 'ttl',
                    ttlMonths: this.ttlMonths,
                    terminalStatuses: ['Expired', 'Revoked', 'Rejected', 'Cancelled']
                }),
                description: 'Complete TTL configuration for Lambda functions'
            },
            // ユーザープロファイルテーブル関連
            {
                id: 'UserProfileTableName',
                value: this.userProfileTable.tableName,
                description: 'User Profile DynamoDB Table Name'
            },
            {
                id: 'UserProfileTableArn',
                value: this.userProfileTable.tableArn,
                description: 'User Profile DynamoDB Table ARN'
            },
        ];

        CdkHelpers.createOutputs(this, this.stackName, outputs);
    }
}