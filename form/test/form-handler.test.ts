import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onFormSubmit } from '../src/form-handler';
import type {
  FormSubmitEvent,
  FormData,
  WebhookResponse,
  Config,
} from '../src/types';

// モック
const mockSendWebhook = vi.fn<(formData: FormData) => WebhookResponse>();
const mockRecordToSpreadsheet =
  vi.fn<(formData: FormData, responseData: unknown) => void>();

vi.mock('../src/webhook', () => ({
  sendWebhook: (formData: FormData) => mockSendWebhook(formData),
}));

vi.mock('../src/spreadsheet', () => ({
  recordToSpreadsheet: (formData: FormData, responseData: unknown) =>
    mockRecordToSpreadsheet(formData, responseData),
}));

// グローバル設定
(global as { CONFIG?: Config }).CONFIG = {
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
  },
};

describe('フォームハンドラー', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // コンソールログをモック
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onFormSubmit', () => {
    it('フォーム送信を正常に処理する', () => {
      const mockEvent: FormSubmitEvent = {
        namedValues: {
          EA: ['Test EA'],
          口座番号: ['123456'],
          ブローカー: ['Test Broker'],
          メールアドレス: ['test@example.com'],
          ユーザー名: ['@testuser'],
        },
      };

      const mockWebhookResponse: WebhookResponse = {
        success: true,
        response: {
          data: {
            applicationId: 'app-123',
            temporaryUrl: 'https://example.com/temp/123',
          },
        },
      };

      mockSendWebhook.mockReturnValue(mockWebhookResponse);

      onFormSubmit(mockEvent);

      // フォームデータが正しく抽出されることを確認
      expect(mockSendWebhook).toHaveBeenCalledWith({
        eaName: 'Test EA',
        accountNumber: '123456',
        broker: 'Test Broker',
        email: 'test@example.com',
        xAccount: '@testuser',
      });

      // スプレッドシートに記録されることを確認
      expect(mockRecordToSpreadsheet).toHaveBeenCalledWith(
        {
          eaName: 'Test EA',
          accountNumber: '123456',
          broker: 'Test Broker',
          email: 'test@example.com',
          xAccount: '@testuser',
        },
        {
          data: {
            applicationId: 'app-123',
            temporaryUrl: 'https://example.com/temp/123',
          },
        }
      );

      expect(console.log).toHaveBeenCalledWith('✅ フォーム処理成功');
    });

    it('欠落したフォームフィールドを処理する', () => {
      const mockEvent: FormSubmitEvent = {
        namedValues: {
          EA: ['Test EA'],
          // 他のフィールドが欠落
        },
      };

      const mockWebhookResponse: WebhookResponse = {
        success: true,
        response: {},
      };

      mockSendWebhook.mockReturnValue(mockWebhookResponse);

      onFormSubmit(mockEvent);

      // 欠落フィールドは空文字列として処理される
      expect(mockSendWebhook).toHaveBeenCalledWith({
        eaName: 'Test EA',
        accountNumber: '',
        broker: '',
        email: '',
        xAccount: '',
      });
    });

    it('Webhook送信失敗を処理する', () => {
      const mockEvent: FormSubmitEvent = {
        namedValues: {
          EA: ['Test EA'],
          口座番号: ['123456'],
          ブローカー: ['Test Broker'],
          メールアドレス: ['test@example.com'],
          ユーザー名: ['@testuser'],
        },
      };

      const mockWebhookResponse: WebhookResponse = {
        success: false,
        error: 'Network error',
      };

      mockSendWebhook.mockReturnValue(mockWebhookResponse);

      onFormSubmit(mockEvent);

      // エラーでもスプレッドシートには記録される
      expect(mockRecordToSpreadsheet).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        '❌ フォーム処理失敗:',
        'Network error'
      );
    });

    it('フォーム処理中の例外を処理する', () => {
      const mockEvent = {
        namedValues: null, // 不正なイベントデータ
      } as unknown as FormSubmitEvent;

      onFormSubmit(mockEvent);

      expect(console.error).toHaveBeenCalledWith(
        '❌ onFormSubmitエラー:',
        expect.any(Error)
      );
    });

    it('未定義の名前付き値を処理する', () => {
      const mockEvent: FormSubmitEvent = {
        namedValues: {
          EA: undefined,
          口座番号: undefined,
          ブローカー: [''],
          メールアドレス: [],
          ユーザー名: ['@testuser'],
        },
      };

      const mockWebhookResponse: WebhookResponse = {
        success: true,
        response: {},
      };

      mockSendWebhook.mockReturnValue(mockWebhookResponse);

      onFormSubmit(mockEvent);

      // 不正な値は空文字列として処理される
      expect(mockSendWebhook).toHaveBeenCalledWith({
        eaName: '',
        accountNumber: '',
        broker: '',
        email: '',
        xAccount: '@testuser',
      });
    });
  });
});
