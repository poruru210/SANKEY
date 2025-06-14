import { triggerIntegrationTest, testConnection, onSankeyNotification } from '../src/integration';
import { NotificationData } from '../src/config';

// モック
const mockValidateConfig = jest.fn();
const mockSendWebhook = jest.fn();
const mockNotifyTestSuccess = jest.fn();
const mockNotifyIntegrationTestCompletion = jest.fn();
const mockRecordLicenseToSpreadsheet = jest.fn();

jest.mock('../src/config-manager', () => ({
  validateConfig: (...args: any[]) => mockValidateConfig(...args),
  getGasProjectId: () => 'script-123'
}));

jest.mock('../src/webhook', () => ({
  sendWebhook: (...args: any[]) => mockSendWebhook(...args),
  notifyTestSuccess: (...args: any[]) => mockNotifyTestSuccess(...args),
  notifyIntegrationTestCompletion: (...args: any[]) => mockNotifyIntegrationTestCompletion(...args)
}));

jest.mock('../src/spreadsheet', () => ({
  recordLicenseToSpreadsheet: (...args: any[]) => mockRecordLicenseToSpreadsheet(...args)
}));

// createJWTのモック
jest.mock('../src/jwt', () => ({
  createJWT: jest.fn(() => 'mock-jwt-token')
}));

// ScriptAppのモック
global.ScriptApp = {
  getScriptId: jest.fn(() => 'script-123')
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

describe('Integration Functions', () => {
  let mockCreateJWT: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    // JWTモックを取得
    mockCreateJWT = require('../src/jwt').createJWT;
    // デフォルトでJWT作成が成功するように設定
    mockCreateJWT.mockReturnValue('mock-jwt-token');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('triggerIntegrationTest', () => {
    test('should trigger integration test with testId', async () => {
      mockValidateConfig.mockReturnValue(true);
      mockSendWebhook.mockReturnValue({
        success: true,
        response: {
          data: {
            applicationId: 'app-test-123'
          }
        }
      });

      const result = await triggerIntegrationTest('test-id-123');

      expect(result.success).toBe(true);
      expect(result.testId).toBe('test-id-123');
      expect(result.applicationId).toBe('app-test-123');

      expect(mockSendWebhook).toHaveBeenCalledWith({
        eaName: 'Integration Test EA',
        accountNumber: 'INTEGRATION_TEST_123456',
        broker: 'Test Broker',
        email: 'integration-test@sankey.trade',
        xAccount: '@integration_test',
        integrationTestId: 'test-id-123'
      });
    });

    test('should fail without testId', async () => {
      mockValidateConfig.mockReturnValue(true);

      const result = await triggerIntegrationTest('');

      expect(result.success).toBe(false);
      expect(result.error).toBe('testId parameter is required');
      expect(mockSendWebhook).not.toHaveBeenCalled();
    });

    test('should fail with invalid config', async () => {
      mockValidateConfig.mockReturnValue(false);

      const result = await triggerIntegrationTest('test-id-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('設定が不正です');
      expect(mockSendWebhook).not.toHaveBeenCalled();
    });

    test('should handle webhook failure', async () => {
      mockValidateConfig.mockReturnValue(true);
      mockSendWebhook.mockReturnValue({
        success: false,
        error: 'Network error'
      });

      const result = await triggerIntegrationTest('test-id-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Integration test webhook failed: Network error');
    });

    test('should handle exception', async () => {
      mockValidateConfig.mockImplementation(() => {
        throw new Error('Config error');
      });

      const result = await triggerIntegrationTest('test-id-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: Config error');
    });
  });

  describe('testConnection', () => {
    test('should test connection successfully', async () => {
      mockValidateConfig.mockReturnValue(true);
      mockNotifyTestSuccess.mockReturnValue({
        success: true,
        response: { message: 'Test notification received' }
      });

      const result = await testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection test completed - SANKEY configuration verified');
      expect(result.notificationResult).toEqual({ message: 'Test notification received' });

      expect(mockNotifyTestSuccess).toHaveBeenCalledWith({
        success: true,
        timestamp: expect.any(String),
        details: 'GAS connection test completed - SANKEY configuration verified',
        gasProjectId: 'script-123'
      });
    });

    test('should handle invalid config', async () => {
      mockValidateConfig.mockReturnValue(false);

      const result = await testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe('設定が不正です');
      expect(mockNotifyTestSuccess).not.toHaveBeenCalled();
    });

    test('should handle JWT creation error', async () => {
      mockValidateConfig.mockReturnValue(true);
      mockCreateJWT.mockImplementation(() => {
        throw new Error('JWT creation failed');
      });

      const result = await testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe('JWT creation failed: Error: JWT creation failed');
      expect(mockNotifyTestSuccess).toHaveBeenCalledWith({
        success: false,
        timestamp: expect.any(String),
        details: 'JWT creation failed: Error: JWT creation failed'
      });
    });

    test('should handle notification failure', async () => {
      mockValidateConfig.mockReturnValue(true);
      mockNotifyTestSuccess.mockReturnValue({
        success: false,
        error: 'Notification failed'
      });

      const result = await testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe('SANKEY notification failed: Notification failed');
    });
  });

  describe('onSankeyNotification', () => {
    const notificationData: NotificationData = {
      userId: 'test-user-id',
      applicationId: 'app-123',
      licenseId: 'license-456',
      licenseValue: 'LICENSE_VALUE_789'
    };

    test('should process license notification', async () => {
      const result = await onSankeyNotification(notificationData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('License notification received successfully');

      expect(mockRecordLicenseToSpreadsheet).toHaveBeenCalledWith({
        userId: 'test-user-id',
        applicationId: 'app-123',
        licenseId: 'license-456',
        licenseValue: 'LICENSE_VALUE_789',
        testId: undefined,
        receivedAt: expect.any(Date)
      });
    });

    test('should process integration test notification', async () => {
      const testNotificationData: NotificationData = {
        ...notificationData,
        testId: 'test-123'
      };

      mockNotifyIntegrationTestCompletion.mockReturnValue({
        success: true,
        response: { message: 'Test completed' }
      });

      const result = await onSankeyNotification(testNotificationData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('License notification received and integration test completed');
      expect(result.integrationTestResult).toEqual({ message: 'Test completed' });

      expect(mockNotifyIntegrationTestCompletion).toHaveBeenCalledWith({
        userId: 'test-user-id',
        testId: 'test-123',
        licenseId: 'license-456',
        applicationId: 'app-123',
        success: true,
        timestamp: expect.any(String),
        details: 'Integration test completed successfully - License received via GAS webhook'
      });
    });

    test('should handle missing required parameters', async () => {
      const invalidData = {
        userId: 'test-user-id'
        // applicationIdとlicenseIdが欠落
      } as NotificationData;

      const result = await onSankeyNotification(invalidData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing required parameters: userId, applicationId, licenseId');
    });

    test('should continue even if spreadsheet recording fails', async () => {
      mockRecordLicenseToSpreadsheet.mockImplementation(() => {
        throw new Error('Spreadsheet error');
      });

      const result = await onSankeyNotification(notificationData);

      expect(result.success).toBe(true);
      expect(console.error).toHaveBeenCalledWith(
        'スプレッドシート記録エラー（処理は継続）:',
        expect.any(Error)
      );
    });

    test('should handle integration test completion failure', async () => {
      const testNotificationData: NotificationData = {
        ...notificationData,
        testId: 'test-123'
      };

      mockNotifyIntegrationTestCompletion.mockReturnValue({
        success: false,
        error: 'Completion notification failed'
      });

      const result = await onSankeyNotification(testNotificationData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('License notification received but integration test completion failed');
      expect(result.warning).toBe('Completion notification failed');
    });
  });
});
