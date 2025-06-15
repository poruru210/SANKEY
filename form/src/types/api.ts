/**
 * API関連の型定義
 * 既存のconfig.tsから移動・整理
 */

/**
 * フォームフィールドの定義
 */
export interface FormFieldDefinition {
  /**
   * フィールドのラベル（表示名）
   */
  label: string;

  /**
   * フィールドタイプ
   */
  type: 'text' | 'select';

  /**
   * 必須フィールドかどうか
   */
  required: boolean;

  /**
   * 選択肢（selectタイプの場合）
   */
  options?: string[];

  /**
   * バリデーションタイプ
   */
  validation?: 'number' | 'email';
}

/**
 * フォームフィールドのコレクション
 */
export interface FormFields {
  EA_NAME: FormFieldDefinition;
  ACCOUNT_NUMBER: FormFieldDefinition;
  BROKER: FormFieldDefinition;
  EMAIL: FormFieldDefinition;
  X_ACCOUNT: FormFieldDefinition;
}

/**
 * アプリケーション設定
 */
export interface Config {
  /**
   * Webhook送信先URL
   */
  WEBHOOK_URL: string;

  /**
   * テスト通知URL
   */
  TEST_NOTIFICATION_URL: string;

  /**
   * 結果通知URL
   */
  RESULT_NOTIFICATION_URL: string;

  /**
   * ユーザーID
   */
  USER_ID: string;

  /**
   * JWT署名用シークレット（Base64エンコード）
   */
  JWT_SECRET: string;

  /**
   * フォームフィールド定義
   */
  FORM_FIELDS: FormFields;
}

/**
 * フォームデータ（送信用）
 */
export interface FormData {
  /**
   * EA名
   */
  eaName: string;

  /**
   * 口座番号
   */
  accountNumber: string;

  /**
   * ブローカー名
   */
  broker: string;

  /**
   * メールアドレス
   */
  email: string;

  /**
   * Xアカウント
   */
  xAccount: string;

  /**
   * 統合テストID（統合テスト時のみ）
   */
  integrationTestId?: string;
}

/**
 * Webhook送信レスポンス
 */
export interface WebhookResponse {
  /**
   * 成功フラグ
   */
  success: boolean;

  /**
   * レスポンスデータ（成功時）
   */
  response?: {
    data?: {
      applicationId?: string;
      temporaryUrl?: string;
    };
    message?: string;
  };

  /**
   * エラーメッセージ（失敗時）
   */
  error?: string;
}

/**
 * 通知データ（SANKEYから受信）
 */
export interface NotificationData {
  /**
   * ユーザーID
   */
  userId: string;

  /**
   * アプリケーションID
   */
  applicationId: string;

  /**
   * ライセンスID
   */
  licenseId: string;

  /**
   * ライセンス値（オプション）
   */
  licenseValue?: string;

  /**
   * テストID（統合テスト時）
   */
  testId?: string;
}

/**
 * テスト結果
 */
export interface TestResult {
  /**
   * 成功フラグ
   */
  success: boolean;

  /**
   * タイムスタンプ
   */
  timestamp: string;

  /**
   * 詳細情報
   */
  details: string;

  /**
   * GASプロジェクトID（オプション）
   */
  gasProjectId?: string;
}

/**
 * ライセンスデータ（スプレッドシート記録用）
 */
export interface LicenseData {
  /**
   * ユーザーID
   */
  userId: string;

  /**
   * アプリケーションID
   */
  applicationId: string;

  /**
   * ライセンスID
   */
  licenseId: string;

  /**
   * ライセンス値（オプション）
   */
  licenseValue?: string;

  /**
   * テストID（統合テスト時）
   */
  testId?: string;

  /**
   * 受信日時
   */
  receivedAt: Date;
}

/**
 * JWTペイロード
 */
export interface JWTPayload {
  /**
   * フォームデータ
   */
  data: FormData;

  /**
   * 発行時刻（Unix timestamp）
   */
  iat: number;

  /**
   * 有効期限（Unix timestamp）
   */
  exp: number;

  /**
   * ユーザーID
   */
  userId: string;
}

/**
 * JWTヘッダー
 */
export interface JWTHeader {
  /**
   * アルゴリズム
   */
  alg: 'HS256';

  /**
   * タイプ
   */
  typ: 'JWT';
}
