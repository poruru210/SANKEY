import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { EnvironmentConfig, CdkHelpers } from './config';

export interface SankeyNotificationStackProps extends cdk.StackProps {
    eaApplicationsTable: dynamodb.Table;
    environment?: string;
}

export class SankeyNotificationStack extends cdk.Stack {
    public readonly licenseNotificationQueue: sqs.Queue;
    public readonly emailNotificationFunction: NodejsFunction;
    private readonly envName: string;
    private readonly config: ReturnType<typeof EnvironmentConfig.get>;

    constructor(scope: Construct, id: string, props: SankeyNotificationStackProps) {
        super(scope, id, props);

        this.envName = props.environment || 'dev';
        this.config = EnvironmentConfig.get(this.envName);

        // 共通タグを適用
        CdkHelpers.applyCommonTags(this, this.envName, 'Notification');

        // 初期化順序を明確にし、プロパティの初期化を保証
        this.licenseNotificationQueue = this.createNotificationQueue();
        this.emailNotificationFunction = this.createEmailNotificationFunction(props);
        this.setupEventSources();
        this.createOutputs();
    }

    /**
     * 通知キューの作成
     */
    private createNotificationQueue(): sqs.Queue {
        return CdkHelpers.createSqsQueue(
            this,
            'LicenseNotificationQueue',
            'license-notification-queue',
            this.envName,
            {
                visibilityTimeout: cdk.Duration.minutes(15),
                retentionPeriod: cdk.Duration.days(14),
                deadLetterQueue: {
                    maxReceiveCount: 3,
                    retentionPeriod: cdk.Duration.days(14),
                },
            }
        );
    }

    /**
     * メール通知Lambda関数の作成
     */
    private createEmailNotificationFunction(props: SankeyNotificationStackProps): NodejsFunction {
        const emailNotificationFunction = CdkHelpers.createNodejsFunction(
            this,
            'EmailNotificationFunction',
            'email-notification',
            this.envName,
            {
                entry: path.join(__dirname, '../../lambda/src/handlers/notifications/emailNotification.handler.ts'),
                timeout: cdk.Duration.minutes(5),
                environment: {
                    TABLE_NAME: props.eaApplicationsTable.tableName,
                    RESEND_API_KEY_PARAM: '/license-service/resend/api-key',
                    EMAIL_FROM_ADDRESS: this.config.notification.emailFromAddress,
                    SSM_PREFIX: '/license-service/users',
                    POWERTOOLS_SERVICE_NAME: 'email-notification',
                },
            }
        );

        this.setupEmailFunctionPermissions(props, emailNotificationFunction);

        return emailNotificationFunction;
    }

    /**
     * メール送信Lambda関数の権限設定
     */
    private setupEmailFunctionPermissions(props: SankeyNotificationStackProps, emailFunction: NodejsFunction) {
        // DynamoDB権限
        props.eaApplicationsTable.grantReadWriteData(emailFunction);

        // SSMポリシーの追加
        const ssmPolicy = CdkHelpers.createSsmPolicy(
            this.region,
            this.account,
            '/license-service/*'
        );
        emailFunction.addToRolePolicy(ssmPolicy);
    }

    /**
     * SQSイベントソースの設定
     */
    private setupEventSources() {
        this.emailNotificationFunction.addEventSource(
            new lambdaEventSources.SqsEventSource(this.licenseNotificationQueue, {
                batchSize: 1,
                maxBatchingWindow: cdk.Duration.seconds(10),
            })
        );
    }

    /**
     * 出力の作成
     */
    private createOutputs() {
        const outputs = [
            {
                id: 'LicenseNotificationQueueUrl',
                value: this.licenseNotificationQueue.queueUrl,
                description: 'License Notification SQS Queue URL',
            },
            {
                id: 'LicenseNotificationQueueArn',
                value: this.licenseNotificationQueue.queueArn,
                description: 'License Notification SQS Queue ARN',
            },
            {
                id: 'EmailNotificationFunctionArn',
                value: this.emailNotificationFunction.functionArn,
                description: 'Email Notification Lambda Function ARN',
            },
            {
                id: 'EmailNotificationFunctionName',
                value: this.emailNotificationFunction.functionName,
                description: 'Email Notification Lambda Function Name',
            },
        ];

        CdkHelpers.createOutputs(this, this.stackName, outputs);
    }
}