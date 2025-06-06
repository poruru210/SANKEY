import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { EnvironmentConfig, CdkHelpers } from './config';

export interface SankeyApplicationStackProps extends cdk.StackProps {
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
    eaApplicationsTable: dynamodb.Table;
    licenseNotificationQueue: sqs.Queue;
    environment?: string;
}

export class SankeyApplicationStack extends cdk.Stack {
    public readonly api: apigw.RestApi;
    public readonly authorizer: apigw.CognitoUserPoolsAuthorizer;
    private readonly envName: string;
    private readonly config: ReturnType<typeof EnvironmentConfig.get>;

    // 共通設定
    private readonly corsOptions: apigw.CorsOptions;
    private readonly standardMethodResponses: apigw.MethodResponse[];

    constructor(scope: Construct, id: string, props: SankeyApplicationStackProps) {
        super(scope, id, props);

        this.envName = props.environment || 'dev';
        this.config = EnvironmentConfig.get(this.envName);

        // 共通設定を取得
        this.corsOptions = CdkHelpers.getDefaultCorsOptions(this.envName);
        this.standardMethodResponses = CdkHelpers.getStandardMethodResponses();

        // 共通タグを適用
        CdkHelpers.applyCommonTags(this, this.envName, 'API');

        // API Gateway の初期化
        this.api = CdkHelpers.createRestApi(this, 'LicenseApi', this.envName, {
            description: 'License Service API with full CORS support',
            throttlingRateLimit: 2,
            throttlingBurstLimit: 5,
        });

        // Cognito Authorizer の初期化
        this.authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'LicenseApiAuthorizer', {
            cognitoUserPools: [props.userPool],
            authorizerName: 'CognitoAuthorizer',
            identitySource: 'method.request.header.Authorization',
        });

        this.createGatewayResponses();
        this.createHealthEndpoint();
        this.createApplicationsEndpoints(props);
        this.createLicensesEndpoints(props);
        this.createPlansEndpoints(props);
        this.createGasTemplateEndpoints(props);
        this.createUsagePlansAndOutputs();
    }

    /**
     * Gateway Responses の作成
     */
    private createGatewayResponses(): void {
        const corsHeaders = {
            'Access-Control-Allow-Origin': "'*'",
            'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-API-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With'",
            'Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
        };

        new apigw.GatewayResponse(this, 'Default4xxGatewayResponse', {
            restApi: this.api,
            type: apigw.ResponseType.DEFAULT_4XX,
            responseHeaders: corsHeaders,
        });

        new apigw.GatewayResponse(this, 'Default5xxGatewayResponse', {
            restApi: this.api,
            type: apigw.ResponseType.DEFAULT_5XX,
            responseHeaders: corsHeaders,
        });
    }

    /**
     * Lambda関数の統一的な作成
     */
    private createLambdaFunction(
        name: string,
        entry: string,
        additionalEnvironment?: Record<string, string>,
        timeout?: cdk.Duration,
        memorySize?: number,
        bundling?: any
    ): NodejsFunction {
        return CdkHelpers.createNodejsFunction(
            this,
            CdkHelpers.toPascalCase(name),
            name,
            this.envName,
            {
                entry: path.join(__dirname, entry),
                timeout,
                memorySize,
                environment: additionalEnvironment,
                bundling,
            }
        );
    }

    /**
     * ヘルスチェックエンドポイント
     */
    private createHealthEndpoint(): void {
        const healthResource = this.api.root.addResource('health', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        const healthCheckIntegration = new apigw.MockIntegration({
            integrationResponses: [{
                statusCode: '200',
                responseParameters: {
                    'method.response.header.Access-Control-Allow-Origin': "'*'",
                    'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-API-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With'",
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
            requestTemplates: { 'application/json': '{"statusCode": 200}' }
        });

        healthResource.addMethod('GET', healthCheckIntegration, {
            authorizationType: apigw.AuthorizationType.NONE,
            apiKeyRequired: false,
            methodResponses: [{
                statusCode: '200',
                responseParameters: {
                    'method.response.header.Access-Control-Allow-Origin': true,
                    'method.response.header.Access-Control-Allow-Headers': true,
                    'method.response.header.Access-Control-Allow-Methods': true,
                },
                responseModels: { 'application/json': apigw.Model.EMPTY_MODEL }
            }]
        });
    }

    /**
     * Applications エンドポイント作成
     */
    private createApplicationsEndpoints(props: SankeyApplicationStackProps): void {
        // Lambda関数の作成
        const getApplicationsHandler = this.createLambdaFunction(
            'get-applications',
            '../../lambda/src/handlers/applications/getApplications.handler.ts',
            { TABLE_NAME: props.eaApplicationsTable.tableName },
            cdk.Duration.seconds(10)
        );

        const webhookHandler = this.createLambdaFunction(
            'applications-webhook',
            '../../lambda/src/handlers/applications/webhook.handler.ts',
            {
                TABLE_NAME: props.eaApplicationsTable.tableName,
                SSM_PREFIX: '/license-service/users',
            }
        );

        const approveApplicationFn = this.createLambdaFunction(
            'approve-application',
            '../../lambda/src/handlers/applications/approveApplication.handler.ts',
            {
                SSM_PREFIX: '/license-service/users',
                TABLE_NAME: props.eaApplicationsTable.tableName,
                NOTIFICATION_QUEUE_URL: props.licenseNotificationQueue.queueUrl,
            }
        );

        const cancelApplicationHandler = this.createLambdaFunction(
            'cancel-application',
            '../../lambda/src/handlers/applications/cancelApproval.handler.ts',
            { TABLE_NAME: props.eaApplicationsTable.tableName }
        );

        const rejectApplicationHandler = this.createLambdaFunction(
            'reject-application',
            '../../lambda/src/handlers/applications/rejectApplication.handler.ts',
            { TABLE_NAME: props.eaApplicationsTable.tableName }
        );

        const getApplicationHistoriesHandler = this.createLambdaFunction(
            'get-application-histories',
            '../../lambda/src/handlers/applications/getApplicationHistories.handler.ts',
            { TABLE_NAME: props.eaApplicationsTable.tableName }
        );

        // 権限設定
        props.eaApplicationsTable.grantReadData(getApplicationsHandler);
        props.eaApplicationsTable.grantReadData(getApplicationHistoriesHandler);
        props.eaApplicationsTable.grantReadWriteData(webhookHandler);
        props.eaApplicationsTable.grantReadWriteData(approveApplicationFn);
        props.eaApplicationsTable.grantReadWriteData(rejectApplicationHandler);
        props.eaApplicationsTable.grantReadWriteData(cancelApplicationHandler);

        props.licenseNotificationQueue.grantSendMessages(approveApplicationFn);

        // SSMポリシーを追加
        const ssmPolicy = CdkHelpers.createSsmPolicy(
            this.region,
            this.account,
            '/license-service/users/*/master-key'
        );
        approveApplicationFn.addToRolePolicy(ssmPolicy);
        webhookHandler.addToRolePolicy(ssmPolicy);

        // API リソースの作成
        const applicationsResource = this.api.root.addResource('applications', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        applicationsResource.addMethod('GET', new apigw.LambdaIntegration(getApplicationsHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
        });

        const webhookResource = applicationsResource.addResource('webhook', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        webhookResource.addMethod('POST', new apigw.LambdaIntegration(webhookHandler), {
            authorizationType: apigw.AuthorizationType.NONE,
            apiKeyRequired: false,
            methodResponses: [
                { statusCode: '200' },
                { statusCode: '400' },
                { statusCode: '500' },
            ],
        });

        const applicationIdResource = applicationsResource.addResource('{id}', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        const approveResource = applicationIdResource.addResource('approve', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        approveResource.addMethod('POST', new apigw.LambdaIntegration(approveApplicationFn), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });

        const cancelResource = applicationIdResource.addResource('cancel', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        cancelResource.addMethod('POST', new apigw.LambdaIntegration(cancelApplicationHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });

        const rejectResource = applicationIdResource.addResource('reject', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        rejectResource.addMethod('POST', new apigw.LambdaIntegration(rejectApplicationHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });

        const historiesResource = applicationIdResource.addResource('histories', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        historiesResource.addMethod('GET', new apigw.LambdaIntegration(getApplicationHistoriesHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });
    }

    /**
     * Licenses エンドポイント作成
     */
    private createLicensesEndpoints(props: SankeyApplicationStackProps): void {
        const revokeApplicationHandler = this.createLambdaFunction(
            'revoke-license',
            '../../lambda/src/handlers/licenses/revokeLicense.handler.ts',
            { TABLE_NAME: props.eaApplicationsTable.tableName }
        );

        const directDecryptLicenseHandler = this.createLambdaFunction(
            'direct-decrypt-license',
            '../../lambda/src/handlers/licenses/decryptLicense.handler.ts',
            {
                TABLE_NAME: props.eaApplicationsTable.tableName,
                SSM_PREFIX: '/license-service/users',
            }
        );

        const decryptLicenseHandler = this.createLambdaFunction(
            'decrypt-license',
            '../../lambda/src/handlers/licenses/decryptLicense.handler.ts',
            {
                TABLE_NAME: props.eaApplicationsTable.tableName,
                SSM_PREFIX: '/license-service/users',
            }
        );

        const encryptLicenseHandler = this.createLambdaFunction(
            'encrypt-license',
            '../../lambda/src/handlers/licenses/encryptLicense.handler.ts',
            { SSM_PREFIX: '/license-service/users' }
        );

        // 権限設定
        props.eaApplicationsTable.grantReadWriteData(revokeApplicationHandler);
        props.eaApplicationsTable.grantReadData(decryptLicenseHandler);
        props.eaApplicationsTable.grantReadData(directDecryptLicenseHandler);

        const ssmPolicy = CdkHelpers.createSsmPolicy(
            this.region,
            this.account,
            '/license-service/users/*/master-key'
        );
        decryptLicenseHandler.addToRolePolicy(ssmPolicy);
        directDecryptLicenseHandler.addToRolePolicy(ssmPolicy);
        encryptLicenseHandler.addToRolePolicy(ssmPolicy);

        const licensesResource = this.api.root.addResource('licenses', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        const directDecryptResource = licensesResource.addResource('decrypt', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        directDecryptResource.addMethod('POST', new apigw.LambdaIntegration(directDecryptLicenseHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: [
                { statusCode: '200' },
                { statusCode: '400' },
                { statusCode: '401' },
                { statusCode: '500' },
            ],
        });

        const encryptResource = licensesResource.addResource('encrypt', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        encryptResource.addMethod('POST', new apigw.LambdaIntegration(encryptLicenseHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: [
                { statusCode: '200' },
                { statusCode: '400' },
                { statusCode: '401' },
                { statusCode: '500' },
            ],
        });

        const licenseIdResource = licensesResource.addResource('{id}', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        const revokeResource = licenseIdResource.addResource('revoke', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        revokeResource.addMethod('POST', new apigw.LambdaIntegration(revokeApplicationHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });

        const decryptResource = licenseIdResource.addResource('decrypt', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        decryptResource.addMethod('POST', new apigw.LambdaIntegration(decryptLicenseHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });
    }

    /**
     * Plans エンドポイント作成
     */
    private createPlansEndpoints(props: SankeyApplicationStackProps): void {
        const getPlanHandler = this.createLambdaFunction(
            'get-plan',
            '../../lambda/src/handlers/plans/getPlan.handler.ts',
            {},
            cdk.Duration.seconds(10)
        );

        const changePlanHandler = this.createLambdaFunction(
            'change-plan',
            '../../lambda/src/handlers/plans/changePlan.handler.ts'
        );

        // SSMポリシーを追加
        const usagePlansSsmPolicy = CdkHelpers.createSsmPolicy(
            this.region,
            this.account,
            '/license-service/usage-plans/*'
        );
        getPlanHandler.addToRolePolicy(usagePlansSsmPolicy);
        changePlanHandler.addToRolePolicy(usagePlansSsmPolicy);

        getPlanHandler.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'apigateway:GET',
                'apigateway:GetApiKey',
                'apigateway:GetUsagePlan',
                'apigateway:GetUsagePlans',
                'apigateway:GetUsagePlanKeys',
            ],
            resources: ['*'],
        }));

        changePlanHandler.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'apigateway:CreateUsagePlanKey',
                'apigateway:DeleteUsagePlanKey',
                'apigateway:GetUsagePlanKeys',
            ],
            resources: ['*'],
        }));

        const plansResource = this.api.root.addResource('plans', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        plansResource.addMethod('GET', new apigw.LambdaIntegration(getPlanHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: [
                { statusCode: '200' },
                { statusCode: '400' },
                { statusCode: '401' },
                { statusCode: '500' },
            ],
        });

        const changePlanResource = plansResource.addResource('change', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        changePlanResource.addMethod('POST', new apigw.LambdaIntegration(changePlanHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: [
                { statusCode: '200' },
                { statusCode: '400' },
                { statusCode: '401' },
                { statusCode: '500' },
            ],
        });
    }

    /**
     * GAS Template エンドポイント作成
     */
    private createGasTemplateEndpoints(props: SankeyApplicationStackProps): void {
        const renderGasTemplateHandler = this.createLambdaFunction(
            'render-gas-template',
            '../../lambda/src/handlers/generators/renderGasTemplate.handler.ts',
            {},
            cdk.Duration.seconds(15),
            256,
            {
                nodeModules: ['mustache'],
                commandHooks: {
                    beforeBundling(): string[] { return []; },
                    beforeInstall(): string[] { return []; },
                    afterBundling(inputDir: string, outputDir: string): string[] {
                        const scriptPath = path.join(__dirname, './scripts/afterBundling.js').replace(/\\/g, '/');
                        return [`node "${scriptPath}" "${inputDir}" "${outputDir}"`];
                    },
                },
            }
        );

        const ssmPolicy = CdkHelpers.createSsmPolicy(
            this.region,
            this.account,
            '/license-service/users/*/master-key'
        );
        renderGasTemplateHandler.addToRolePolicy(ssmPolicy);

        // API Gateway Integration
        let applicationsResource = this.api.root.getResource('applications');
        if (!applicationsResource) {
            applicationsResource = this.api.root.addResource('applications', {
                defaultCorsPreflightOptions: this.corsOptions,
            });
        }

        let configResource = applicationsResource.getResource('config');
        if (!configResource) {
            configResource = applicationsResource.addResource('config', {
                defaultCorsPreflightOptions: this.corsOptions,
            });
        }

        const gasResource = configResource.addResource('gas', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        gasResource.addMethod('GET', new apigw.LambdaIntegration(renderGasTemplateHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: [
                { statusCode: '200' },
                { statusCode: '401' },
                { statusCode: '403' },
                { statusCode: '404' },
                { statusCode: '500' }
            ],
        });
    }

    /**
     * Usage Plans の作成と Outputs
     */
    private createUsagePlansAndOutputs(): void {
        const freePlan = new apigw.UsagePlan(this, 'FreePlan', {
            name: CdkHelpers.generateResourceName('free-plan', this.envName),
            description: 'Free tier for license generation',
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

        const basicPlan = new apigw.UsagePlan(this, 'BasicPlan', {
            name: CdkHelpers.generateResourceName('basic-plan', this.envName),
            description: 'Basic tier for license generation',
            throttle: {
                rateLimit: 10,
                burstLimit: 20,
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

        const proPlan = new apigw.UsagePlan(this, 'ProPlan', {
            name: CdkHelpers.generateResourceName('pro-plan', this.envName),
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

        // SSMパラメータの作成
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

        // 出力の作成
        CdkHelpers.createOutputs(this, this.stackName, [
            {
                id: 'FreePlanId',
                value: freePlan.usagePlanId,
                description: 'Free Usage Plan ID',
            },
            {
                id: 'BasicPlanId',
                value: basicPlan.usagePlanId,
                description: 'Basic Usage Plan ID',
            },
            {
                id: 'ProPlanId',
                value: proPlan.usagePlanId,
                description: 'Pro Usage Plan ID',
            },
            {
                id: 'ApiEndpoint',
                value: this.api.url,
                description: 'License API endpoint',
            },
            {
                id: 'ApiId',
                value: this.api.restApiId,
                description: 'License API Gateway ID',
            },
        ]);
    }
}