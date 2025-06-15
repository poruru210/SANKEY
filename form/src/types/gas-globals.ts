/**
 * Google Apps Script グローバルオブジェクトの型定義補完
 * @types/google-apps-scriptで不足している型を補完
 */

/**
 * グローバルオブジェクトの拡張
 */
declare global {
  /**
   * アプリケーション設定（グローバル変数）
   */
  const CONFIG: import('./api').Config;

  /**
   * カスタムプロパティ（必要に応じて追加）
   */
  interface Window {
    CONFIG?: import('./api').Config;
  }
}

/**
 * UrlFetchApp.fetchのレスポンス型の拡張
 */
export interface ExtendedHTTPResponse
  extends GoogleAppsScript.URL_Fetch.HTTPResponse {
  /**
   * レスポンスコードを数値で取得
   */
  getResponseCode(): number;

  /**
   * レスポンス内容をテキストで取得
   */
  getContentText(): string;
}

/**
 * スプレッドシートのレンジ型の拡張
 */
export interface ExtendedRange extends GoogleAppsScript.Spreadsheet.Range {
  /**
   * 値の設定（型安全性を向上）
   */
  setValues(values: unknown[][]): GoogleAppsScript.Spreadsheet.Range;

  /**
   * 値の取得（型安全性を向上）
   */
  getValues(): unknown[][];
}

/**
 * フォームアプリケーションの型補完
 * 注意: getDestinationId()の戻り値は実際にはstring | nullですが、
 * 公式の型定義がstringとなっているため、型アサーションが必要
 */
export type ExtendedForm = GoogleAppsScript.Forms.Form;

/**
 * Utilitiesの型補完
 */
export interface ExtendedUtilities {
  /**
   * Base64エンコード（文字列またはバイト配列から）
   */
  base64Encode(data: string | Uint8Array | number[]): string;

  /**
   * Base64デコード
   */
  base64Decode(data: string): number[];

  /**
   * HMAC SHA256署名の計算
   */
  computeHmacSha256Signature(value: number[], key: number[]): number[];

  /**
   * Blobの作成
   */
  newBlob(data: string): GoogleAppsScript.Base.Blob;

  /**
   * スリープ（ミリ秒）
   */
  sleep(milliseconds: number): void;
}

/**
 * ContentServiceの型補完
 */
export interface ExtendedTextOutput
  extends GoogleAppsScript.Content.TextOutput {
  /**
   * MIMEタイプの設定
   */
  setMimeType(
    mimeType: GoogleAppsScript.Content.MimeType
  ): GoogleAppsScript.Content.TextOutput;
}

/**
 * スプレッドシートアプリケーションの型補完
 */
export interface ExtendedSpreadsheetApp {
  /**
   * IDからスプレッドシートを開く
   */
  openById(id: string): GoogleAppsScript.Spreadsheet.Spreadsheet;

  /**
   * アクティブなスプレッドシートを取得
   */
  getActiveSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet | null;

  /**
   * 新しいスプレッドシートを作成
   */
  create(name: string): GoogleAppsScript.Spreadsheet.Spreadsheet;
}

/**
 * フォームアプリケーションの型補完
 */
export interface ExtendedFormApp {
  /**
   * アクティブなフォームを取得
   */
  getActiveForm(): GoogleAppsScript.Forms.Form | null;
}

// 型エイリアス（使いやすさのため）
export type Sheet = GoogleAppsScript.Spreadsheet.Sheet;
export type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;
export type Form = GoogleAppsScript.Forms.Form;
export type Blob = GoogleAppsScript.Base.Blob;
