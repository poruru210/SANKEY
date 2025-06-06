/**
 * 統一設定管理の公開API
 *
 * 使用例:
 * import { EnvironmentConfig, CdkHelpers, ConfigValidator } from '../config';
 */

// 環境設定
export { EnvironmentConfig } from './environment-settings';

// CDKヘルパー
export { CdkHelpers } from './cdk-helpers';

// 設定検証
export { ConfigValidator } from './config-validator';

// 型定義（必要に応じて再エクスポート）
export type {
    Environment,
    EnvironmentSettings,
    LambdaSettings,
    DynamoDbSettings,
    MonitoringSettings,
    SecuritySettings,
    AuthSettings,
    NotificationSettings,
    CommonTags,
    LambdaCreationOptions,
    DynamoDbCreationOptions,
    OutputConfig,
} from '../types/config-types';