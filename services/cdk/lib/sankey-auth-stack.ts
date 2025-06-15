import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EnvironmentConfig, CdkHelpers } from './config';
import { TableNames } from './config/table-names';

export interface SankeyAuthStackProps extends cdk.StackProps {
    domainPrefix: string;
    callbackUrls?: string[];
    logoutUrls?: string[];
    environment?: string;
    removalPolicy?: cdk.RemovalPolicy;
}

export class SankeyAuthStack extends cdk.Stack {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolDomain: cognito.UserPoolDomain;
    public readonly userPoolClient: cognito.UserPoolClient;
    public readonly postConfirmationFn: NodejsFunction;
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

        // Lambda: Post Confirmation Trigger
        this.postConfirmationFn = this.createPostConfirmationFunction();
        this.setupPostConfirmationPermissions();
        this.setupTriggers();
        this.createOutputs(props);
    }

    /**
     * Post Confirmation Lambda関数の作成
     */
    private createPostConfirmationFunction(): NodejsFunction {
        return CdkHelpers.createNodejsFunction(
            this,
            'PostConfirmationFunction',
            'post-confirmation',
            this.envName,
            {
                entry: path.join(__dirname, '../../lambda/src/handlers/postConfirmation.handler.ts'),
                environment: {
                    SSM_USER_PREFIX: CdkHelpers.getSsmUserPrefix(this.envName),
                    USER_PROFILE_TABLE_NAME: TableNames.getUserProfileTableName(this.envName),  // 一元管理された関数を使用
                    POWERTOOLS_SERVICE_NAME: 'post-confirmation',
                },
            }
        );
    }

    /**
     * Post Confirmation Lambda の権限設定
     */
    private setupPostConfirmationPermissions() {
        // SSM権限
        this.postConfirmationFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:PutParameter', 'ssm:AddTagsToResource'],
            resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${CdkHelpers.getSsmEnvironmentPrefix(this.envName)}/*`],
        }));

        // DynamoDB権限（テーブル名を直接指定）
        const userProfileTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${TableNames.getUserProfileTableName(this.envName)}`;
        this.postConfirmationFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:GetItem'],
            resources: [userProfileTableArn],
        }));
    }

    /**
     * Cognitoトリガーの設定
     */
    private setupTriggers() {
        this.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, this.postConfirmationFn);

        this.postConfirmationFn.addPermission('CognitoInvokePermission', {
            principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: this.userPool.userPoolArn,
        });
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