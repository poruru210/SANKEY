/**
 * テスト用の型定義とヘルパー
 */

import { Mock } from 'vitest';
import type {
  FormData,
  WebhookResponse,
  NotificationData,
  TestResult,
  LicenseData,
} from '../src/types';
import type { FormSubmitEvent } from '../src/types';

/**
 * モック関数の型定義
 */
export type MockFunction<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> = Mock<(...args: TArgs) => TReturn>;

/**
 * webhook.tsのモック型
 */
export interface WebhookMocks {
  sendWebhook: MockFunction<[FormData], WebhookResponse>;
  notifyTestSuccess: MockFunction<[TestResult], WebhookResponse>;
  notifyIntegrationTestCompletion: MockFunction<
    [
      {
        userId: string;
        testId: string;
        licenseId: string;
        applicationId: string;
        success: boolean;
        timestamp: string;
        details: string;
      },
    ],
    WebhookResponse
  >;
}

/**
 * spreadsheet.tsのモック型
 */
export interface SpreadsheetMocks {
  recordToSpreadsheet: MockFunction<[FormData, unknown], void>;
  recordLicenseToSpreadsheet: MockFunction<[LicenseData], void>;
  getOrCreateSheet: MockFunction<
    [string],
    GoogleAppsScript.Spreadsheet.Sheet | null
  >;
}

/**
 * integration.tsのモック型
 */
export interface IntegrationMocks {
  triggerIntegrationTest: MockFunction<[string], unknown>;
  testConnection: MockFunction<[], unknown>;
  onSankeyNotification: MockFunction<[NotificationData], unknown>;
}

/**
 * jwt.tsのモック型
 */
export interface JWTMocks {
  createJWT: MockFunction<[FormData], string>;
  base64UrlEncode: MockFunction<[string | Uint8Array], string>;
}

/**
 * config-manager.tsのモック型
 */
export interface ConfigManagerMocks {
  getConfig: MockFunction<[], import('../src/types').Config>;
  validateConfig: MockFunction<[], boolean>;
  getGasProjectId: MockFunction<[], string>;
}

/**
 * GASグローバルオブジェクトのモック型
 */
export interface GASGlobalMocks {
  SpreadsheetApp: {
    openById: MockFunction<[string], GoogleAppsScript.Spreadsheet.Spreadsheet>;
    getActiveSpreadsheet: MockFunction<
      [],
      GoogleAppsScript.Spreadsheet.Spreadsheet | null
    >;
    create: MockFunction<[string], GoogleAppsScript.Spreadsheet.Spreadsheet>;
  };
  FormApp: {
    getActiveForm: MockFunction<[], GoogleAppsScript.Forms.Form | null>;
  };
  UrlFetchApp: {
    fetch: MockFunction<
      [string, GoogleAppsScript.URL_Fetch.URLFetchRequestOptions?],
      GoogleAppsScript.URL_Fetch.HTTPResponse
    >;
  };
  Utilities: {
    base64Encode: MockFunction<[string | Uint8Array | number[]], string>;
    base64Decode: MockFunction<[string], number[]>;
    computeHmacSha256Signature: MockFunction<[number[], number[]], number[]>;
    newBlob: MockFunction<[string], GoogleAppsScript.Base.Blob>;
    sleep: MockFunction<[number], void>;
  };
  ContentService: {
    createTextOutput: MockFunction<
      [string],
      GoogleAppsScript.Content.TextOutput
    >;
    MimeType: {
      JSON: GoogleAppsScript.Content.MimeType;
    };
  };
  ScriptApp: {
    getScriptId: MockFunction<[], string>;
  };
}

/**
 * テスト用のフォーム送信イベント作成ヘルパー
 */
export function createMockFormSubmitEvent(
  namedValues: Record<string, string[]>
): FormSubmitEvent {
  return {
    namedValues,
    values: Object.values(namedValues).map(v => v[0] || ''),
    timestamp: new Date(),
  };
}

/**
 * テスト用のDoPostイベント作成ヘルパー
 */
export function createMockDoPostEvent(
  postData: unknown,
  parameters?: Record<string, string>
): GoogleAppsScript.Events.DoPost {
  const jsonContent = JSON.stringify(postData);
  // parametersは文字列配列の形式に変換
  const paramsAsArrays: Record<string, string[]> = {};
  if (parameters) {
    Object.keys(parameters).forEach(key => {
      paramsAsArrays[key] = [parameters[key]];
    });
  }

  return {
    parameter: parameters || {},
    parameters: paramsAsArrays,
    contextPath: '',
    contentLength: jsonContent.length,
    queryString: '',
    pathInfo: '',
    postData: {
      length: jsonContent.length,
      type: 'application/json',
      contents: jsonContent,
      name: 'postData',
    },
  };
}

/**
 * モックレスポンス作成ヘルパー
 */
export function createMockHTTPResponse(
  responseCode: number,
  contentText: string
): GoogleAppsScript.URL_Fetch.HTTPResponse {
  return {
    getResponseCode: () => responseCode,
    getContentText: () => contentText,
    getHeaders: () => ({}),
    getAs: () => ({}) as GoogleAppsScript.Base.Blob,
    getBlob: () => ({}) as GoogleAppsScript.Base.Blob,
    getAllHeaders: () => ({}),
    getContent: () => [],
  };
}

/**
 * モックスプレッドシート作成ヘルパー
 */
export function createMockSpreadsheet(
  id = 'mock-spreadsheet-id'
): GoogleAppsScript.Spreadsheet.Spreadsheet {
  const mockSheet = createMockSheet('Sheet1');

  return {
    getId: () => id,
    getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`,
    getName: () => 'Mock Spreadsheet',
    getSheetByName: (name: string) =>
      name === mockSheet.getName() ? mockSheet : null,
    getSheets: () => [mockSheet],
    insertSheet: (name: string) => createMockSheet(name),
  } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet;
}

/**
 * モックシート作成ヘルパー
 */
export function createMockSheet(
  name = 'Sheet1'
): GoogleAppsScript.Spreadsheet.Sheet {
  let lastRow = 0;
  const data: unknown[][] = [];

  return {
    getName: () => name,
    getLastRow: () => lastRow,
    getRange: (row: number, column: number, numRows?: number) => ({
      setValues: (values: unknown[][]) => {
        values.forEach((row, i) => {
          data[i] = row;
        });
        lastRow = Math.max(lastRow, row + (numRows || 1) - 1);
        return null;
      },
      getValues: () => data,
    }),
    appendRow: (rowContents: unknown[]) => {
      data[lastRow] = rowContents;
      lastRow++;
      return null;
    },
  } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
}

/**
 * モックフォーム作成ヘルパー
 */
export function createMockForm(
  destinationId: string | null = null
): GoogleAppsScript.Forms.Form {
  return {
    getDestinationId: () => destinationId,
    getId: () => 'mock-form-id',
    getTitle: () => 'Mock Form',
  } as unknown as GoogleAppsScript.Forms.Form;
}
