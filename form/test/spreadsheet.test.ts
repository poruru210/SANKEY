import { getOrCreateSheet, recordToSpreadsheet, recordLicenseToSpreadsheet } from '../src/spreadsheet';
import { FormData, LicenseData } from '../src/config';

// モックシートオブジェクト
const mockSheet = {
  getName: jest.fn(() => 'Test Sheet'),
  getLastRow: jest.fn(() => 0),
  getRange: jest.fn(),
  appendRow: jest.fn()
};

const mockRange = {
  setValues: jest.fn()
};

// モックスプレッドシートオブジェクト
const mockSpreadsheet = {
  getSheetByName: jest.fn(),
  insertSheet: jest.fn(() => mockSheet),
  getSheets: jest.fn(() => [mockSheet]),
  getId: jest.fn(() => 'spreadsheet-123'),
  getUrl: jest.fn(() => 'https://docs.google.com/spreadsheets/d/spreadsheet-123')
};

// モックフォームオブジェクト
const mockForm = {
  getDestinationId: jest.fn()
};

// Google Apps Script APIのモック
global.SpreadsheetApp = {
  openById: jest.fn(() => mockSpreadsheet),
  getActiveSpreadsheet: jest.fn(() => mockSpreadsheet),
  create: jest.fn(() => mockSpreadsheet)
} as any;

global.FormApp = {
  getActiveForm: jest.fn(() => mockForm)
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
      label: "EA",
      type: "select",
      required: true,
      options: ["EA1", "EA2", "EA3"]
    },
    ACCOUNT_NUMBER: {
      label: "口座番号",
      type: "text",
      required: true,
      validation: "number"
    },
    BROKER: {
      label: "ブローカー",
      type: "select",
      required: true,
      options: ["BrokerA", "BrokerB", "BrokerC"]
    },
    EMAIL: {
      label: "メールアドレス",
      type: "text",
      required: true,
      validation: "email"
    },
    X_ACCOUNT: {
      label: "ユーザー名",
      type: "text",
      required: true
    },
    SPREADSHEET_ID: ""
  }
};

describe('Spreadsheet Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSheet.getRange.mockReturnValue(mockRange);
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getOrCreateSheet', () => {
    test('should get existing sheet', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(mockSheet);
      mockForm.getDestinationId.mockReturnValue('form-spreadsheet-123');

      const sheet = getOrCreateSheet('EA_APPLICATIONS');

      expect(sheet).toBe(mockSheet);
      expect(mockSpreadsheet.getSheetByName).toHaveBeenCalledWith('EA_APPLICATIONS');
      expect(console.log).toHaveBeenCalledWith('既存のシートを使用:', 'EA_APPLICATIONS');
    });

    test('should create new sheet if not exists', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(null);
      mockForm.getDestinationId.mockReturnValue('form-spreadsheet-123');

      const sheet = getOrCreateSheet('EA_LICENSES');

      expect(sheet).toBe(mockSheet);
      expect(mockSpreadsheet.insertSheet).toHaveBeenCalledWith('EA_LICENSES');
      expect(console.log).toHaveBeenCalledWith('新しいシートを作成しました:', 'EA_LICENSES');
    });

    test('should use configured spreadsheet ID', () => {
      // SPREADSHEET_IDを別の場所に保存するように変更
      const mockConfigWithSpreadsheetId = {
        ...(global as any).CONFIG,
        FORM_FIELDS: {
          ...(global as any).CONFIG.FORM_FIELDS,
          SPREADSHEET_ID: 'configured-sheet-123'
        }
      };

      jest.spyOn(require('../src/config-manager'), 'getConfig').mockReturnValue(mockConfigWithSpreadsheetId);
      mockForm.getDestinationId.mockReturnValue(null);

      getOrCreateSheet('EA_APPLICATIONS');

      expect((global as any).SpreadsheetApp.openById).toHaveBeenCalledWith('configured-sheet-123');

      jest.restoreAllMocks();
    });

    test('should create new spreadsheet if none available', () => {
      mockForm.getDestinationId.mockReturnValue(null);
      (global as any).SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(null);

      const sheet = getOrCreateSheet('EA_APPLICATIONS');

      expect((global as any).SpreadsheetApp.create).toHaveBeenCalledWith(
        expect.stringContaining('EA License Integration Test Data')
      );
      expect(sheet).toBe(mockSheet);
    });

    test('should handle sheet creation error', () => {
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
      xAccount: '@testuser'
    };

    const responseData = {
      data: {
        applicationId: 'app-123',
        temporaryUrl: 'https://example.com/temp/123'
      }
    };

    test('should record application data to spreadsheet', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(mockSheet);
      mockSheet.getLastRow.mockReturnValue(0);

      recordToSpreadsheet(formData, responseData);

      // ヘッダー行の設定を確認
      expect(mockRange.setValues).toHaveBeenCalledWith([[
        '申請日時', 'EA名', 'ブローカー', '口座番号', 'メール', 'Xアカウント', '申請ID', '一時URL'
      ]]);

      // データ行の追加を確認
      expect(mockSheet.appendRow).toHaveBeenCalledWith([
        expect.any(String), // タイムスタンプ
        'Test EA',
        'Test Broker',
        '123456',
        'test@example.com',
        '@testuser',
        'app-123',
        'https://example.com/temp/123'
      ]);
    });

    test('should handle null response data', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(mockSheet);
      mockSheet.getLastRow.mockReturnValue(1); // 既存の行がある

      recordToSpreadsheet(formData, null);

      expect(mockSheet.appendRow).toHaveBeenCalledWith([
        expect.any(String),
        'Test EA',
        'Test Broker',
        '123456',
        'test@example.com',
        '@testuser',
        '', // 空の申請ID
        ''  // 空の一時URL
      ]);
    });

    test('should handle spreadsheet error gracefully', () => {
      // getSheetByNameがエラーを投げるようにモック
      mockSpreadsheet.getSheetByName.mockImplementation(() => {
        throw new Error('Sheet access error');
      });
      mockForm.getDestinationId.mockReturnValue('form-spreadsheet-123');

      // getOrCreateSheetがnullを返すことを確認
      const sheet = getOrCreateSheet('EA_APPLICATIONS');
      expect(sheet).toBeNull();

      // recordToSpreadsheetでスキップメッセージが出ることを確認
      recordToSpreadsheet(formData, responseData);
      expect(console.warn).toHaveBeenCalledWith('スプレッドシートへの記録をスキップします');
    });
  });

  describe('recordLicenseToSpreadsheet', () => {
    const licenseData: LicenseData = {
      userId: 'test-user-id',
      applicationId: 'app-123',
      licenseId: 'license-456',
      licenseValue: 'LICENSE_VALUE_789',
      testId: undefined,
      receivedAt: new Date('2024-01-01T00:00:00.000Z')
    };

    test('should record license data to spreadsheet', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(mockSheet);
      mockSheet.getLastRow.mockReturnValue(0);

      recordLicenseToSpreadsheet(licenseData);

      // ヘッダー行の設定を確認
      expect(mockRange.setValues).toHaveBeenCalledWith([[
        '受信日時', 'ユーザーID', '申請ID', 'ライセンスID', 'ライセンス値', 'テストID', '備考'
      ]]);

      // データ行の追加を確認
      expect(mockSheet.appendRow).toHaveBeenCalledWith([
        expect.any(String), // ローカライズされた日時
        'test-user-id',
        'app-123',
        'license-456',
        'LICENSE_VALUE_789',
        '',
        '本番'
      ]);
    });

    test('should record integration test license', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(mockSheet);
      mockSheet.getLastRow.mockReturnValue(1);

      const testLicenseData: LicenseData = {
        ...licenseData,
        testId: 'test-123'
      };

      recordLicenseToSpreadsheet(testLicenseData);

      expect(mockSheet.appendRow).toHaveBeenCalledWith([
        expect.any(String),
        'test-user-id',
        'app-123',
        'license-456',
        'LICENSE_VALUE_789',
        'test-123',
        '統合テスト'
      ]);
    });

    test('should handle missing license value', () => {
      mockSpreadsheet.getSheetByName.mockReturnValue(mockSheet);
      mockSheet.getLastRow.mockReturnValue(1);

      const minimalLicenseData: LicenseData = {
        ...licenseData,
        licenseValue: undefined
      };

      recordLicenseToSpreadsheet(minimalLicenseData);

      expect(mockSheet.appendRow).toHaveBeenCalledWith([
        expect.any(String),
        'test-user-id',
        'app-123',
        'license-456',
        '', // 空のライセンス値
        '',
        '本番'
      ]);
    });
  });
});
