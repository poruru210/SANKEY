import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { doPost } from '../src/webapp';

// モック
const mockTriggerIntegrationTest = vi.fn();
const mockOnSankeyNotification = vi.fn();

vi.mock('../src/integration', () => ({
  triggerIntegrationTest: (...args: any[]) =>
    mockTriggerIntegrationTest(...args),
  onSankeyNotification: (...args: any[]) => mockOnSankeyNotification(...args),
}));

// ContentServiceのモック
const mockTextOutput = {
  setMimeType: vi.fn().mockReturnThis(),
};

const mockCreateTextOutput = vi.fn((content: string) => {
  // 実際の内容を保持する
  (mockTextOutput as any)._content = content;
  return mockTextOutput;
});

global.ContentService = {
  createTextOutput: mockCreateTextOutput,
  MimeType: {
    JSON: 'application/json',
  },
} as any;

describe('Webアプリケーション', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('doPost', () => {
    it('testIdを含む統合テストリクエストを処理する', () => {
      const mockEvent = {
        postData: {
          contents: JSON.stringify({
            action: 'integration_test',
            testId: 'test-123',
            timestamp: '2024-01-01T00:00:00.000Z',
          }),
        },
      };

      mockTriggerIntegrationTest.mockReturnValue({
        success: true,
        message: 'Integration test triggered',
        testId: 'test-123',
      });

      doPost(mockEvent as any);

      expect(mockTriggerIntegrationTest).toHaveBeenCalledWith('test-123');
      expect(mockCreateTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          success: true,
          message: 'Integration test triggered',
          testId: 'test-123',
        })
      );
    });

    it('testIdなしの統合テストを拒否する', () => {
      const mockEvent = {
        postData: {
          contents: JSON.stringify({
            action: 'integration_test',
            // testIdが欠落
          }),
        },
      };

      doPost(mockEvent as any);

      expect(mockTriggerIntegrationTest).not.toHaveBeenCalled();
      expect(mockCreateTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          success: false,
          error: 'testId is required for integration test',
        })
      );
    });

    it('SANKEY通知を処理する', () => {
      const mockEvent = {
        postData: {
          contents: JSON.stringify({
            userId: 'test-user-id',
            applicationId: 'app-123',
            licenseId: 'license-456',
          }),
        },
      };

      mockOnSankeyNotification.mockReturnValue({
        success: true,
        message: 'Notification processed',
      });

      doPost(mockEvent as any);

      expect(mockOnSankeyNotification).toHaveBeenCalledWith({
        userId: 'test-user-id',
        applicationId: 'app-123',
        licenseId: 'license-456',
      });
      expect(mockCreateTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          success: true,
          message: 'Notification processed',
        })
      );
    });

    it('POSTデータがない場合を処理する', () => {
      const mockEvent = {
        postData: null,
      };

      doPost(mockEvent as any);

      expect(mockCreateTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          success: false,
          error: 'No POST data received',
        })
      );
    });

    it('空のPOSTデータを処理する', () => {
      const mockEvent = {
        postData: {
          contents: '',
        },
      };

      doPost(mockEvent as any);

      expect(mockCreateTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          success: false,
          error: 'No POST data received',
        })
      );
    });

    it('無効なJSONを処理する', () => {
      const mockEvent = {
        postData: {
          contents: 'invalid json content',
        },
      };

      doPost(mockEvent as any);

      const call = mockCreateTextOutput.mock.calls[0][0];
      const parsed = JSON.parse(call);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('JSON');
    });

    it('処理中の例外を処理する', () => {
      const mockEvent = {
        postData: {
          contents: JSON.stringify({
            userId: 'test-user-id',
            applicationId: 'app-123',
            licenseId: 'license-456',
          }),
        },
      };

      const mockError = new Error('Processing error');
      mockOnSankeyNotification.mockImplementation(() => {
        throw mockError;
      });

      doPost(mockEvent as any);

      expect(mockCreateTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          success: false,
          error: 'Error: Processing error',
        })
      );
    });

    it('追加データを含む統合テストを処理する', () => {
      const mockEvent = {
        postData: {
          contents: JSON.stringify({
            action: 'integration_test',
            testId: 'test-456',
            timestamp: '2024-01-01T00:00:00.000Z',
            additionalData: 'some extra data',
          }),
        },
      };

      mockTriggerIntegrationTest.mockReturnValue({
        success: true,
        message: 'Test triggered',
      });

      doPost(mockEvent as any);

      expect(mockTriggerIntegrationTest).toHaveBeenCalledWith('test-456');
      expect(console.log).toHaveBeenCalledWith(
        '統合テスト実行リクエストを受信:',
        {
          testId: 'test-456',
          timestamp: '2024-01-01T00:00:00.000Z',
        }
      );
    });

    it('testIdを含むSANKEY通知を処理する', () => {
      const mockEvent = {
        postData: {
          contents: JSON.stringify({
            userId: 'test-user-id',
            applicationId: 'app-123',
            licenseId: 'license-456',
            testId: 'test-789',
          }),
        },
      };

      mockOnSankeyNotification.mockReturnValue({
        success: true,
        message: 'Integration test notification processed',
      });

      doPost(mockEvent as any);

      expect(mockOnSankeyNotification).toHaveBeenCalledWith({
        userId: 'test-user-id',
        applicationId: 'app-123',
        licenseId: 'license-456',
        testId: 'test-789',
      });
    });
  });
});
