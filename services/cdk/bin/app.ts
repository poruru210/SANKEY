import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SankeyAuthStack } from '../lib/sankey-auth-stack';
import { SankeyDbStack } from '../lib/sankey-db-stack';
import { SankeyNotificationStack } from '../lib/sankey-notification-stack';
import { SankeyApplicationStack } from '../lib/sankey-application-stack';
import { SankeyTriggersStack } from '../lib/sankey-triggers-stack';
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

// Forward declaration for triggersStack for lazy ARN resolution
let triggersStack: SankeyTriggersStack;

// 1. 認証スタック
const authStack = new SankeyAuthStack(app, `${stackPrefix}AuthStack`, {
  environment,
  domainPrefix: config.auth.authDomainPrefix,
  callbackUrls: config.auth.callbackUrls,
  logoutUrls: config.auth.logoutUrls,
  removalPolicy: config.removalPolicy,
  postConfirmationFunctionArn: cdk.Lazy.string({ produce: () => triggersStack.postConfirmationFn.functionArn }),
});

// 2. データベーススタック
const dbStack = new SankeyDbStack(app, `${stackPrefix}DbStack`, {
  environment,
  userPool: authStack.userPool, // DbStack needs the UserPool L2 construct
  removalPolicy: config.removalPolicy,
});

// TriggersStack のインスタンス化
triggersStack = new SankeyTriggersStack(app, `${stackPrefix}TriggersStack`, {
  envConfig: config,
  // userPoolArn: authStack.userPool.userPoolArn, // No longer needed by TriggersStack
  userProfileTable: dbStack.userProfileTable, // Pass L2 Table construct
});

// 3. 通知スタック（UserProfileTableを追加）
const notificationStack = new SankeyNotificationStack(app, `${stackPrefix}NotificationStack`, {
  environment,
  eaApplicationsTable: dbStack.eaApplicationsTable,
  userProfileTable: dbStack.userProfileTable,
});

// 4. APIスタック（API Gateway + Lambda + Cognito認証）
const applicationStack = new SankeyApplicationStack(app, `${stackPrefix}ApiStack`, {
  environment,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  eaApplicationsTable: dbStack.eaApplicationsTable,
  userProfileTable: dbStack.userProfileTable,
  licenseNotificationQueue: notificationStack.licenseNotificationQueue,
});

// Explicit dependencies removed for now to let CDK infer them.
// If ordering issues arise that are not cycles, they can be added back.

// 環境別の追加設定
if (EnvironmentConfig.isProduction(environment)) {
  //本番環境では削除保護を有効にする
  // Using Aspects for deletion policy is generally preferred over addMetadata directly.
  // Example: cdk.Aspects.of(authStack).add(new cdk.Tag('DeletionPolicy', 'Retain'));
  // However, addMetadata is fine if it's the existing pattern.
  // Ensure 'addMetadata' method exists or handle appropriately.
  if ('addMetadata' in authStack) {
    (authStack as any).addMetadata('DeletionPolicy', 'Retain');
  }
  if ('addMetadata' in dbStack) {
    (dbStack as any).addMetadata('DeletionPolicy', 'Retain');
  }

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