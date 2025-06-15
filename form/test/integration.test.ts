import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  triggerIntegrationTest,
  testConnection,
  onSankeyNotification,
} from '../src/integration';
import { NotificationData } from '../src/types';

// モック
const mockValidateConfig = vi.fn();
const mockSendWebhook = vi.fn();
const mockNotifyTestSuccess = vi.fn();
const mockNotifyIntegrationTestCompletion = vi.fn();
const mockRecordLicenseToSpreadsheet = vi.fn();

vi.mock('../src/config-manager', () => ({
  validateConfig: (...args: any[]) => mockValidateConfig(...args),
  getGasProjectId: () => 'script-123',
}));

vi.mock('../src/webhook', () => ({
  sendWebhook: (...args: any[]) => mockSendWebhook(...args),
  notifyTestSuccess: (...args: any[]) => mockNotifyTestSuccess(...args),
  notifyIntegrationTestCompletion: (...args: any[]) =>
    mockNotifyIntegrationTestCompletion(...args),
}));

vi.mock('../src/spreadsheet', () => ({
  recordLicenseToSpreadsheet: (...args: any[]) =>
    mockRecordLicenseToSpreadsheet(...args),
}));

// createJWTのモック
vi.mock('../src/jwt', () => ({
  createJWT: vi.fn(() => 'mock-jwt-token'),
}));

// ScriptAppのモック
global.ScriptApp = {
  getScriptId: vi.fn(() => 'script-123'),
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
  },
};

describe('統合機能', () => {
  let mockCreateJWT: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // JWTモックを取得
    const jwtModule = await import('../src/jwt');
    mockCreateJWT = jwtModule.createJWT as any;
    // デフォルトでJWT作成が成功するように設定
    mockCreateJWT.mockReturnValue('mock-jwt-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('triggerIntegrationTest', () => {
    it('testIdを使用して統合テストをトリガーする', async () => {
      mockValidateConfig.mockReturnValue(true);
      mockSendWebhook.mockReturnValue({
        success: true,
        response: {
          data: {
            applicationId: 'app-test-123',
          },
        },
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
        integrationTestId: 'test-id-123',
      });
    });

    it('testIdなしで失敗する', async () => {
      mockValidateConfig.mockReturnValue(true);

      const result = await triggerIntegrationTest('');

      expect(result.success).toBe(false);
      expect(result.error).toBe('testId parameter is required');
      expect(mockSendWebhook).not.toHaveBeenCalled();
    });

    it('無効な設定で失敗する', async () => {
      mockValidateConfig.mockReturnValue(false);

      const result = await triggerIntegrationTest('test-id-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('設定が不正です');
      expect(mockSendWebhook).not.toHaveBeenCalled();
    });

    it('Webhook送信失敗を処理する', async () => {
      mockValidateConfig.mockReturnValue(true);
      mockSendWebhook.mockReturnValue({
        success: false,
        error: 'Network error',
      });

      const result = await triggerIntegrationTest('test-id-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Integration test webhook failed: Network error'
      );
    });

    it('例外を処理する', async () => {
      mockValidateConfig.mockImplementation(() => {
        throw new Error('Config error');
      });

      const result = await triggerIntegrationTest('test-id-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: Config error');
    });
  });

  describe('testConnection', () => {
    it('接続テストが成功する', async () => {
      mockValidateConfig.mockReturnValue(true);
      mockNotifyTestSuccess.mockReturnValue({
        success: true,
        response: { message: 'Test notification received' },
      });

      const result = await testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'Connection test completed - SANKEY configuration verified'
      );
      expect(result.notificationResult).toEqual({
        message: 'Test notification received',
      });

      expect(mockNotifyTestSuccess).toHaveBeenCalledWith({
        success: true,
        timestamp: expect.any(String),
        details:
          'GAS connection test completed - SANKEY configuration verified',
        gasProjectId: 'script-123',
      });
    });

    it('無効な設定を処理する', async () => {
      mockValidateConfig.mockReturnValue(false);

      const result = await testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe('設定が不正です');
      expect(mockNotifyTestSuccess).not.toHaveBeenCalled();
    });

    it('JWT作成エラーを処理する', async () => {
      mockValidateConfig.mockReturnValue(true);
      mockCreateJWT.mockImplementation(() => {
        throw new Error('JWT creation failed');
      });

      const result = await testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'JWT creation failed: Error: JWT creation failed'
      );
      expect(mockNotifyTestSuccess).toHaveBeenCalledWith({
        success: false,
        timestamp: expect.any(String),
        details: 'JWT creation failed: Error: JWT creation failed',
      });
    });

    it('通知送信失敗を処理する', async () => {
      mockValidateConfig.mockReturnValue(true);
      mockNotifyTestSuccess.mockReturnValue({
        success: false,
        error: 'Notification failed',
      });

      const result = await testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'SANKEY notification failed: Notification failed'
      );
    });
  });

  describe('onSankeyNotification', () => {
    const notificationData: NotificationData = {
      userId: 'test-user-id',
      applicationId: 'app-123',
      licenseId: 'license-456',
      licenseValue: 'LICENSE_VALUE_789',
    };

    it('ライセンス通知を処理する', async () => {
      const result = await onSankeyNotification(notificationData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('License notification received successfully');

      expect(mockRecordLicenseToSpreadsheet).toHaveBeenCalledWith({
        userId: 'test-user-id',
        applicationId: 'app-123',
        licenseId: 'license-456',
        licenseValue: 'LICENSE_VALUE_789',
        testId: undefined,
        receivedAt: expect.any(Date),
      });
    });

    it('統合テスト通知を処理する', async () => {
      const testNotificationData: NotificationData = {
        ...notificationData,
        testId: 'test-123',
      };

      mockNotifyIntegrationTestCompletion.mockReturnValue({
        success: true,
        response: { message: 'Test completed' },
      });

      const result = await onSankeyNotification(testNotificationData);

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'License notification received and integration test completed'
      );
      expect(result.integrationTestResult).toEqual({
        message: 'Test completed',
      });

      expect(mockNotifyIntegrationTestCompletion).toHaveBeenCalledWith({
        userId: 'test-user-id',
        testId: 'test-123',
        licenseId: 'license-456',
        applicationId: 'app-123',
        success: true,
        timestamp: expect.any(String),
        details:
          'Integration test completed successfully - License received via GAS webhook',
      });
    });

    it('必須パラメータが欠落している場合を処理する', async () => {
      const invalidData = {
        userId: 'test-user-id',
        // applicationIdとlicenseIdが欠落
      } as NotificationData;

      const result = await onSankeyNotification(invalidData);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Missing required parameters: userId, applicationId, licenseId'
      );
    });

    it('スプレッドシート記録が失敗しても処理を継続する', async () => {
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

    it('統合テスト完了通知の失敗を処理する', async () => {
      const testNotificationData: NotificationData = {
        ...notificationData,
        testId: 'test-123',
      };

      mockNotifyIntegrationTestCompletion.mockReturnValue({
        success: false,
        error: 'Completion notification failed',
      });

      const result = await onSankeyNotification(testNotificationData);

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'License notification received but integration test completion failed'
      );
      expect(result.warning).toBe('Completion notification failed');
    });
  });
});
