import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sendWebhook,
  notifyTestSuccess,
  notifyIntegrationTestCompletion,
} from '../src/webhook';
import { FormData, TestResult } from '../src/types';

// グローバル設定 (CONFIG is also set in vitest.setup.ts, this might be redundant or override)
// For now, retain it to ensure tests have their specific CONFIG values if needed.
(globalThis as any).CONFIG = {
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

// Helper type for mock HTTPResponse objects
type MockHTTPResponse = {
  getResponseCode: () => number;
  getContentText: () => string;
  // Add other HTTPResponse methods if used by the code under test
};

describe('Webhook機能', () => {
  let fetchSpy: vi.SpyInstance<
    [
      url: string,
      params?: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions | undefined,
    ],
    GoogleAppsScript.URL_Fetch.HTTPResponse
  >;
  let _computeHmacSha256SignatureSpy: vi.SpyInstance; // Prefixed as unused in this file's assertions
  let _newBlobSpy: vi.SpyInstance; // Prefixed as unused in this file's assertions
  let sleepSpy: vi.SpyInstance;

  beforeEach(() => {
    vi.clearAllMocks();

    if (!globalThis.UrlFetchApp || !globalThis.Utilities) {
      throw new Error(
        'GAS globals (UrlFetchApp, Utilities) not found. Check vitest.setup.ts.'
      );
    }

    fetchSpy = vi.spyOn(globalThis.UrlFetchApp, 'fetch');

    // Spy on Utilities methods but rely on vitest.setup.ts for their mock implementation
    _computeHmacSha256SignatureSpy = vi.spyOn(
      globalThis.Utilities,
      'computeHmacSha256Signature'
    );
    _newBlobSpy = vi.spyOn(globalThis.Utilities, 'newBlob');
    sleepSpy = vi.spyOn(globalThis.Utilities, 'sleep');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sendWebhook', () => {
    const formData: FormData = {
      eaName: 'Test EA',
      accountNumber: '123456',
      broker: 'Test Broker',
      email: 'test@example.com',
      xAccount: '@testuser',
    };

    it('Webhookを正常に送信する', async () => {
      const mockResponse = {
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({
            success: true,
            data: {
              applicationId: 'app-123',
              temporaryUrl: 'https://example.com/temp/123',
            },
          }),
      };

      fetchSpy.mockReturnValue(mockResponse as MockHTTPResponse);

      const result = await sendWebhook(formData);

      expect(result.success).toBe(true);
      expect(result.response).toEqual({
        success: true,
        data: {
          applicationId: 'app-123',
          temporaryUrl: 'https://example.com/temp/123',
        },
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'post',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          payload: expect.stringContaining('userId'),
          muteHttpExceptions: true,
        })
      );
    });

    it('503エラーをリトライで処理する', async () => {
      const mockResponse503 = {
        getResponseCode: () => 503,
        getContentText: () => 'Service Unavailable',
      };

      const mockResponse200 = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ success: true }),
      };

      fetchSpy
        .mockReturnValueOnce(mockResponse503 as MockHTTPResponse)
        .mockReturnValueOnce(mockResponse200 as MockHTTPResponse);

      const result = await sendWebhook(formData);

      expect(result.success).toBe(true);
      expect(sleepSpy).toHaveBeenCalledWith(3000);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('エラーレスポンスを処理する', async () => {
      const mockResponse = {
        getResponseCode: () => 400,
        getContentText: () => 'Bad Request',
      };

      fetchSpy.mockReturnValue(mockResponse as MockHTTPResponse);

      const result = await sendWebhook(formData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP 400: Bad Request');
    });

    it('ネットワークエラーを処理する', async () => {
      fetchSpy.mockImplementation(() => {
        throw new Error('Network error');
      });

      const result = await sendWebhook(formData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: Network error');
    });

    it('統合テストデータを送信する', async () => {
      const integrationTestData: FormData = {
        eaName: 'Integration Test EA',
        accountNumber: 'INTEGRATION_TEST_123456',
        broker: 'Test Broker',
        email: 'integration-test@sankey.trade',
        xAccount: '@integration_test',
        integrationTestId: 'test-123',
      };

      const mockResponse = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ success: true }),
      };

      fetchSpy.mockReturnValue(mockResponse as MockHTTPResponse);

      const result = await sendWebhook(integrationTestData);

      expect(result.success).toBe(true);
    });
  });

  describe('notifyTestSuccess', () => {
    const testResult: TestResult = {
      success: true,
      timestamp: '2024-01-01T00:00:00.000Z',
      details: 'Test completed successfully',
      gasProjectId: 'project-123',
    };

    it('テスト成功を通知する', async () => {
      const mockResponse = {
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({ message: 'Notification received' }),
      };

      fetchSpy.mockReturnValue(mockResponse as MockHTTPResponse);

      const result = await notifyTestSuccess(testResult);

      expect(result.success).toBe(true);
      expect(result.response).toEqual({ message: 'Notification received' });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com/test',
        expect.objectContaining({
          method: 'post',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          payload: expect.stringContaining('testResult'),
          muteHttpExceptions: true,
        })
      );
    });

    it('TEST_NOTIFICATION_URLが欠落している場合を処理する', async () => {
      // getConfigをモックして空のTEST_NOTIFICATION_URLを返す
      // This test specifically tests logic within notifyTestSuccess for missing URL,
      // so we don't want UrlFetchApp.fetch to be called.
      // We need to mock getConfig which is used internally by notifyTestSuccess.
      // This requires careful handling if getConfig is also used by sendWebhook.
      // For simplicity, if TEST_NOTIFICATION_URL is empty, fetch shouldn't be called.

      // Mock getConfig from config-manager to return an empty TEST_NOTIFICATION_URL
      // This is the correct way to influence the config used by the function under test.
      const configManager = await import('../src/config-manager');
      // No need to store originalGetConfig if using mockRestore() or restoreAllMocks()
      vi.spyOn(configManager, 'getConfig').mockReturnValue({
        ...(globalThis as any).CONFIG,
        TEST_NOTIFICATION_URL: '',
      });

      const result = await notifyTestSuccess(testResult);

      expect(result.success).toBe(false);
      expect(result.error).toBe('TEST_NOTIFICATION_URL not configured');
      expect(fetchSpy).not.toHaveBeenCalled();

      // vi.restoreAllMocks() in afterEach will handle restoring getConfig
    });

    it('テスト失敗通知を処理する', async () => {
      const failureResult: TestResult = {
        success: false,
        timestamp: '2024-01-01T00:00:00.000Z',
        details: 'Test failed: JWT creation error',
      };

      const mockResponse = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ message: 'Failure noted' }),
      };

      fetchSpy.mockReturnValue(mockResponse as MockHTTPResponse);

      const result = await notifyTestSuccess(failureResult);

      expect(result.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          payload: expect.stringContaining('"success":false'),
        })
      );
    });
  });

  describe('notifyIntegrationTestCompletion', () => {
    const completionData = {
      userId: 'test-user-id',
      testId: 'test-123',
      licenseId: 'license-456',
      applicationId: 'app-789',
      success: true,
      timestamp: '2024-01-01T00:00:00.000Z',
      details: 'Integration test completed',
    };

    it('統合テスト完了を通知する', async () => {
      const mockResponse = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ success: true }),
      };

      fetchSpy.mockReturnValue(mockResponse as MockHTTPResponse);
      fetchSpy.mockReturnValue(mockResponse as MockHTTPResponse);

      const result = await notifyIntegrationTestCompletion(completionData);

      expect(result.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com/test/complete',
        expect.objectContaining({
          method: 'post',
          payload: expect.stringContaining('testId'),
        })
      );
    });

    it('エラーレスポンスを処理する', async () => {
      const mockResponse = {
        getResponseCode: () => 500,
        getContentText: () => 'Internal Server Error',
      };

      fetchSpy.mockReturnValue(mockResponse as any);

      const result = await notifyIntegrationTestCompletion(completionData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP 500: Internal Server Error');
    });
  });
});
