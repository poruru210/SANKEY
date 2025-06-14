import { sendWebhook, notifyTestSuccess, notifyIntegrationTestCompletion } from '../src/webhook';
import { FormData, TestResult } from '../src/config';

// UrlFetchAppのモック
const mockFetch = jest.fn();
global.UrlFetchApp = {
  fetch: mockFetch
} as any;

// Utilitiesのモック
global.Utilities = {
  sleep: jest.fn(),
  base64Encode: jest.fn((data: any) => Buffer.from(data).toString('base64')),
  base64Decode: jest.fn((data: string) => Buffer.from(data, 'base64').toString('binary')),
  computeHmacSha256Signature: jest.fn(() => new Uint8Array([1, 2, 3, 4, 5])),
  newBlob: jest.fn((data: string) => ({
    getBytes: () => new TextEncoder().encode(data)
  }))
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
    }
  }
};

describe('Webhook Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendWebhook', () => {
    const formData: FormData = {
      eaName: 'Test EA',
      accountNumber: '123456',
      broker: 'Test Broker',
      email: 'test@example.com',
      xAccount: '@testuser'
    };

    test('should send webhook successfully', async () => {
      const mockResponse = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          success: true,
          data: {
            applicationId: 'app-123',
            temporaryUrl: 'https://example.com/temp/123'
          }
        })
      };

      mockFetch.mockReturnValue(mockResponse);

      const result = await sendWebhook(formData);

      expect(result.success).toBe(true);
      expect(result.response).toEqual({
        success: true,
        data: {
          applicationId: 'app-123',
          temporaryUrl: 'https://example.com/temp/123'
        }
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'post',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          payload: expect.stringContaining('userId'),
          muteHttpExceptions: true
        })
      );
    });

    test('should handle 503 error with retry', async () => {
      const mockResponse503 = {
        getResponseCode: () => 503,
        getContentText: () => 'Service Unavailable'
      };

      const mockResponse200 = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ success: true })
      };

      mockFetch
        .mockReturnValueOnce(mockResponse503)
        .mockReturnValueOnce(mockResponse200);

      const result = await sendWebhook(formData);

      expect(result.success).toBe(true);
      expect(global.Utilities.sleep).toHaveBeenCalledWith(3000);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('should handle error response', async () => {
      const mockResponse = {
        getResponseCode: () => 400,
        getContentText: () => 'Bad Request'
      };

      mockFetch.mockReturnValue(mockResponse);

      const result = await sendWebhook(formData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP 400: Bad Request');
    });

    test('should handle network error', async () => {
      mockFetch.mockImplementation(() => {
        throw new Error('Network error');
      });

      const result = await sendWebhook(formData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: Network error');
    });

    test('should send integration test data', async () => {
      const integrationTestData: FormData = {
        eaName: 'Integration Test EA',
        accountNumber: 'INTEGRATION_TEST_123456',
        broker: 'Test Broker',
        email: 'integration-test@sankey.trade',
        xAccount: '@integration_test',
        integrationTestId: 'test-123'
      };

      const mockResponse = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ success: true })
      };

      mockFetch.mockReturnValue(mockResponse);

      const result = await sendWebhook(integrationTestData);

      expect(result.success).toBe(true);
    });
  });

  describe('notifyTestSuccess', () => {
    const testResult: TestResult = {
      success: true,
      timestamp: '2024-01-01T00:00:00.000Z',
      details: 'Test completed successfully',
      gasProjectId: 'project-123'
    };

    test('should notify test success', async () => {
      const mockResponse = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ message: 'Notification received' })
      };

      mockFetch.mockReturnValue(mockResponse);

      const result = await notifyTestSuccess(testResult);

      expect(result.success).toBe(true);
      expect(result.response).toEqual({ message: 'Notification received' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/test',
        expect.objectContaining({
          method: 'post',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          payload: expect.stringContaining('testResult'),
          muteHttpExceptions: true
        })
      );
    });

    test('should handle missing TEST_NOTIFICATION_URL', async () => {
      // getConfigをモックして空のTEST_NOTIFICATION_URLを返す
      jest.spyOn(require('../src/config-manager'), 'getConfig').mockReturnValue({
        ...(global as any).CONFIG,
        TEST_NOTIFICATION_URL: ''
      });

      const result = await notifyTestSuccess(testResult);

      expect(result.success).toBe(false);
      expect(result.error).toBe('TEST_NOTIFICATION_URL not configured');

      jest.restoreAllMocks();
    });

    test('should handle test failure notification', async () => {
      const failureResult: TestResult = {
        success: false,
        timestamp: '2024-01-01T00:00:00.000Z',
        details: 'Test failed: JWT creation error'
      };

      const mockResponse = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ message: 'Failure noted' })
      };

      mockFetch.mockReturnValue(mockResponse);

      const result = await notifyTestSuccess(failureResult);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          payload: expect.stringContaining('"success":false')
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
      details: 'Integration test completed'
    };

    test('should notify integration test completion', async () => {
      const mockResponse = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ success: true })
      };

      mockFetch.mockReturnValue(mockResponse);

      const result = await notifyIntegrationTestCompletion(completionData);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/test/complete',
        expect.objectContaining({
          method: 'post',
          payload: expect.stringContaining('testId')
        })
      );
    });

    test('should handle error response', async () => {
      const mockResponse = {
        getResponseCode: () => 500,
        getContentText: () => 'Internal Server Error'
      };

      mockFetch.mockReturnValue(mockResponse);

      const result = await notifyIntegrationTestCompletion(completionData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP 500: Internal Server Error');
    });
  });
});
