import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface NotificationStackProps extends cdk.StackProps {
    eaApplicationsTable: dynamodb.Table;
}

export class NotificationStack extends cdk.Stack {
    public readonly licenseNotificationQueue: sqs.Queue;
    public readonly emailNotificationFunction: NodejsFunction;
    public readonly cancelApprovalFunction: NodejsFunction;

    constructor(scope: Construct, id: string, props: NotificationStackProps) {
        super(scope, id, props);

        // SQSキュー作成（ライセンス通知用）
        this.licenseNotificationQueue = new sqs.Queue(this, 'LicenseNotificationQueue', {
            queueName: `license-notification-queue-${this.stackName.toLowerCase()}`,
            visibilityTimeout: cdk.Duration.minutes(15),
            retentionPeriod: cdk.Duration.days(14),
            deadLetterQueue: {
                queue: new sqs.Queue(this, 'LicenseNotificationDLQ', {
                    queueName: `license-notification-dlq-${this.stackName.toLowerCase()}`,
                    retentionPeriod: cdk.Duration.days(14),
                }),
                maxReceiveCount: 3,
            },
        });

        // メール送信Lambda
        this.emailNotificationFunction = new NodejsFunction(this, 'EmailNotificationFunction', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/src/handlers/emailNotification.handler.ts'),
            handler: 'handler',
            environment: {
                TABLE_NAME: props.eaApplicationsTable.tableName,
                RESEND_API_KEY_PARAM: '/license-service/resend/api-key',
                LOG_LEVEL: 'DEBUG',
                POWERTOOLS_SERVICE_NAME: 'email-notification',
                POWERTOOLS_LOG_LEVEL: 'DEBUG',
            },
            memorySize: 256,
            timeout: cdk.Duration.minutes(5),
        });

        // DynamoDB権限
        props.eaApplicationsTable.grantReadWriteData(this.emailNotificationFunction);

        // SSM権限（Resend API Key取得用）
        this.emailNotificationFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ssm:GetParameter'],
            resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/license-service/resend/api-key`],
        }));

        // SQSイベントソース
        this.emailNotificationFunction.addEventSource(new lambdaEventSources.SqsEventSource(this.licenseNotificationQueue, {
            batchSize: 1,
            maxBatchingWindow: cdk.Duration.seconds(10),
        }));

        // 取り消しAPI用Lambda
        this.cancelApprovalFunction = new NodejsFunction(this, 'CancelApprovalFunction', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/src/handlers/cancelApproval.handler.ts'),
            handler: 'handler',
            environment: {
                TABLE_NAME: props.eaApplicationsTable.tableName,
                LOG_LEVEL: 'DEBUG',
                POWERTOOLS_SERVICE_NAME: 'cancel-approval',
                POWERTOOLS_LOG_LEVEL: 'DEBUG',
            },
            memorySize: 256,
            timeout: cdk.Duration.seconds(10),
        });

        // DynamoDB権限
        props.eaApplicationsTable.grantReadWriteData(this.cancelApprovalFunction);

        // Resend API Key用SSMパラメータ作成（SecureString）
        new ssm.StringParameter(this, 'ResendApiKeyParameter', {
            parameterName: '/license-service/resend/api-key',
            stringValue: 'REPLACE_WITH_ACTUAL_RESEND_API_KEY', // 手動で更新する
            description: 'Resend API Key for email notifications',
            // type プロパティを削除（デフォルトでSecureStringになる）
        });

        // 出力
        new cdk.CfnOutput(this, 'LicenseNotificationQueueUrl', {
            value: this.licenseNotificationQueue.queueUrl,
            description: 'License Notification SQS Queue URL',
            exportName: `${this.stackName}-QueueUrl`,
        });

        new cdk.CfnOutput(this, 'LicenseNotificationQueueArn', {
            value: this.licenseNotificationQueue.queueArn,
            description: 'License Notification SQS Queue ARN',
            exportName: `${this.stackName}-QueueArn`,
        });

        new cdk.CfnOutput(this, 'EmailNotificationFunctionArn', {
            value: this.emailNotificationFunction.functionArn,
            description: 'Email Notification Lambda Function ARN',
            exportName: `${this.stackName}-EmailFunctionArn`,
        });

        new cdk.CfnOutput(this, 'CancelApprovalFunctionArn', {
            value: this.cancelApprovalFunction.functionArn,
            description: 'Cancel Approval Lambda Function ARN',
            exportName: `${this.stackName}-CancelFunctionArn`,
        });
    }
}