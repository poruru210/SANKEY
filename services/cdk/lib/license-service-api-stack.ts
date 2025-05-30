import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface LicenseServiceApiStackProps extends cdk.StackProps {
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
    eaApplicationsTable: dynamodb.Table;
    licenseNotificationQueue: sqs.Queue;
    cancelApprovalFunction: NodejsFunction;
}

export class LicenseServiceApiStack extends cdk.Stack {
    public readonly api: apigw.RestApi;
    public readonly authorizer: apigw.CognitoUserPoolsAuthorizer;

    // 共通CORS設定
    private readonly corsOptions: apigw.CorsOptions = {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
            'Content-Type',
            'X-Amz-Date',
            'Authorization',
            'X-Api-Key',
            'X-Amz-Security-Token',
            'Accept',
            'Cache-Control',
            'X-Requested-With',
        ],
        allowCredentials: false,
        maxAge: cdk.Duration.seconds(86400), // 24時間キャッシュ
    };

    constructor(scope: Construct, id: string, props: LicenseServiceApiStackProps) {
        super(scope, id, props);

        // REST API（CORS設定を強化）
        this.api = new apigw.RestApi(this, 'LicenseApi', {
            restApiName: 'LicenseServiceApi',
            description: 'License Service API with full CORS support',
            defaultCorsPreflightOptions: this.corsOptions,
            deployOptions: {
                stageName: 'prod',
                throttlingRateLimit: 2,
                throttlingBurstLimit: 5,
            },
            apiKeySourceType: apigw.ApiKeySourceType.HEADER,
        });

        // Gateway Response for CORS errors（別途作成）
        this.createGatewayResponses();

        // Cognito Authorizer
        this.authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'LicenseApiAuthorizer', {
            cognitoUserPools: [props.userPool],
            authorizerName: 'CognitoAuthorizer',
            identitySource: 'method.request.header.Authorization',
        });

        // ヘルスチェックエンドポイント（認証不要）
        this.createHealthEndpoint();

        // 各エンドポイントグループの作成
        this.createLicenseEndpoints(props);
        this.createAdminEndpoints(props);
        const userResource = this.createUserEndpoints(props);
        this.createEAApplicationsEndpoints(props.eaApplicationsTable, userResource);

        // Usage Plans作成
        const usagePlans = this.createUsagePlans();

        // 出力とSSMパラメータ
        this.createOutputsAndParameters(usagePlans);
    }

    // Gateway Responses作成
    private createGatewayResponses() {
        new apigw.GatewayResponse(this, 'Default4xxGatewayResponse', {
            restApi: this.api,
            type: apigw.ResponseType.DEFAULT_4XX,
            responseHeaders: {
                'Access-Control-Allow-Origin': "'*'",
                'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With'",
                'Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
            },
        });

        new apigw.GatewayResponse(this, 'Default5xxGatewayResponse', {
            restApi: this.api,
            type: apigw.ResponseType.DEFAULT_5XX,
            responseHeaders: {
                'Access-Control-Allow-Origin': "'*'",
                'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With'",
                'Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
            },
        });

        // CORS用のOPTIONSレスポンス
        new apigw.GatewayResponse(this, 'CorsGatewayResponse', {
            restApi: this.api,
            type: apigw.ResponseType.DEFAULT_4XX,
            responseHeaders: {
                'Access-Control-Allow-Origin': "'*'",
                'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With'",
                'Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
            },
        });
    }

    // ヘルスチェックエンドポイント作成（Mock Integration使用）
    private createHealthEndpoint() {
        // /health エンドポイント（認証不要、CORS設定付き）
        const healthResource = this.api.root.addResource('health', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        // Mock Integrationでシンプルなヘルスチェック（Lambda不要）
        const healthCheckIntegration = new apigw.MockIntegration({
            integrationResponses: [{
                statusCode: '200',
                responseParameters: {
                    'method.response.header.Access-Control-Allow-Origin': "'*'",
                    'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With'",
                    'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
                },
                responseTemplates: {
                    'application/json': JSON.stringify({
                        status: 'ok',
                        timestamp: '$context.requestTime',
                        message: 'License Service API is healthy',
                        version: '1.0.0'
                    })
                }
            }],
            requestTemplates: {
                'application/json': '{"statusCode": 200}'
            }
        });

        healthResource.addMethod('GET', healthCheckIntegration, {
            authorizationType: apigw.AuthorizationType.NONE, // 認証不要
            apiKeyRequired: false, // APIキー不要
            methodResponses: [{
                statusCode: '200',
                responseParameters: {
                    'method.response.header.Access-Control-Allow-Origin': true,
                    'method.response.header.Access-Control-Allow-Headers': true,
                    'method.response.header.Access-Control-Allow-Methods': true,
                },
                responseModels: {
                    'application/json': apigw.Model.EMPTY_MODEL
                }
            }]
        });
    }

    // ライセンス生成エンドポイント作成（SQS統合付き）
    private createLicenseEndpoints(props: LicenseServiceApiStackProps) {
        // メインのLambda関数（ライセンス生成 + DB更新 + SQS送信）
        const lambdaFn = new NodejsFunction(this, 'LicenseGeneratorFunction', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/src/handlers/licenseGenerator.handler.ts'),
            handler: 'handler',
            environment: {
                SSM_PREFIX: '/license-service/users',
                LOG_LEVEL: 'DEBUG',
                POWERTOOLS_SERVICE_NAME: 'license-generator',
                POWERTOOLS_LOG_LEVEL: 'DEBUG',
                TABLE_NAME: props.eaApplicationsTable.tableName,
                NOTIFICATION_QUEUE_URL: props.licenseNotificationQueue.queueUrl,
            },
            memorySize: 256,
            timeout: cdk.Duration.seconds(30),
        });

        // 権限付与
        lambdaFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ssm:GetParameter'],
            resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/license-service/users/*/master-key`],
        }));

        // DynamoDB権限
        props.eaApplicationsTable.grantReadWriteData(lambdaFn);

        // SQS権限
        props.licenseNotificationQueue.grantSendMessages(lambdaFn);

        // /generate エンドポイント（CORS設定付き）
        const generateResource = this.api.root.addResource('generate', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        generateResource.addMethod(
            'POST',
            new apigw.LambdaIntegration(lambdaFn, {
                requestTemplates: {
                    'application/json': JSON.stringify({
                        body: '$input.body',
                        userId: '$context.authorizer.claims.sub',
                        apiKey: '$context.identity.apiKey',
                    }),
                },
            }),
            {
                authorizationType: apigw.AuthorizationType.COGNITO,
                authorizer: this.authorizer,
                apiKeyRequired: true,
            }
        );
    }

    // 管理者向けエンドポイント作成
    private createAdminEndpoints(props: LicenseServiceApiStackProps) {
        // API管理用エンドポイント（管理者のみ、CORS設定付き）
        const adminResource = this.api.root.addResource('admin', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        // プラン管理エンドポイント
        this.createAdminPlanEndpoints(adminResource);

        // 取り消しエンドポイント追加
        this.createCancelEndpoints(adminResource, props.cancelApprovalFunction);
    }

    // 取り消しエンドポイント作成
    private createCancelEndpoints(adminResource: apigw.Resource, cancelFunction: NodejsFunction) {
        const cancelResource = adminResource.addResource('cancel', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        const applicationCancelResource = cancelResource.addResource('{applicationKey}', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        applicationCancelResource.addMethod(
            'POST',
            new apigw.LambdaIntegration(cancelFunction),
            {
                authorizationType: apigw.AuthorizationType.COGNITO,
                authorizer: this.authorizer,
                apiKeyRequired: true,
            }
        );
    }

    // 管理者向けプラン管理エンドポイント
    private createAdminPlanEndpoints(adminResource: apigw.Resource) {
        // プラン変更エンドポイント
        const changePlanFn = new NodejsFunction(this, 'AdminChangePlanFunction', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/src/handlers/changePlan.handler.ts'),
            handler: 'handler',
            environment: {},
            memorySize: 256,
            timeout: cdk.Duration.seconds(30),
        });

        // SSMとAPI Gateway権限
        changePlanFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ssm:GetParameter'],
            resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/license-service/usage-plans/*`],
        }));

        changePlanFn.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'apigateway:CreateUsagePlanKey',
                'apigateway:DeleteUsagePlanKey',
                'apigateway:GetUsagePlanKeys',
            ],
            resources: ['*'],
        }));

        // プラン関連エンドポイント（CORS設定付き）
        const plansResource = adminResource.addResource('plans', {
            defaultCorsPreflightOptions: this.corsOptions,
        });
        const changePlanResource = plansResource.addResource('change', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        changePlanResource.addMethod(
            'POST',
            new apigw.LambdaIntegration(changePlanFn),
            {
                authorizationType: apigw.AuthorizationType.COGNITO,
                authorizer: this.authorizer,
                apiKeyRequired: true,
            }
        );
    }

    // ユーザー向けエンドポイント作成
    private createUserEndpoints(props: LicenseServiceApiStackProps): apigw.Resource {
        // ユーザー向けエンドポイント（CORS設定付き）
        const userResource = this.api.root.addResource('user', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        // プラン関連エンドポイント
        this.createUserPlanEndpoints(userResource);

        return userResource;
    }

    // ユーザー向けプラン管理エンドポイント
    private createUserPlanEndpoints(userResource: apigw.Resource) {
        const userPlanResource = userResource.addResource('plan', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        // プラン変更エンドポイント
        const userChangePlanResource = userPlanResource.addResource('change', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        // プラン変更Lambda（ユーザー用）
        const changePlanFn = new NodejsFunction(this, 'UserChangePlanFunction', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/src/handlers/changePlan.handler.ts'),
            handler: 'handler',
            environment: {},
            memorySize: 256,
            timeout: cdk.Duration.seconds(30),
        });

        // SSMとAPI Gateway権限
        changePlanFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ssm:GetParameter'],
            resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/license-service/usage-plans/*`],
        }));

        changePlanFn.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'apigateway:CreateUsagePlanKey',
                'apigateway:DeleteUsagePlanKey',
                'apigateway:GetUsagePlanKeys',
            ],
            resources: ['*'],
        }));

        userChangePlanResource.addMethod(
            'POST',
            new apigw.LambdaIntegration(changePlanFn),
            {
                authorizationType: apigw.AuthorizationType.COGNITO,
                authorizer: this.authorizer,
                apiKeyRequired: true,
            }
        );

        // プラン情報取得エンドポイント
        const getPlanFn = new NodejsFunction(this, 'GetPlanFunction', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/src/handlers/getPlan.handler.ts'),
            handler: 'handler',
            memorySize: 256,
            timeout: cdk.Duration.seconds(10),
        });

        // SSM読み取り権限
        getPlanFn.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ssm:GetParameter'],
            resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/license-service/usage-plans/*`],
        }));

        // API Gateway読み取り権限
        getPlanFn.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'apigateway:GetUsagePlans',
                'apigateway:GetUsagePlanKeys',
                'apigateway:GetApiKey',
            ],
            resources: ['*'],
        }));

        userPlanResource.addMethod(
            'GET',
            new apigw.LambdaIntegration(getPlanFn),
            {
                authorizationType: apigw.AuthorizationType.COGNITO,
                authorizer: this.authorizer,
                apiKeyRequired: true,
            }
        );
    }

    // EA Applications エンドポイント作成メソッド
    private createEAApplicationsEndpoints(table: dynamodb.Table, userResource: apigw.Resource) {
        // Lambda関数 (GET)
        const getHandler = new NodejsFunction(this, 'GetEAApplicationsHandler', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/src/handlers/getEAApplications.handler.ts'),
            handler: 'handler',
            environment: {
                TABLE_NAME: table.tableName,
            },
            memorySize: 256,
            timeout: cdk.Duration.seconds(10),
            functionName: `get-ea-applications-${this.stackName.toLowerCase()}`,
        });
        table.grantReadData(getHandler);

        // Lambda関数 (PATCH)
        const updateHandler = new NodejsFunction(this, 'UpdateEAApplicationHandler', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/src/handlers/updateEAApplication.handler.ts'),
            handler: 'handler',
            environment: {
                TABLE_NAME: table.tableName,
            },
            memorySize: 256,
            timeout: cdk.Duration.seconds(10),
            functionName: `update-ea-application-${this.stackName.toLowerCase()}`,
        });
        table.grantReadWriteData(updateHandler);

        // ea-applicationsリソース（CORS設定付き）
        const eaApplicationsResource = userResource.addResource('ea-applications', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        // {key}リソース（CORS設定付き）
        const keyResource = eaApplicationsResource.addResource('{key}', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        // GET メソッド（プロキシ統合のみ）
        eaApplicationsResource.addMethod('GET', new apigw.LambdaIntegration(getHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: true,
        });

        // PATCH メソッド（プロキシ統合のみ）
        keyResource.addMethod('PATCH', new apigw.LambdaIntegration(updateHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: true,
        });
    }

    // Usage Plans作成
    private createUsagePlans() {
        const freePlan = new apigw.UsagePlan(this, 'FreePlan', {
            name: 'free-plan',
            description: 'Free tier for license generation',
            throttle: {
                rateLimit: 2,
                burstLimit: 5,
            },
            quota: {
                limit: 100,
                period: apigw.Period.MONTH,
            },
            apiStages: [{
                api: this.api,
                stage: this.api.deploymentStage,
            }],
        });

        const basicPlan = new apigw.UsagePlan(this, 'BasicPlan', {
            name: 'basic-plan',
            description: 'Basic tier for license generation',
            throttle: {
                rateLimit: 10,
                burstLimit: 20,
            },
            quota: {
                limit: 1000,
                period: apigw.Period.MONTH,
            },
            apiStages: [{
                api: this.api,
                stage: this.api.deploymentStage,
            }],
        });

        const proPlan = new apigw.UsagePlan(this, 'ProPlan', {
            name: 'pro-plan',
            description: 'Pro tier for license generation',
            throttle: {
                rateLimit: 50,
                burstLimit: 100,
            },
            quota: {
                limit: 10000,
                period: apigw.Period.MONTH,
            },
            apiStages: [{
                api: this.api,
                stage: this.api.deploymentStage,
            }],
        });

        return { freePlan, basicPlan, proPlan };
    }

    // 出力とSSMパラメータ作成
    private createOutputsAndParameters(usagePlans: { freePlan: apigw.UsagePlan, basicPlan: apigw.UsagePlan, proPlan: apigw.UsagePlan }) {
        const { freePlan, basicPlan, proPlan } = usagePlans;

        // 出力
        new cdk.CfnOutput(this, 'FreePlanId', {
            value: freePlan.usagePlanId,
            description: 'Free Usage Plan ID',
            exportName: `${this.stackName}-FreePlanId`,
        });

        new cdk.CfnOutput(this, 'BasicPlanId', {
            value: basicPlan.usagePlanId,
            description: 'Basic Usage Plan ID',
            exportName: `${this.stackName}-BasicPlanId`,
        });

        new cdk.CfnOutput(this, 'ProPlanId', {
            value: proPlan.usagePlanId,
            description: 'Pro Usage Plan ID',
            exportName: `${this.stackName}-ProPlanId`,
        });

        // SSMパラメータとして保存
        new ssm.StringParameter(this, 'FreePlanIdParameter', {
            parameterName: '/license-service/usage-plans/free',
            stringValue: freePlan.usagePlanId,
            description: 'Free Usage Plan ID',
        });

        new ssm.StringParameter(this, 'BasicPlanIdParameter', {
            parameterName: '/license-service/usage-plans/basic',
            stringValue: basicPlan.usagePlanId,
            description: 'Basic Usage Plan ID',
        });

        new ssm.StringParameter(this, 'ProPlanIdParameter', {
            parameterName: '/license-service/usage-plans/pro',
            stringValue: proPlan.usagePlanId,
            description: 'Pro Usage Plan ID',
        });

        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: this.api.url,
            description: 'License API endpoint',
            exportName: `${this.stackName}-ApiEndpoint`,
        });

        new cdk.CfnOutput(this, 'ApiId', {
            value: this.api.restApiId,
            description: 'License API Gateway ID',
            exportName: `${this.stackName}-ApiId`,
        });
    }
}