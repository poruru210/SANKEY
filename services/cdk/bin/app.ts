#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CognitoAuthStack } from '../lib/cognito-auth-stack';
import { LicenseServiceDbStack } from '../lib/license-service-db-stack';
import { NotificationStack } from '../lib/notification-stack';
import { LicenseServiceApiStack } from '../lib/license-service-api-stack';

const app = new cdk.App();

// 1. 認証スタック
const cognitoStack = new CognitoAuthStack(app, 'CognitoAuthStack', {
  domainPrefix: 'license-service-auth',
  callbackUrls: [
    'http://localhost:3000/api/auth/callback/cognito',
    'https://sankey.niraikanai.trade/api/auth/callback/cognito'
  ],
  logoutUrls: [
    'http://localhost:3000/login',
    'https://sankey.niraikanai.trade/login'
  ],
});

// 2. データベーススタック
const dbStack = new LicenseServiceDbStack(app, 'LicenseServiceDbStack', {
  userPool: cognitoStack.userPool,
});

// 3. 通知スタック（SQS + メール送信Lambda）
const notificationStack = new NotificationStack(app, 'NotificationStack', {
  eaApplicationsTable: dbStack.table,
});

// 4. APIスタック（依存関係を含む）
const apiStack = new LicenseServiceApiStack(app, 'LicenseServiceApiStack', {
  userPool: cognitoStack.userPool,
  userPoolClient: cognitoStack.userPoolClient,
  eaApplicationsTable: dbStack.table,
  licenseNotificationQueue: notificationStack.licenseNotificationQueue,
  cancelApprovalFunction: notificationStack.cancelApprovalFunction,
});

// 依存関係の明示
apiStack.addDependency(cognitoStack);
apiStack.addDependency(dbStack);
apiStack.addDependency(notificationStack);
notificationStack.addDependency(dbStack);