import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SankeyAuthStack } from '../lib/sankey-auth-stack';
import { SankeyDbStack } from '../lib/sankey-db-stack';
import { SankeyNotificationStack } from '../lib/sankey-notification-stack';
import { SankeyApplicationStack } from '../lib/sankey-application-stack';
import { EnvironmentConfig, ConfigValidator, CdkHelpers } from '../lib/config';

const app = new cdk.App();

// 環境設定の取得と検証
const environment = app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev';

console.log(`🚀 Deploying Sankey License Service`);
console.log(`📦 Environment: ${environment}`);

try {
  // 設定検証
  ConfigValidator.validateEnvironment(environment);

  // 環境間整合性チェック（開発環境のみ）
  if (environment === 'dev') {
    ConfigValidator.validateCrossEnvironmentConsistency();
  }
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`❌ Configuration error: ${errorMessage}`);
  process.exit(1);
}

// 環境設定の取得
const config = EnvironmentConfig.get(environment);

// スタック名プレフィックスの生成
const stackPrefix = `Sankey${environment.charAt(0).toUpperCase() + environment.slice(1)}`;

// 共通タグの設定
const commonTags = CdkHelpers.getCommonTags(environment);

console.log(`🏷️  Stack prefix: ${stackPrefix}`);
console.log(`🌐 Domain: ${config.domain}`);
console.log(`📧 Email from: ${config.notification.emailFromAddress}`);
console.log(`📊 Monitoring: ${config.monitoring.enableDetailedMonitoring ? 'Enabled' : 'Disabled'}`);

// 1. 認証スタック
const authStack = new SankeyAuthStack(app, `${stackPrefix}AuthStack`, {
  environment,
  domainPrefix: config.auth.authDomainPrefix,
  callbackUrls: config.auth.callbackUrls,
  logoutUrls: config.auth.logoutUrls,
  removalPolicy: config.removalPolicy,
  tags: commonTags,
});

// 2. データベーススタック
const dbStack = new SankeyDbStack(app, `${stackPrefix}DbStack`, {
  environment,
  userPool: authStack.userPool,
  removalPolicy: config.removalPolicy,
  tags: commonTags,
});

// AuthStackのpostConfirmationFnにUserProfileTableの権限を追加
dbStack.userProfileTable.grantWriteData(authStack.postConfirmationFn);

// postConfirmationFnに環境変数を追加
authStack.postConfirmationFn.addEnvironment('USER_PROFILE_TABLE_NAME', dbStack.userProfileTable.tableName);

// 3. 通知スタック（UserProfileTableを追加）
const notificationStack = new SankeyNotificationStack(app, `${stackPrefix}NotificationStack`, {
  environment,
  eaApplicationsTable: dbStack.eaApplicationsTable,
  userProfileTable: dbStack.userProfileTable,
  tags: commonTags,
});

// 4. APIスタック（API Gateway + Lambda + Cognito認証）
const applicationStack = new SankeyApplicationStack(app, `${stackPrefix}ApiStack`, {
  environment,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  eaApplicationsTable: dbStack.eaApplicationsTable,
  userProfileTable: dbStack.userProfileTable,
  licenseNotificationQueue: notificationStack.licenseNotificationQueue,
  tags: commonTags,
});

// 依存関係の明示
notificationStack.addDependency(dbStack);
applicationStack.addDependency(notificationStack);

// 環境別の追加設定
if (EnvironmentConfig.isProduction(environment)) {
  // 本番環境では削除保護を有効にする
  authStack.addMetadata('DeletionPolicy', 'Retain');
  dbStack.addMetadata('DeletionPolicy', 'Retain');

  // 本番環境での警告出力
  console.warn('🚨 Deploying to PRODUCTION environment');
  console.warn('⚠️  Ensure all changes are reviewed and approved');
}

// デプロイ情報の出力
console.log(`✅ Configuration validated successfully`);
console.log(`📋 Settings overview:`);
console.log(`   - Log Level: ${config.logLevel}`);
console.log(`   - Deletion Protection: ${config.security.enableDeletionProtection ? 'Enabled' : 'Disabled'}`);
console.log(`   - CORS Origins: ${config.security.corsOrigins.join(', ')}`);
console.log(`   - DynamoDB Billing: ${config.dynamodb.billingMode}`);
console.log(`   - Lambda Memory: ${config.lambda.memorySize}MB`);
console.log(`   - X-Ray Tracing: ${config.monitoring.enableXRayTracing ? 'Enabled' : 'Disabled'}`);

// 利用可能な環境の表示（開発環境のみ）
if (environment === 'dev') {
  console.log(`💡 Available environments: ${EnvironmentConfig.getAvailableEnvironments().join(', ')}`);
  console.log(`💡 Usage examples:`);
  console.log(`   - npm run deploy:dev`);
  console.log(`   - npm run deploy:prod`);
  console.log(`   - cdk deploy --context environment=${environment}`);
}