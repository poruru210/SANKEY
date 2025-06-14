import { onFormSubmit } from '../src/form-handler';

// モック
const mockSendWebhook = jest.fn();
const mockRecordToSpreadsheet = jest.fn();

jest.mock('../src/webhook', () => ({
  sendWebhook: (...args: any[]) => mockSendWebhook(...args)
}));

jest.mock('../src/spreadsheet', () => ({
  recordToSpreadsheet: (...args: any[]) => mockRecordToSpreadsheet(...args)
}));

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
    }
  }
};

describe('Form Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // コンソールログをモック
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('onFormSubmit', () => {
    test('should process form submission successfully', () => {
      const mockEvent = {
        namedValues: {
          'EA': ['Test EA'],
          '口座番号': ['123456'],
          'ブローカー': ['Test Broker'],
          'メールアドレス': ['test@example.com'],
          'ユーザー名': ['@testuser']
        }
      };

      const mockWebhookResponse = {
        success: true,
        response: {
          data: {
            applicationId: 'app-123',
            temporaryUrl: 'https://example.com/temp/123'
          }
        }
      };

      mockSendWebhook.mockReturnValue(mockWebhookResponse);

      onFormSubmit(mockEvent as any);

      // フォームデータが正しく抽出されることを確認
      expect(mockSendWebhook).toHaveBeenCalledWith({
        eaName: 'Test EA',
        accountNumber: '123456',
        broker: 'Test Broker',
        email: 'test@example.com',
        xAccount: '@testuser'
      });

      // スプレッドシートに記録されることを確認
      expect(mockRecordToSpreadsheet).toHaveBeenCalledWith(
        {
          eaName: 'Test EA',
          accountNumber: '123456',
          broker: 'Test Broker',
          email: 'test@example.com',
          xAccount: '@testuser'
        },
        {
          data: {
            applicationId: 'app-123',
            temporaryUrl: 'https://example.com/temp/123'
          }
        }
      );

      expect(console.log).toHaveBeenCalledWith('✅ フォーム処理成功');
    });

    test('should handle missing form fields', () => {
      const mockEvent = {
        namedValues: {
          'EA': ['Test EA'],
          // 他のフィールドが欠落
        }
      };

      const mockWebhookResponse = {
        success: true,
        response: {}
      };

      mockSendWebhook.mockReturnValue(mockWebhookResponse);

      onFormSubmit(mockEvent as any);

      // 欠落フィールドは空文字列として処理される
      expect(mockSendWebhook).toHaveBeenCalledWith({
        eaName: 'Test EA',
        accountNumber: '',
        broker: '',
        email: '',
        xAccount: ''
      });
    });

    test('should handle webhook failure', () => {
      const mockEvent = {
        namedValues: {
          'EA': ['Test EA'],
          '口座番号': ['123456'],
          'ブローカー': ['Test Broker'],
          'メールアドレス': ['test@example.com'],
          'ユーザー名': ['@testuser']
        }
      };

      const mockWebhookResponse = {
        success: false,
        error: 'Network error'
      };

      mockSendWebhook.mockReturnValue(mockWebhookResponse);

      onFormSubmit(mockEvent as any);

      // エラーでもスプレッドシートには記録される
      expect(mockRecordToSpreadsheet).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('❌ フォーム処理失敗:', 'Network error');
    });

    test('should handle exception in form processing', () => {
      const mockEvent = {
        namedValues: null // 不正なイベントデータ
      };

      onFormSubmit(mockEvent as any);

      expect(console.error).toHaveBeenCalledWith(
        '❌ onFormSubmitエラー:',
        expect.any(Error)
      );
    });

    test('should handle undefined named values', () => {
      const mockEvent = {
        namedValues: {
          'EA': undefined,
          '口座番号': null,
          'ブローカー': [''],
          'メールアドレス': [],
          'ユーザー名': ['@testuser']
        }
      };

      const mockWebhookResponse = {
        success: true,
        response: {}
      };

      mockSendWebhook.mockReturnValue(mockWebhookResponse);

      onFormSubmit(mockEvent as any);

      // 不正な値は空文字列として処理される
      expect(mockSendWebhook).toHaveBeenCalledWith({
        eaName: '',
        accountNumber: '',
        broker: '',
        email: '',
        xAccount: '@testuser'
      });
    });
  });
});
