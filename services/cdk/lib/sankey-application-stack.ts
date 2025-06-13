import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import {EnvironmentConfig, CdkHelpers, EnvironmentSettings} from './config';

export interface SankeyApplicationStackProps extends cdk.StackProps {
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
    eaApplicationsTable: dynamodb.Table;
    userProfileTable: dynamodb.Table;
    licenseNotificationQueue: sqs.Queue;
    environment?: string;
    certificateArnParameterPath?: string;
}

export class SankeyApplicationStack extends cdk.Stack {
    public readonly api: apigw.RestApi;
    public readonly authorizer: apigw.CognitoUserPoolsAuthorizer;
    public readonly domainName: apigw.DomainName;
    private readonly envName: string;
    private readonly config: EnvironmentSettings;

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

        // カスタムドメインの作成
        this.domainName = CdkHelpers.createApiDomainName(
            this,
            'ApiCustomDomain',
            this.envName,
            {
                certificateArnParameterPath: props.certificateArnParameterPath
            }
        );

        // API Gateway の初期化
        this.api = CdkHelpers.createRestApi(this, 'SankeyApi', this.envName, {
            description: 'Sankey API',
            throttlingRateLimit: 2,
            throttlingBurstLimit: 5,
        });

        // カスタムドメインとAPI Gatewayのマッピング
        new apigw.BasePathMapping(this, 'ApiBasePathMapping', {
            domainName: this.domainName,
            restApi: this.api,
            stage: this.api.deploymentStage,
        });

        // Cognito Authorizer の初期化
        this.authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'SankeyAuthorizer', {
            cognitoUserPools: [props.userPool],
            authorizerName: 'CognitoAuthorizer',
            identitySource: 'method.request.header.Authorization',
        });

        this.createGatewayResponses();
        this.createHealthEndpoint();
        this.createApplicationsEndpoints(props);
        this.createLicensesEndpoints(props);
        this.createGasTemplateEndpoints(props);
        this.createProfileEndpoints(props);      // プロファイル管理専用
        this.createIntegrationEndpoints(props);  // 統合テスト機能専用
        this.createOutputs();
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
                USER_PROFILE_TABLE_NAME: props.userProfileTable.tableName,      // 🆕 IntegrationTestService用
                SSM_USER_PREFIX: CdkHelpers.getSsmUserPrefix(this.envName),
            }
        );

        const approveApplicationFn = this.createLambdaFunction(
            'approve-application',
            '../../lambda/src/handlers/applications/approveApplication.handler.ts',
            {
                SSM_USER_PREFIX: CdkHelpers.getSsmUserPrefix(this.envName),
                TABLE_NAME: props.eaApplicationsTable.tableName,
                NOTIFICATION_QUEUE_URL: props.licenseNotificationQueue.queueUrl,
                SQS_DELAY_SECONDS: this.config.notification.sqsDelaySeconds.toString(),
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
        props.userProfileTable.grantReadWriteData(webhookHandler);              // 🆕 IntegrationTestService用
        props.eaApplicationsTable.grantReadWriteData(approveApplicationFn);
        props.eaApplicationsTable.grantReadWriteData(rejectApplicationHandler);
        props.eaApplicationsTable.grantReadWriteData(cancelApplicationHandler);

        props.licenseNotificationQueue.grantSendMessages(approveApplicationFn);

        // SSMポリシー
        const masterKeySsmPolicy = CdkHelpers.createMasterKeySsmPolicy(this.region, this.account, this.envName);
        const jwtSecretSsmPolicy = CdkHelpers.createJwtSecretSsmPolicy(this.region, this.account, this.envName);

        // webhook Handler: MASTER_KEY + JWT_SECRET 両方のアクセス権限が必要
        webhookHandler.addToRolePolicy(masterKeySsmPolicy);
        webhookHandler.addToRolePolicy(jwtSecretSsmPolicy);

        // approve Handler: MASTER_KEYのみ
        approveApplicationFn.addToRolePolicy(masterKeySsmPolicy);

        // API リソースの作成
        const applicationsResource = this.api.root.addResource('applications', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        applicationsResource.addMethod('GET', new apigw.LambdaIntegration(getApplicationsHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });

        const webhookResource = applicationsResource.addResource('webhook', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        webhookResource.addMethod('POST', new apigw.LambdaIntegration(webhookHandler), {
            authorizationType: apigw.AuthorizationType.NONE,
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
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
                SSM_USER_PREFIX: CdkHelpers.getSsmUserPrefix(this.envName),
            }
        );

        const decryptLicenseHandler = this.createLambdaFunction(
            'decrypt-license',
            '../../lambda/src/handlers/licenses/decryptLicense.handler.ts',
            {
                TABLE_NAME: props.eaApplicationsTable.tableName,
                SSM_USER_PREFIX: CdkHelpers.getSsmUserPrefix(this.envName),
            }
        );

        const encryptLicenseHandler = this.createLambdaFunction(
            'encrypt-license',
            '../../lambda/src/handlers/licenses/encryptLicense.handler.ts',
            { SSM_USER_PREFIX: CdkHelpers.getSsmUserPrefix(this.envName) }
        );

        // 権限設定
        props.eaApplicationsTable.grantReadWriteData(revokeApplicationHandler);
        props.eaApplicationsTable.grantReadData(decryptLicenseHandler);
        props.eaApplicationsTable.grantReadData(directDecryptLicenseHandler);

        const ssmPolicy = CdkHelpers.createMasterKeySsmPolicy(this.region, this.account, this.envName);
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
            methodResponses: this.standardMethodResponses,
        });

        const encryptResource = licensesResource.addResource('encrypt', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        encryptResource.addMethod('POST', new apigw.LambdaIntegration(encryptLicenseHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
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
     * GAS Template エンドポイント作成
     */
    private createGasTemplateEndpoints(props: SankeyApplicationStackProps): void {

        const apiEndpoint = `https://${this.domainName.domainName}`;

        const renderGasTemplateHandler = this.createLambdaFunction(
            'render-gas-template',
            '../../lambda/src/handlers/generators/renderGasTemplate.handler.ts',
            {
                API_ENDPOINT: apiEndpoint,
            },
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

        const ssmPolicy = CdkHelpers.createJwtSecretSsmPolicy(this.region, this.account, this.envName);
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
            methodResponses: this.standardMethodResponses,
        });
    }

    /**
     * Profile エンドポイント作成（プロファイル管理専用）
     */
    private createProfileEndpoints(props: SankeyApplicationStackProps): void {
        // Lambda関数の作成（プロファイル管理のみ）
        const getUserProfileHandler = this.createLambdaFunction(
            'get-user-profile',
            '../../lambda/src/handlers/profile/getUserProfile.handler.ts',
            {
                USER_PROFILE_TABLE_NAME: props.userProfileTable.tableName
            }
        );

        const updateUserProfileHandler = this.createLambdaFunction(
            'update-user-profile',
            '../../lambda/src/handlers/profile/updateUserProfile.handler.ts',
            {
                USER_PROFILE_TABLE_NAME: props.userProfileTable.tableName
            }
        );

        // 権限設定
        props.userProfileTable.grantReadWriteData(getUserProfileHandler);
        props.userProfileTable.grantReadWriteData(updateUserProfileHandler);

        // API リソースの作成
        const profileResource = this.api.root.addResource('profile', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        // GET /profile - ユーザープロファイル取得
        profileResource.addMethod('GET', new apigw.LambdaIntegration(getUserProfileHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });

        // PUT /profile - ユーザープロファイル更新
        profileResource.addMethod('PUT', new apigw.LambdaIntegration(updateUserProfileHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });
    }

    /**
     * Integration エンドポイント作成（統合テスト機能専用）
     */
    private createIntegrationEndpoints(props: SankeyApplicationStackProps): void {
        // Lambda関数の作成（統合テスト機能のみ）
        const testGasConnectionHandler = this.createLambdaFunction(
            'test-gas-connection',
            '../../lambda/src/handlers/integration/testGasConnection.handler.ts',
            {
                USER_PROFILE_TABLE_NAME: props.userProfileTable.tableName,
                SSM_USER_PREFIX: CdkHelpers.getSsmUserPrefix(this.envName)
            }
        );

        const startIntegrationTestHandler = this.createLambdaFunction(
            'start-integration-test',
            '../../lambda/src/handlers/integration/startIntegrationTest.handler.ts',
            {
                TABLE_NAME: props.eaApplicationsTable.tableName,                    // 🆕 IntegrationTestService用
                USER_PROFILE_TABLE_NAME: props.userProfileTable.tableName
            }
        );

        const completeIntegrationTestHandler = this.createLambdaFunction(
            'complete-integration-test',
            '../../lambda/src/handlers/integration/completeIntegrationTest.handler.ts',
            {
                TABLE_NAME: props.eaApplicationsTable.tableName,                    // 🆕 IntegrationTestService用
                USER_PROFILE_TABLE_NAME: props.userProfileTable.tableName,
                SSM_USER_PREFIX: CdkHelpers.getSsmUserPrefix(this.envName)
            }
        );

        // 権限設定（IntegrationTestService対応）
        // testGasConnectionHandler
        props.userProfileTable.grantReadWriteData(testGasConnectionHandler);

        // startIntegrationTestHandler
        props.userProfileTable.grantReadWriteData(startIntegrationTestHandler);
        props.eaApplicationsTable.grantReadWriteData(startIntegrationTestHandler);  // 🆕 IntegrationTestService用

        // completeIntegrationTestHandler
        props.userProfileTable.grantReadWriteData(completeIntegrationTestHandler);
        props.eaApplicationsTable.grantReadData(completeIntegrationTestHandler);     // 🆕 IntegrationTestService用

        // SSMポリシーを追加（JWT_SECRET用）
        const jwtSsmPolicy = CdkHelpers.createJwtSecretSsmPolicy(this.region, this.account, this.envName);
        testGasConnectionHandler.addToRolePolicy(jwtSsmPolicy);
        completeIntegrationTestHandler.addToRolePolicy(jwtSsmPolicy);

        // 新しいAPIエンドポイント構成
        const integrationResource = this.api.root.addResource('integration', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        const testResource = integrationResource.addResource('test', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        // POST /integration/test/gas-connection - GAS接続テスト
        const gasConnectionResource = testResource.addResource('gas-connection', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        gasConnectionResource.addMethod('POST', new apigw.LambdaIntegration(testGasConnectionHandler), {
            authorizationType: apigw.AuthorizationType.NONE, // GASからの通知なので認証なし
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });

        // POST /integration/test/start - 統合テスト開始
        const startTestResource = testResource.addResource('start', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        startTestResource.addMethod('POST', new apigw.LambdaIntegration(startIntegrationTestHandler), {
            authorizationType: apigw.AuthorizationType.COGNITO,
            authorizer: this.authorizer,
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });

        // POST /integration/test/complete - 統合テスト完了
        const completeTestResource = testResource.addResource('complete', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        completeTestResource.addMethod('POST', new apigw.LambdaIntegration(completeIntegrationTestHandler), {
            authorizationType: apigw.AuthorizationType.NONE, // GASからの通知なので認証なし
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });

        // POST /integration/result/notification - ライセンス通知受信（将来用）
        const resultResource = integrationResource.addResource('result', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        const notificationResource = resultResource.addResource('notification', {
            defaultCorsPreflightOptions: this.corsOptions,
        });

        // 将来の実装用（現在はテストGAS接続と同じハンドラーを使用）
        notificationResource.addMethod('POST', new apigw.LambdaIntegration(testGasConnectionHandler), {
            authorizationType: apigw.AuthorizationType.NONE, // GASからの通知なので認証なし
            apiKeyRequired: false,
            methodResponses: this.standardMethodResponses,
        });
    }

    /**
     * 出力の作成
     */
    private createOutputs(): void {
        CdkHelpers.createOutputs(this, this.stackName, [
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
            {
                id: 'CustomDomainName',
                value: this.domainName.domainName,
                description: 'API Custom Domain Name',
            },
            {
                id: 'CustomDomainNameTarget',
                value: this.domainName.domainNameAliasDomainName,
                description: 'Custom Domain Name Target for DNS setup',
            },
        ]);
    }
}