import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { EnvironmentConfig, CdkHelpers } from './config';

export interface SankeyAuthStackProps extends cdk.StackProps {
    domainPrefix: string;
    callbackUrls?: string[];
    logoutUrls?: string[];
    environment?: string;
    removalPolicy?: cdk.RemovalPolicy;
    postConfirmationFunctionArn?: string; // Added prop
}

export class SankeyAuthStack extends cdk.Stack {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolDomain: cognito.UserPoolDomain;
    public readonly userPoolClient: cognito.UserPoolClient;
    private readonly envName: string;
    private readonly config: ReturnType<typeof EnvironmentConfig.get>;

    constructor(scope: Construct, id: string, props: SankeyAuthStackProps) {
        super(scope, id, props);

        this.envName = props.environment || 'dev';
        this.config = EnvironmentConfig.get(this.envName);

        // 共通タグを適用
        CdkHelpers.applyCommonTags(this, this.envName, 'Auth');

        // Cognito User Pool
        this.userPool = CdkHelpers.createUserPool(this, 'LicenseUserPool', this.envName);

        // Cognito User Pool Domain
        this.userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
            cognitoDomain: { domainPrefix: props.domainPrefix },
            managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
        });

        // Cognito User Pool Client
        this.userPoolClient = CdkHelpers.createUserPoolClient(
            this,
            'LicenseServiceClient',
            this.userPool,
            this.envName
        );

        // Managed Login Branding
        new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
            userPoolId: this.userPool.userPoolId,
            clientId: this.userPoolClient.userPoolClientId,
            returnMergedResources: true,
            useCognitoProvidedValues: true,
        });

        // Set Lambda trigger if ARN is provided
        if (props.postConfirmationFunctionArn) {
          const cfnUserPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
          // Using addPropertyOverride to avoid issues with spreading potentially tokenized lambdaConfig
          cfnUserPool.addPropertyOverride('LambdaConfig.PostConfirmation', props.postConfirmationFunctionArn);
        }

        this.createOutputs(props);
    }

    /**
     * 出力の作成
     */
    private createOutputs(props: SankeyAuthStackProps) {
        const outputs = [
            {
                id: 'UserPoolId',
                value: this.userPool.userPoolId,
                description: 'Cognito User Pool ID'
            },
            {
                id: 'UserPoolClientId',
                value: this.userPoolClient.userPoolClientId,
                description: 'Cognito User Pool Client ID'
            },
            {
                id: 'UserPoolDomainUrl',
                value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
                description: 'Cognito User Pool Domain URL'
            },
            {
                id: 'HostedUIUrl',
                value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/login?client_id=${this.userPoolClient.userPoolClientId}&response_type=code&scope=openid+email+profile&redirect_uri=${encodeURIComponent((this.config.auth.callbackUrls)[0])}`,
                description: 'Hosted UI Login URL'
            },
        ];

        CdkHelpers.createOutputs(this, this.stackName, outputs);
    }
}