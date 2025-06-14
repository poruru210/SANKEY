import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { EnvironmentConfig } from './config'; // Corrected path
import { CdkHelpers } from './config/cdk-helpers'; // Corrected path

export interface SankeyTriggersStackProps extends cdk.StackProps {
  // userPoolArn: string; // No longer needed if we use wildcard ARN
  userProfileTable: dynamodb.Table;
  envConfig: EnvironmentConfig;
}

export class SankeyTriggersStack extends cdk.Stack {
  public readonly postConfirmationFn: lambda.NodejsFunction;

  constructor(scope: Construct, id: string, props: SankeyTriggersStackProps) {
    super(scope, id, props);

    const region = cdk.Stack.of(this).region;
    const account = cdk.Stack.of(this).account;
    const generalUserPoolArn = `arn:aws:cognito-idp:${region}:${account}:userpool/*`;

    this.postConfirmationFn = new lambda.NodejsFunction(
      this,
      'PostConfirmationFunction',
      {
        entry: '../lambda/src/handlers/postConfirmation.handler.ts', // Corrected path
        handler: 'handler',
        environment: {
          USER_PROFILE_TABLE_NAME: props.userProfileTable.tableName,
          // USER_POOL_ID is often needed by the lambda logic if it makes cognito calls by user pool id
          // This would require passing userPoolId if the lambda needs it. For now, assume not.
        },
      }
    );

    // props.userPool.addTrigger( cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationFn ); // Removed to break cycle

    props.userProfileTable.grantWriteData(this.postConfirmationFn); // Corrected to use class member

    // Add permission for Cognito to invoke this Lambda function
    this.postConfirmationFn.addPermission('CognitoInvokePermissionTriggers', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: generalUserPoolArn, // Use wildcard ARN for permission source
    });

    // Add necessary permissions for the PostConfirmationFunction
    this.postConfirmationFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminUpdateUserAttributes',
        ],
        resources: [generalUserPoolArn], // Use wildcard ARN for IAM policy resources
      })
    );

    // Output the function name
    new cdk.CfnOutput(this, 'PostConfirmationFunctionName', {
      value: this.postConfirmationFn.functionName,
    });
  }
}
