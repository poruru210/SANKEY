/**
 * Google Apps Script イベント型定義
 */

/**
 * フォーム送信イベント
 */
export interface FormSubmitEvent {
  /**
   * フォームの名前付き値（フィールド名をキーとする）
   * 各値は配列形式で返される
   */
  namedValues: Record<string, string[] | undefined>;

  /**
   * フォームの値（順序通りの配列）
   */
  values?: string[];

  /**
   * タイムスタンプ
   */
  timestamp?: Date;

  /**
   * レンジ（スプレッドシートに記録される場合）
   */
  range?: GoogleAppsScript.Spreadsheet.Range;

  /**
   * ソース（イベントの発生源）
   */
  source?: GoogleAppsScript.Forms.Form;
}

/**
 * DoPostイベントのパラメータ
 */
export interface DoPostParameter {
  [key: string]: string;
}

/**
 * DoPostイベントで使用する型
 * 注意: GoogleAppsScript.Events.DoPostの型定義と完全に互換性を保つ
 */
export type DoPostEvent = GoogleAppsScript.Events.DoPost;

/**
 * 統合テストリクエストデータ
 */
export interface IntegrationTestRequest {
  /**
   * アクション種別
   */
  action: 'integration_test';

  /**
   * テストID（必須）
   */
  testId: string;

  /**
   * タイムスタンプ
   */
  timestamp?: string;
}

/**
 * SANKEYからの通知リクエストデータ
 */
export interface SankeyNotificationRequest {
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
   * テストID（統合テストの場合）
   */
  testId?: string;
}

/**
 * POSTリクエストの共通型
 */
export type PostRequestData =
  | IntegrationTestRequest
  | SankeyNotificationRequest;
