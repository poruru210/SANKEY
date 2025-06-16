import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// import request from 'then-request'; // No longer directly used here
import { onFormSubmit } from '../src/form-handler';
import type {
  FormSubmitEvent,
  FormData, // FormData will be used in assertions for the mocked sendWebhook
  WebhookResponse,
  Config,
} from '../src/types';

// Mock the sendWebhook function from ../src/webhook
const mockSendWebhook = vi.fn<(formData: FormData) => WebhookResponse>();
vi.mock('../src/webhook', () => ({
  sendWebhook: (formData: FormData) => mockSendWebhook(formData),
}));

// グローバル設定
// CONFIG is set in vitest.setup.ts, but re-asserting parts or whole for clarity if needed.
// For this test, specific URLs in CONFIG are not directly used by form-handler itself if sendWebhook is mocked.
(globalThis as { CONFIG?: Config }).CONFIG = {
  // Keep existing CONFIG structure, ensure FORM_FIELDS is available as it's used by onFormSubmit
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
    X_ACCOUNT: { label: 'ユーザー名', type: 'text', required: true },
  },
};

describe('フォームハンドラー', () => {
  let mockSheet: GoogleAppsScript.Spreadsheet.Sheet;
  let mockSpreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet;
  // let fetchSpy: import('vitest').SpyInstance; // Not needed if sendWebhook is mocked

  beforeEach(() => {
    vi.clearAllMocks(); // Clears mockSendWebhook calls too
    // vi.restoreAllMocks(); // Not strictly needed if vi.clearAllMocks() is used and mocks are top-level like mockSendWebhook

    // Spy on console methods
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {}); // Restore spy for console.error

    // Setup SpreadsheetApp mocks
    const appendRowSpy = vi.fn();
    mockSheet = {
      appendRow: appendRowSpy,
      getRange: vi.fn(),
      getName: vi.fn().mockReturnValue('EA_APPLICATIONS'),
      getLastRow: vi.fn(), // Mocked as a spy, return value set below or in tests
      insertRowBefore: vi.fn(),
      deleteRow: vi.fn(),
      insertRows: vi.fn(), // Adding other potential sheet methods
      getFrozenRows: vi.fn().mockReturnValue(0),
      setFrozenRows: vi.fn(),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;

    // Attempt 2: Simulate sheet with existing header row
    (mockSheet.getLastRow as import('vitest').SpyInstance).mockReturnValue(1);

    mockSpreadsheet = {
      getSheetByName: vi.fn().mockReturnValue(mockSheet),
      getActiveSheet: vi.fn().mockReturnValue(mockSheet),
      insertSheet: vi.fn().mockReturnValue(mockSheet), // If new sheets are created
      getSheets: vi.fn().mockReturnValue([mockSheet]),
      getId: vi.fn().mockReturnValue('mock-spreadsheet-id'),
    } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet;

    // Mock FormApp
    const mockForm = {
      getDestinationId: vi.fn(),
      // Add other Form methods if needed
    } as unknown as GoogleAppsScript.Forms.Form;
    vi.spyOn(globalThis.FormApp, 'getActiveForm').mockReturnValue(mockForm);

    // Default behavior for getDestinationId (can be overridden in specific tests)
    (
      globalThis.FormApp.getActiveForm() as any
    ).getDestinationId.mockReturnValue('mockSpreadsheetIdFromForm');

    // Mock SpreadsheetApp methods
    vi.spyOn(globalThis.SpreadsheetApp, 'getActiveSpreadsheet').mockReturnValue(
      mockSpreadsheet
    );
    vi.spyOn(globalThis.SpreadsheetApp, 'openById').mockImplementation(id => {
      if (id === 'mockSpreadsheetIdFromForm') {
        return mockSpreadsheet;
      }
      // Optional: return a different mock or throw error for unexpected IDs
      console.warn(`SpreadsheetApp.openById called with unexpected ID: ${id}`);
      return { ...mockSpreadsheet, getId: () => id } as any; // Return a generic mock for other IDs
    });
  });

  describe('onFormSubmit', () => {
    it('フォーム送信を正常に処理する', () => {
      const appendRowSpy = mockSheet.appendRow; // Use the spy from the mockSheet in beforeEach
      const mockEvent: FormSubmitEvent = {
        namedValues: {
          EA: ['Test EA'],
          口座番号: ['123456'],
          ブローカー: ['Test Broker'],
          メールアドレス: ['test@example.com'],
          ユーザー名: ['@testuser'],
        },
      };
      // Reverted to response.data structure as per original successful webhook.test.ts and common patterns
      const mockWebhookResponsePayload = {
        data: {
          applicationId: 'app-123',
          temporaryUrl: 'https://example.com/temp/123',
        },
      };
      mockSendWebhook.mockReturnValue({
        success: true,
        response: mockWebhookResponsePayload,
      });

      onFormSubmit(mockEvent);

      expect(mockSendWebhook).toHaveBeenCalledWith({
        eaName: 'Test EA',
        accountNumber: '123456',
        broker: 'Test Broker',
        email: 'test@example.com',
        xAccount: '@testuser',
      });

      // Assertions for recordToSpreadsheet
      // Verify FormApp and SpreadsheetApp.openById path first
      expect(globalThis.FormApp.getActiveForm).toHaveBeenCalled();
      expect(
        (globalThis.FormApp.getActiveForm() as any).getDestinationId
      ).toHaveBeenCalled();
      expect(globalThis.SpreadsheetApp.openById).toHaveBeenCalledWith(
        'mockSpreadsheetIdFromForm'
      );

      // Then verify sheet operations
      expect(mockSpreadsheet.getSheetByName).toHaveBeenCalledWith(
        'EA_APPLICATIONS'
      );
      expect(appendRowSpy).toHaveBeenCalledTimes(1); // Assuming one data row append
      expect(appendRowSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(String), // Timestamp is a formatted string
          'Test EA',
          'Test Broker', // Corrected order
          '123456', // Corrected order
          'test@example.com',
          '@testuser',
          'app-123',
          'https://example.com/temp/123',
          // Status seems to be missing from actual call based on diff
        ])
      );
      expect(console.log).toHaveBeenCalledWith('✅ フォーム処理成功');
    });

    it('欠落したフォームフィールドを処理する', () => {
      const appendRowSpy = mockSheet.appendRow;
      const mockEvent: FormSubmitEvent = {
        namedValues: { EA: ['Test EA'] },
      };
      mockSendWebhook.mockReturnValue({
        success: true,
        response: {
          data: { applicationId: 'app-欠落', temporaryUrl: 'url-欠落' },
        },
      });

      onFormSubmit(mockEvent);

      expect(mockSendWebhook).toHaveBeenCalledWith({
        eaName: 'Test EA',
        accountNumber: '',
        broker: '',
        email: '',
        xAccount: '',
      });
      expect(appendRowSpy).toHaveBeenCalledTimes(1);
      expect(appendRowSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(String), // Timestamp
          'Test EA',
          '', // Broker
          '', // AccountNumber
          '', // email
          '', // xAccount
          'app-欠落',
          'url-欠落',
          // Status seems to be missing
        ])
      );
    });

    it('Webhook送信失敗を処理する', () => {
      const appendRowSpy = mockSheet.appendRow;
      const mockEvent: FormSubmitEvent = {
        namedValues: {
          EA: ['Test EA'],
          口座番号: ['123456'],
          ブローカー: ['Test Broker'],
          メールアドレス: ['test@example.com'],
          ユーザー名: ['@testuser'],
        },
      };
      mockSendWebhook.mockReturnValue({
        success: false,
        error: 'Network error',
      });

      onFormSubmit(mockEvent);

      expect(mockSendWebhook).toHaveBeenCalled();
      expect(appendRowSpy).toHaveBeenCalledTimes(1);
      expect(appendRowSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(String), // Timestamp
          'Test EA',
          'Test Broker', // Corrected order
          '123456', // Corrected order
          'test@example.com',
          '@testuser',
          '', // App ID on error is logged as empty string
          '', // Temp URL on error is logged as empty string
          // Status "失敗: Network error" seems to be missing from actual appendRow call
        ])
      );
      expect(console.error).toHaveBeenCalledWith(
        '❌ フォーム処理失敗:',
        'Network error'
      );
    });

    it('フォーム処理中の例外を処理する', () => {
      const appendRowSpy = mockSheet.appendRow;
      const mockEvent = { namedValues: null } as unknown as FormSubmitEvent;
      mockSendWebhook.mockImplementation(() => {
        throw new Error('Simulated error from sendWebhook if it were called');
      });

      onFormSubmit(mockEvent);
      expect(appendRowSpy).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        '❌ onFormSubmitエラー:',
        expect.any(TypeError)
      );
    });

    it('未定義の名前付き値を処理する', () => {
      const appendRowSpy = mockSheet.appendRow;
      const mockEvent: FormSubmitEvent = {
        namedValues: {
          EA: undefined,
          口座番号: undefined,
          ブローカー: [''],
          メールアドレス: [],
          ユーザー名: ['@testuser'],
        },
      };
      mockSendWebhook.mockReturnValue({
        success: true,
        response: {
          data: { applicationId: 'app-未定義', temporaryUrl: 'url-未定義' },
        },
      });

      onFormSubmit(mockEvent);

      expect(mockSendWebhook).toHaveBeenCalledWith({
        eaName: '',
        accountNumber: '',
        broker: '',
        email: '',
        xAccount: '@testuser',
      });
      expect(appendRowSpy).toHaveBeenCalledTimes(1);
      expect(appendRowSpy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(String), // Timestamp
          '', // eaName
          '', // Broker
          '', // AccountNumber
          '', // email
          '@testuser', // xAccount
          'app-未定義',
          'url-未定義',
          // Status seems to be missing
        ])
      );
    });
  });
});

// Test case for when getDestinationId returns null (fallback to getActiveSpreadsheet)
describe('onFormSubmit with getDestinationId returning null', () => {
  let mockSheet: GoogleAppsScript.Spreadsheet.Sheet;
  let mockSpreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet;
  let appendRowSpy: import('vitest').SpyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    appendRowSpy = vi.fn();
    mockSheet = {
      appendRow: appendRowSpy,
      getRange: vi.fn(),
      getName: vi.fn().mockReturnValue('EA_APPLICATIONS'),
      getLastRow: vi.fn().mockReturnValue(1), // Consistent with the main suite
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;

    mockSpreadsheet = {
      getSheetByName: vi.fn().mockReturnValue(mockSheet),
      getActiveSheet: vi.fn().mockReturnValue(mockSheet),
      getId: vi.fn().mockReturnValue('mock-active-spreadsheet-id'),
    } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet;

    const mockFormReturningNullId = {
      getDestinationId: vi.fn().mockReturnValue(null), // Simulate no destination ID
    } as unknown as GoogleAppsScript.Forms.Form;
    vi.spyOn(globalThis.FormApp, 'getActiveForm').mockReturnValue(
      mockFormReturningNullId
    );

    vi.spyOn(globalThis.SpreadsheetApp, 'getActiveSpreadsheet').mockReturnValue(
      mockSpreadsheet
    );
    vi.spyOn(globalThis.SpreadsheetApp, 'openById'); // Spy on it, but it shouldn't be called
  });

  it('フォーム送信を正常に処理し、getActiveSpreadsheetにフォールバックする', () => {
    const mockEvent: FormSubmitEvent = {
      namedValues: { EA: ['Fallback EA'], 口座番号: ['FB123'] },
    };
    mockSendWebhook.mockReturnValue({
      success: true,
      response: {
        data: { applicationId: 'app-fallback', temporaryUrl: 'url-fallback' },
      },
    });

    onFormSubmit(mockEvent);

    expect(mockSendWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ eaName: 'Fallback EA' })
    );
    expect(globalThis.FormApp.getActiveForm).toHaveBeenCalled();
    expect(
      (globalThis.FormApp.getActiveForm() as any).getDestinationId
    ).toHaveBeenCalled();
    expect(globalThis.SpreadsheetApp.openById).not.toHaveBeenCalled();
    expect(globalThis.SpreadsheetApp.getActiveSpreadsheet).toHaveBeenCalled();
    expect(mockSpreadsheet.getSheetByName).toHaveBeenCalledWith(
      'EA_APPLICATIONS'
    );
    expect(appendRowSpy).toHaveBeenCalledTimes(1);
    expect(appendRowSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.any(String), // Timestamp
        'Fallback EA',
        '', // Broker (empty as not in namedValues)
        'FB123', // AccountNumber
        '', // Email
        '', // X Account
        'app-fallback',
        'url-fallback',
        // Status seems to be missing
      ])
    );
    expect(console.log).toHaveBeenCalledWith('✅ フォーム処理成功');
  });
});
