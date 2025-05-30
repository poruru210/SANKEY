import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export interface CognitoAuthStackProps extends cdk.StackProps {
    domainPrefix: string;
    callbackUrls?: string[];
    logoutUrls?: string[];
}

export class CognitoAuthStack extends cdk.Stack {
    public readonly userPool: cognito.UserPool;
    public readonly userPoolDomain: cognito.UserPoolDomain;
    public readonly userPoolClient: cognito.UserPoolClient;
    public readonly postConfirmationFn: NodejsFunction;

    constructor(scope: Construct, id: string, props: CognitoAuthStackProps) {
        super(scope, id, props);

        // Cognito User Pool
        this.userPool = new cognito.UserPool(this, 'LicenseUserPool', {
            userPoolName: 'license-service-users',
            selfSignUpEnabled: true, // 開発者が自分でサインアップ可能
            signInAliases: {
                email: true,
            },
            signInCaseSensitive: false,
            autoVerify: {
                email: true, // メール認証必須
            },
            standardAttributes: {
                email: {
                    required: true,
                    mutable: false,
                },
            },
            customAttributes: {
                apiKeyId: new cognito.StringAttribute({
                    minLen: 1,
                    maxLen: 100,
                    mutable: true,
                }),
                apiKey: new cognito.StringAttribute({
                    minLen: 1,
                    maxLen: 50,
                    mutable: true,
                }),
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            // removalPolicy: cdk.RemovalPolicy.RETAIN, // 本番環境では削除を防ぐ
        });

        // Cognito User Pool Domain (Managed Login)
        this.userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
            cognitoDomain: {
                domainPrefix: props.domainPrefix,
            },
            // AWS CDK v2.177.0以降で利用可能
            managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
        });

        // Cognito User Pool Client
        this.userPoolClient = this.userPool.addClient('LicenseServiceClient', {
            userPoolClientName: 'license-service-client',
            authFlows: {
                userPassword: true,
                userSrp: true,
                adminUserPassword: true,
            },
            generateSecret: true,
            preventUserExistenceErrors: true,
            // OAuth設定
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                },
                scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
                callbackUrls: props.callbackUrls || [
                    'http://localhost:3000/api/auth/callback/cognito',
                    'https://sankey.niraikanai.trade/api/auth/callback/cognito'
                ],
                logoutUrls: props.logoutUrls ||  [
                    'http://localhost:3000/login',
                    'https://sankey.niraikanai.trade/login'
                ],
            },
            // トークンの有効期限設定
            accessTokenValidity: cdk.Duration.hours(1),
            idTokenValidity: cdk.Duration.hours(1),
            refreshTokenValidity: cdk.Duration.days(30),
        });

        // Managed Login Branding（カスタマイズ版）
        new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
            userPoolId: this.userPool.userPoolId,
            clientId: this.userPoolClient.userPoolClientId,
            returnMergedResources: true,
            // デフォルトスタイルを使用する場合
            useCognitoProvidedValues: true,
            // カスタマイズする場合は以下のコメントアウト部分を使用
            /*
            settings: {
              categories: {
                global: {
                  colorSchemeMode: 'DARK', // ダークモード
                  // その他のカスタマイズ設定
                },
              },
            },
            */
        });

        // Lambda: ユーザー作成時のセットアップ (Post Confirmation Trigger)
        this.postConfirmationFn = new NodejsFunction(this, 'PostConfirmationFunction', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/src/handlers/postConfirmation.handler.ts'),
            handler: 'handler',
            environment: {
                SSM_PREFIX: '/license-service/users',
                // API_ID は後でAPIスタックから設定される
            },
            memorySize: 256,
            timeout: cdk.Duration.seconds(30),
        });

        // SSMへの読み書き権限（明示的）
        this.postConfirmationFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ssm:GetParameter',
                'ssm:GetParameters',
                'ssm:PutParameter',
                'ssm:AddTagsToResource',
            ],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/license-service/*`,
            ],
        }));

        // API Gatewayへの管理権限（簡素化版）
        this.postConfirmationFn.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'apigateway:CreateApiKey',
                'apigateway:CreateUsagePlan',
                'apigateway:CreateUsagePlanKey',  // Usage PlanにAPI Keyを紐付ける権限
                'apigateway:GetApiKey',
                'apigateway:GetUsagePlan',
                'apigateway:GetUsagePlanKey',
                'apigateway:PUT',
                'apigateway:POST',
                'apigateway:PATCH',
                'apigateway:TagResource',
            ],
            resources: ['*'],
        }));

        // Cognito管理権限を追加
        this.postConfirmationFn.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'cognito-idp:AdminUpdateUserAttributes',
            ],
            resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`],
        }));

        // CognitoトリガーにLambdaを設定
        this.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, this.postConfirmationFn);

        // 明示的にCognitoからのLambda実行権限を追加
        this.postConfirmationFn.addPermission('CognitoInvokePermission', {
            principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: this.userPool.userPoolArn,
        });

        // 出力
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: this.userPool.userPoolId,
            description: 'Cognito User Pool ID',
            exportName: `${this.stackName}-UserPoolId`,
        });

        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: this.userPoolClient.userPoolClientId,
            description: 'Cognito User Pool Client ID',
            exportName: `${this.stackName}-UserPoolClientId`,
        });

        new cdk.CfnOutput(this, 'UserPoolDomainUrl', {
            value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
            description: 'Cognito User Pool Domain URL',
            exportName: `${this.stackName}-UserPoolDomainUrl`,
        });

        // new cdk.CfnOutput(this, 'HostedUIUrl', {
        //     value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/login?client_id=${this.userPoolClient.userPoolClientId}&response_type=code&scope=openid+email+profile&redirect_uri=${encodeURIComponent((props.callbackUrls || ['http://localhost:3000/callback'])[0])}`,
        //     description: 'Hosted UI Login URL',
        //     exportName: `${this.stackName}-HostedUIUrl`,
        // });
        new cdk.CfnOutput(this, 'HostedUIUrl', {
            value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com/login?client_id=${this.userPoolClient.userPoolClientId}&response_type=code&scope=openid+email+profile&redirect_uri=${encodeURIComponent((props.callbackUrls || ['http://localhost:3000/api/auth/callback/cognito'])[0])}`,
            //                                                                                                                                                                                                                                                                          ↑ここを修正
            description: 'Hosted UI Login URL',
            exportName: `${this.stackName}-HostedUIUrl`,
        });
    }
}