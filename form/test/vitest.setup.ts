import { vi } from 'vitest';
import type { Config } from '../src/types';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gas = require('gas-local');
import { vi } from 'vitest'; // Make sure vi is imported if not already
import type { Config } from '../src/types';

const gasGlobalMock = gas.globalMockDefault;

// config-valuesモジュールをモック
vi.mock('../src/config-values', () => ({
  CONFIG: {
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
  },
}));

// Assign available GAS global objects from gasGlobalMock
globalThis.Logger = gasGlobalMock.Logger || {
  log: vi.fn(),
  clear: vi.fn(),
  getLog: vi.fn(),
};

// Create a comprehensive Utilities mock.
// Start with a base set of mocks for all known used Utilities functions.
const comprehensiveUtilities = {
  formatString: vi.fn((format, ...args) => {
    // Basic pass-through for testing
    let i = 0;
    return format.replace(/%s/g, () => String(args[i++]));
  }),
  formatDate: vi.fn((date, timeZone, format) => {
    // Basic pass-through for testing
    // This is a simplified mock. Real formatDate is complex.
    // For tests, often just checking it was called is enough, or a predictable string.
    // Example: return date.toISOString() + ` (${timeZone} to ${format})`;
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    // Basic format, can be expanded if specific format strings are tested
    if (format === 'yyyy/MM/dd HH:mm:ss') {
      return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
    }
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`; // Default to ISO-like
  }),
  sleep: vi.fn(_milliseconds => {
    /* no-op for tests */
  }), // Prefixed unused parameter
  base64Encode: vi.fn(
    (data: string | number[] | Uint8Array, _charset?: string): string => {
      // Typed _charset, prefixed
      const toEncode =
        typeof data === 'string'
          ? Buffer.from(data)
          : Buffer.from(data as Uint8Array);
      return toEncode.toString('base64');
    }
  ),
  base64Decode: vi
    .fn()
    .mockImplementation((encoded: string, _charset?: string): number[] => {
      // Typed _charset, prefixed
      return Array.from(Buffer.from(encoded, 'base64'));
    }),
  computeHmacSha256Signature: vi.fn(
    (value: string, key: string | number[] | Uint8Array): number[] => {
      // console.log('Mock computeHmacSha256Signature called'); // For debugging
      // Return a fixed, known-length array for predictability if needed, or random for basic check
      const signature = new Uint8Array(32); // 32 bytes for SHA256
      for (let i = 0; i < signature.length; i++) {
        signature[i] = i; // Fill with some predictable data
      }
      return Array.from(signature);
    }
  ),
  newBlob: vi.fn(
    (
      data: string | number[] | Uint8Array | GoogleAppsScript.Base.BlobSource,
      contentType?: string,
      name?: string
    ) => {
      let bytes: Uint8Array;
      let resolvedContentType = contentType || 'text/plain';
      let resolvedName = name || 'blob';

      if (typeof data === 'string') {
        bytes = new TextEncoder().encode(data);
      } else if (Array.isArray(data)) {
        bytes = Uint8Array.from(data);
      } else if (data instanceof Uint8Array) {
        bytes = data;
      } else {
        // BlobSource
        bytes = Uint8Array.from(data.getBytes()); // BlobSource must have getBytes()
        resolvedContentType = data.getContentType() || resolvedContentType;
        resolvedName = data.getName() || resolvedName;
      }
      return {
        getBytes: () => Array.from(bytes), // Return as number[] for some contexts
        getDataAsString: (charset?: string) =>
          new TextDecoder(charset).decode(bytes), // Handle charset
        getContentType: () => resolvedContentType,
        getName: () => resolvedName,
        isGoogleType: () => false, // Example
        getAs: vi.fn(function (contentType) {
          // mock getAs
          if (contentType === this.getContentType()) return this;
          throw new Error(`Mock Blob: Cannot convert to ${contentType}`);
        }),
        copyBlob: vi.fn(function () {
          return this;
        }), // mock copyBlob
        // ... other blob methods
      };
    }
  ),
};

// Merge with gasGlobalMock.Utilities, ensuring comprehensiveUtilities takes precedence for defined methods.
globalThis.Utilities = {
  ...(gasGlobalMock.Utilities || {}), // gas-local's defaults (sleep, formatDate, formatString might be here)
  ...comprehensiveUtilities, // Our more complete/specific mocks override and add
};

// Define mocks for services not provided by gasGlobalMock.globalMockDefault
// These will be the base objects that tests can then spyOn and mockImplementations for.
// These will be the base objects that tests can then spyOn and mockImplementations for.
globalThis.UrlFetchApp = {
  fetch: vi.fn(),
  fetchAll: vi.fn(),
  getRequest: vi.fn(),
};

const mockSheet = {
  appendRow: vi.fn(),
  getRange: vi.fn(),
  getName: vi.fn().mockReturnValue('MockSheet'),
  // Add other commonly used Sheet methods as needed, mocked with vi.fn()
};

const mockSpreadsheet = {
  getSheetByName: vi.fn().mockReturnValue(mockSheet),
  getActiveSheet: vi.fn().mockReturnValue(mockSheet),
  getSheets: vi.fn().mockReturnValue([mockSheet]),
  getId: vi.fn().mockReturnValue('mock-spreadsheet-id'),
  // Add other commonly used Spreadsheet methods
};

globalThis.SpreadsheetApp = {
  getActiveSpreadsheet: vi.fn().mockReturnValue(mockSpreadsheet),
  openById: vi.fn().mockReturnValue(mockSpreadsheet),
  create: vi.fn().mockReturnValue(mockSpreadsheet),
  // Add other SpreadsheetApp static methods
};

globalThis.PropertiesService = {
  getDocumentProperties: vi.fn(() => ({
    getProperty: vi.fn(),
    setProperty: vi.fn(),
    getProperties: vi.fn(),
    deleteAllProperties: vi.fn(),
    deleteProperty: vi.fn(),
  })),
  getUserProperties: vi.fn(() => ({
    getProperty: vi.fn(),
    setProperty: vi.fn(),
    getProperties: vi.fn(),
    deleteAllProperties: vi.fn(),
    deleteProperty: vi.fn(),
  })),
  getScriptProperties: vi.fn(() => ({
    getProperty: vi.fn(),
    setProperty: vi.fn(),
    getProperties: vi.fn(),
    deleteAllProperties: vi.fn(),
    deleteProperty: vi.fn(),
  })),
};

globalThis.Session = {
  getActiveUser: vi.fn(() => ({
    getEmail: vi.fn().mockReturnValue('user@example.com'),
  })),
  getEffectiveUser: vi.fn(() => ({
    getEmail: vi.fn().mockReturnValue('effective.user@example.com'),
  })),
  getScriptTimeZone: vi.fn().mockReturnValue('UTC'),
  // ... other Session methods
};

globalThis.ScriptApp = {
  getOAuthToken: vi.fn().mockReturnValue('mock-oauth-token'),
  getScriptId: vi.fn().mockReturnValue('mock-script-id'),
  newTrigger: vi.fn().mockReturnThis(),
  forSpreadsheet: vi.fn().mockReturnThis(),
  onFormSubmit: vi.fn().mockReturnThis(),
  create: vi.fn().mockReturnThis(),
  // Add Enums used in the application/tests
  AuthMode: {
    NONE: 'NONE' as GoogleAppsScript.Script.AuthMode,
    LIMITED: 'LIMITED' as GoogleAppsScript.Script.AuthMode,
    FULL: 'FULL' as GoogleAppsScript.Script.AuthMode,
  },
  EventType: {
    // Example, add if used
    ON_FORM_SUBMIT: 'ON_FORM_SUBMIT',
    ON_OPEN: 'ON_OPEN',
    // ...
  },
  // ... other ScriptApp methods and enums
} as unknown as typeof ScriptApp;

globalThis.FormApp = {
  getActiveForm: vi.fn(() => ({
    getId: vi.fn().mockReturnValue('mock-form-id'),
    getDestinationId: vi.fn().mockReturnValue(null), // Default for tests
    // Add other Form methods if needed by index.ts or its direct imports for global functions
  })),
  // ... other FormApp methods
};

globalThis.ContentService = {
  createTextOutput: vi.fn(text => {
    // Store mimeType locally for this instance of TextOutput
    let currentMimeType: GoogleAppsScript.Content.MimeType =
      globalThis.ContentService.MimeType.TEXT; // Default

    const textOutputInstance = {
      getContent: () => text,
      setMimeType: vi.fn((mimeType: GoogleAppsScript.Content.MimeType) => {
        currentMimeType = mimeType;
        return textOutputInstance; // Return the object itself for chaining
      }),
      getMimeType: vi.fn(() => currentMimeType), // Added getMimeType
      // Mock other TextOutput methods if necessary
      // append: vi.fn(), clear: vi.fn(), downloadAsFile: vi.fn(), getBytes: vi.fn() etc.
    };
    return textOutputInstance;
  }),
  MimeType: {
    // Global MimeType (ensure this is complete for what's used)
    JSON: 'application/json' as GoogleAppsScript.Content.MimeType,
    TEXT: 'text/plain' as GoogleAppsScript.Content.MimeType,
    ATOM: 'ATOM' as GoogleAppsScript.Content.MimeType, // Add as needed
    CSV: 'CSV' as GoogleAppsScript.Content.MimeType,
    ICAL: 'ICAL' as GoogleAppsScript.Content.MimeType,
    JAVASCRIPT: 'JAVASCRIPT' as GoogleAppsScript.Content.MimeType,
    RSS: 'RSS' as GoogleAppsScript.Content.MimeType,
    VCARD: 'VCARD' as GoogleAppsScript.Content.MimeType,
    XML: 'XML' as GoogleAppsScript.Content.MimeType,
  },
};

// デフォルトのCONFIG設定
(globalThis as { CONFIG?: Config }).CONFIG = {
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
