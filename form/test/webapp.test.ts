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

describe('Webアプリケーション', () => {
  let createTextOutputSpy: vi.SpyInstance;
  // Spies for setMimeType on the returned TextOutput object will be created within tests if needed

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Spy on the global ContentService.createTextOutput
    // This relies on ContentService being available globally from vitest.setup.ts
    if (!globalThis.ContentService || !globalThis.ContentService.createTextOutput) {
      throw new Error("globalThis.ContentService.createTextOutput is not defined. Check vitest.setup.ts");
    }
    createTextOutputSpy = vi.spyOn(globalThis.ContentService, 'createTextOutput');
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

      const result = doPost(mockEvent as any);

      expect(mockTriggerIntegrationTest).toHaveBeenCalledWith('test-123');
      expect(createTextOutputSpy).toHaveBeenCalledTimes(1);
      const jsonResponse = JSON.parse(createTextOutputSpy.mock.calls[0][0]);
      expect(jsonResponse).toEqual({
        success: true,
        message: 'Integration test triggered',
        testId: 'test-123',
      });
      expect(result.setMimeType).toHaveBeenCalledWith(globalThis.ContentService.MimeType.JSON);
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

      const result = doPost(mockEvent as any);

      expect(mockTriggerIntegrationTest).not.toHaveBeenCalled();
      expect(createTextOutputSpy).toHaveBeenCalledTimes(1);
      const jsonResponse = JSON.parse(createTextOutputSpy.mock.calls[0][0]);
      expect(jsonResponse).toEqual({
        success: false,
        error: 'testId is required for integration test',
      });
      expect(result.setMimeType).toHaveBeenCalledWith(globalThis.ContentService.MimeType.JSON);
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

      const result = doPost(mockEvent as any);

      expect(mockOnSankeyNotification).toHaveBeenCalledWith({
        userId: 'test-user-id',
        applicationId: 'app-123',
        licenseId: 'license-456',
      });
      expect(createTextOutputSpy).toHaveBeenCalledTimes(1);
      const jsonResponse = JSON.parse(createTextOutputSpy.mock.calls[0][0]);
      expect(jsonResponse).toEqual({
        success: true,
        message: 'Notification processed',
      });
      expect(result.setMimeType).toHaveBeenCalledWith(globalThis.ContentService.MimeType.JSON);
    });

    it('POSTデータがない場合を処理する', () => {
      const mockEvent = {
        postData: null,
      };

      const result = doPost(mockEvent as any);

      expect(createTextOutputSpy).toHaveBeenCalledTimes(1);
      const jsonResponse = JSON.parse(createTextOutputSpy.mock.calls[0][0]);
      expect(jsonResponse).toEqual({
          success: false,
          error: 'No POST data received',
      });
      expect(result.setMimeType).toHaveBeenCalledWith(globalThis.ContentService.MimeType.JSON);
    });

    it('空のPOSTデータを処理する', () => {
      const mockEvent = {
        postData: {
          contents: '',
        },
      };

      const result = doPost(mockEvent as any);

      expect(createTextOutputSpy).toHaveBeenCalledTimes(1);
      const jsonResponse = JSON.parse(createTextOutputSpy.mock.calls[0][0]);
      expect(jsonResponse).toEqual({
          success: false,
          error: 'No POST data received',
      });
      expect(result.setMimeType).toHaveBeenCalledWith(globalThis.ContentService.MimeType.JSON);
    });

    it('無効なJSONを処理する', () => {
      const mockEvent = {
        postData: {
          contents: 'invalid json content',
        },
      };

      const result = doPost(mockEvent as any);

      expect(createTextOutputSpy).toHaveBeenCalledTimes(1);
      const jsonResponse = JSON.parse(createTextOutputSpy.mock.calls[0][0]);
      expect(jsonResponse.success).toBe(false);
      expect(jsonResponse.error).toContain('JSON');
      expect(result.setMimeType).toHaveBeenCalledWith(globalThis.ContentService.MimeType.JSON);
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

      const result = doPost(mockEvent as any);

      expect(createTextOutputSpy).toHaveBeenCalledTimes(1);
      const jsonResponse = JSON.parse(createTextOutputSpy.mock.calls[0][0]);
      expect(jsonResponse).toEqual({
          success: false,
          error: 'Error: Processing error',
      });
      expect(result.setMimeType).toHaveBeenCalledWith(globalThis.ContentService.MimeType.JSON);
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
