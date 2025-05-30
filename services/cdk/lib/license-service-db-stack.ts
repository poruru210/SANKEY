import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface LicenseServiceDBStackProps extends cdk.StackProps {
    userPool: cognito.UserPool;
}

export class LicenseServiceDbStack extends cdk.Stack {
    public readonly table: dynamodb.Table;

    constructor(scope: Construct, id: string, props: LicenseServiceDBStackProps) {
        super(scope, id, props);

        // DynamoDBテーブル
        this.table = new dynamodb.Table(this, 'EAApplicationsTable', {
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
            // 明示的なテーブル名を設定
            tableName: `ea-applications-${this.stackName.toLowerCase()}`,
        });

        // テーブル名を出力（デバッグ用）
        new cdk.CfnOutput(this, 'EAApplicationsTableName', {
            value: this.table.tableName,
            exportName: `${this.stackName}-TableName`,
        });

        new cdk.CfnOutput(this, 'EAApplicationsTableArn', {
            value: this.table.tableArn,
            exportName: `${this.stackName}-TableArn`,
        });
    }
}