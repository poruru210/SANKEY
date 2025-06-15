import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getOrCreateSheet,
  recordToSpreadsheet,
  recordLicenseToSpreadsheet,
} from '../src/spreadsheet';
import { FormData, LicenseData } from '../src/types';

// モックシートオブジェクト
const mockSheet = {
  getName: vi.fn(() => 'Test Sheet'),
  getLastRow: vi.fn(() => 0),
  getRange: vi.fn(),
  appendRow: vi.fn(),
};

const mockRange = {
  setValues: vi.fn(),
};

// モックスプレッドシートオブジェクト
const mockSpreadsheet = {
  getSheetByName: vi.fn(),
  insertSheet: vi.fn(() => mockSheet),
  getSheets: vi.fn(() => [mockSheet]),
  getId: vi.fn(() => 'spreadsheet-123'),
  getUrl: vi.fn(() => 'https://docs.google.com/spreadsheets/d/spreadsheet-123'),
};

// モックフォームオブジェクト
const mockForm = {
  getDestinationId: vi.fn(),
};

// Google Apps Script APIのモック
global.SpreadsheetApp = {
  openById: vi.fn(() => mockSpreadsheet),
  getActiveSpreadsheet: vi.fn(() => mockSpreadsheet),
  create: vi.fn(() => mockSpreadsheet),
} as any;

global.FormApp = {
  getActiveForm: vi.fn(() => mockForm),
} as any;

// グローバル設定
(global as any).CONFIG = {
  WEBHOOK_URL: 'https://example.com/webhook',
  TEST_NOTIFICATION_URL: 'https://example.com/test',
  RESULT_NOTIFICATION_URL: 'https://example.com/result',
  USER_ID: 'test-user-id',
  JWT_SECRET: 'dGVzdC1zZWNyZXQ=',
  FORM_FIELDS: {
    EA_NAME: {
      label: 'EA',
      type: 'select',
      required: true,
      options: ['EA1', 'EA2', 'EA3'],
    },
    ACCOUNT_NUMBER: {
      label: '口座番号',
      type: 'text',
      required: true,
      validation: 'number',
    },
    BROKER: {
      label: 'ブローカー',
      type: 'select',
      required: true,
      options: ['BrokerA', 'BrokerB', 'BrokerC'],
    },
    EMAIL: {
      label: 'メールアドレス',
      type: 'text',
      required: true,
      validation: 'email',
    },
    X_ACCOUNT: {
      label: 'ユーザー名',
      type: 'text',
      required: true,
    },
    SPREADSHEET_ID: '',
  },
};

describe('スプレッドシート機能', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSheet.getRange.mockReturnValue(mockRange);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getOrCreateSheet', () => {
    it('既存のシートを取得する', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(mockSheet);
      mockForm.getDestinationId.mockReturnValue('form-spreadsheet-123');

      const sheet = getOrCreateSheet('EA_APPLICATIONS');

      expect(sheet).toBe(mockSheet);
      expect(mockSpreadsheet.getSheetByName).toHaveBeenCalledWith(
        'EA_APPLICATIONS'
      );
      expect(console.log).toHaveBeenCalledWith(
        '既存のシートを使用:',
        'EA_APPLICATIONS'
      );
    });

    it('シートが存在しない場合は新規作成する', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(null);
      mockForm.getDestinationId.mockReturnValue('form-spreadsheet-123');

      const sheet = getOrCreateSheet('EA_LICENSES');

      expect(sheet).toBe(mockSheet);
      expect(mockSpreadsheet.insertSheet).toHaveBeenCalledWith('EA_LICENSES');
      expect(console.log).toHaveBeenCalledWith(
        '新しいシートを作成しました:',
        'EA_LICENSES'
      );
    });

    it('利用可能なスプレッドシートがない場合は新規作成する', () => {
      mockForm.getDestinationId.mockReturnValue(null);
      (global as any).SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(null);

      const sheet = getOrCreateSheet('EA_APPLICATIONS');

      expect((global as any).SpreadsheetApp.create).toHaveBeenCalledWith(
        expect.stringContaining('EA License Integration Test Data')
      );
      expect(sheet).toBe(mockSheet);
    });

    it('シート作成エラーを処理する', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(null);
      mockSpreadsheet.insertSheet.mockImplementation(() => {
        throw new Error('Sheet creation failed');
      });

      const sheet = getOrCreateSheet('EA_APPLICATIONS');

      expect(sheet).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('エラー'),
        expect.any(Error)
      );
    });
  });

  describe('recordToSpreadsheet', () => {
    const formData: FormData = {
      eaName: 'Test EA',
      accountNumber: '123456',
      broker: 'Test Broker',
      email: 'test@example.com',
      xAccount: '@testuser',
    };

    const responseData = {
      data: {
        applicationId: 'app-123',
        temporaryUrl: 'https://example.com/temp/123',
      },
    };

    it('申請データをスプレッドシートに記録する', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(mockSheet);
      mockSheet.getLastRow.mockReturnValue(0);

      recordToSpreadsheet(formData, responseData);

      // ヘッダー行の設定を確認
      expect(mockRange.setValues).toHaveBeenCalledWith([
        [
          '申請日時',
          'EA名',
          'ブローカー',
          '口座番号',
          'メール',
          'Xアカウント',
          '申請ID',
          '一時URL',
        ],
      ]);

      // データ行の追加を確認
      expect(mockSheet.appendRow).toHaveBeenCalledWith([
        expect.any(String), // タイムスタンプ
        'Test EA',
        'Test Broker',
        '123456',
        'test@example.com',
        '@testuser',
        'app-123',
        'https://example.com/temp/123',
      ]);
    });

    it('nullのレスポンスデータを処理する', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(mockSheet);
      mockSheet.getLastRow.mockReturnValue(1); // 既存の行がある

      recordToSpreadsheet(formData, undefined);

      expect(mockSheet.appendRow).toHaveBeenCalledWith([
        expect.any(String),
        'Test EA',
        'Test Broker',
        '123456',
        'test@example.com',
        '@testuser',
        '', // 空の申請ID
        '', // 空の一時URL
      ]);
    });

    it('スプレッドシートエラーを適切に処理する', () => {
      // getSheetByNameがエラーを投げるようにモック
      mockSpreadsheet.getSheetByName.mockImplementation(() => {
        throw new Error('Sheet access error');
      });

      // FormApp.getActiveFormもエラーを投げるようにして、フォールバックも失敗させる
      (global.FormApp.getActiveForm as any).mockImplementation(() => {
        throw new Error('Form access error');
      });

      // SpreadsheetApp.getActiveSpreadsheetもnullを返すようにする
      (global.SpreadsheetApp.getActiveSpreadsheet as any).mockReturnValue(null);

      // SpreadsheetApp.createもエラーを投げるようにする
      (global.SpreadsheetApp.create as any).mockImplementation(() => {
        throw new Error('Cannot create spreadsheet');
      });

      // getOrCreateSheetがnullを返すことを確認
      const sheet = getOrCreateSheet('EA_APPLICATIONS');
      expect(sheet).toBeNull();

      // recordToSpreadsheetでスキップメッセージが出ることを確認
      recordToSpreadsheet(formData, responseData);
      expect(console.warn).toHaveBeenCalledWith(
        'スプレッドシートへの記録をスキップします'
      );
    });
  });

  describe('recordLicenseToSpreadsheet', () => {
    const licenseData: LicenseData = {
      userId: 'test-user-id',
      applicationId: 'app-123',
      licenseId: 'license-456',
      licenseValue: 'LICENSE_VALUE_789',
      testId: undefined,
      receivedAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    it('ライセンスデータをスプレッドシートに記録する', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(mockSheet);
      mockSheet.getLastRow.mockReturnValue(0);

      recordLicenseToSpreadsheet(licenseData);

      // ヘッダー行の設定を確認
      expect(mockRange.setValues).toHaveBeenCalledWith([
        [
          '受信日時',
          'ユーザーID',
          '申請ID',
          'ライセンスID',
          'ライセンス値',
          'テストID',
          '備考',
        ],
      ]);

      // データ行の追加を確認
      expect(mockSheet.appendRow).toHaveBeenCalledWith([
        expect.any(String), // ローカライズされた日時
        'test-user-id',
        'app-123',
        'license-456',
        'LICENSE_VALUE_789',
        '',
        '本番',
      ]);
    });

    it('統合テストライセンスを記録する', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(mockSheet);
      mockSheet.getLastRow.mockReturnValue(1);

      const testLicenseData: LicenseData = {
        ...licenseData,
        testId: 'test-123',
      };

      recordLicenseToSpreadsheet(testLicenseData);

      expect(mockSheet.appendRow).toHaveBeenCalledWith([
        expect.any(String),
        'test-user-id',
        'app-123',
        'license-456',
        'LICENSE_VALUE_789',
        'test-123',
        '統合テスト',
      ]);
    });

    it('ライセンス値が欠落している場合を処理する', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(mockSheet);
      mockSheet.getLastRow.mockReturnValue(1);

      const minimalLicenseData: LicenseData = {
        ...licenseData,
        licenseValue: undefined,
      };

      recordLicenseToSpreadsheet(minimalLicenseData);

      expect(mockSheet.appendRow).toHaveBeenCalledWith([
        expect.any(String),
        'test-user-id',
        'app-123',
        'license-456',
        '', // 空のライセンス値
        '',
        '本番',
      ]);
    });
  });
});
