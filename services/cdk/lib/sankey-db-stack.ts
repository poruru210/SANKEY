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
    public readonly table: dynamodb.Table;
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

        // DynamoDBテーブルの作成（GSIなし）
        this.table = CdkHelpers.createDynamoTable(
            this,
            'EAApplicationsTable',
            'applications',
            this.envName,
            {
                partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
                sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
                timeToLiveAttribute: 'ttl',
                // globalSecondaryIndexes を削除
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

        Object.entries(additionalTags).forEach(([key, value]) => {
            cdk.Tags.of(this.table).add(key, value);
        });
    }

    /**
     * 出力の作成
     */
    private createOutputs() {
        const outputs = [
            {
                id: 'SankeyTableName',
                value: this.table.tableName,
                description: 'DynamoDB Table Name'
            },
            {
                id: 'SankeyTableArn',
                value: this.table.tableArn,
                description: 'DynamoDB Table ARN'
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
                    tableName: this.table.tableName,
                    ttlAttribute: 'ttl',
                    ttlMonths: this.ttlMonths,
                    terminalStatuses: ['Expired', 'Revoked', 'Rejected', 'Cancelled']
                }),
                description: 'Complete TTL configuration for Lambda functions'
            },
        ];

        CdkHelpers.createOutputs(this, this.stackName, outputs);
    }
}