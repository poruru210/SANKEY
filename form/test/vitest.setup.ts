import { vi } from 'vitest';
import type { Config } from '../src/types';

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
      X_ACCOUNT: {
        label: 'ユーザー名',
        type: 'text',
        required: true,
      },
    },
  },
}));

// GAS グローバルオブジェクトのモック
global.ScriptApp = {
  getScriptId: vi.fn().mockReturnValue('test-script-id'),
  newTrigger: vi.fn(),
  getService: vi.fn(),
} as unknown as typeof ScriptApp;

global.SpreadsheetApp = {
  create: vi.fn(),
  getActiveSpreadsheet: vi.fn(),
  openById: vi.fn(),
} as unknown as typeof SpreadsheetApp;

global.FormApp = {
  getActiveForm: vi.fn(),
  create: vi.fn(),
} as unknown as typeof FormApp;

global.UrlFetchApp = {
  fetch: vi.fn(),
} as unknown as typeof UrlFetchApp;

global.Utilities = {
  base64Encode: vi.fn((data: string | Uint8Array | number[]) => {
    if (typeof data === 'string') {
      return Buffer.from(data).toString('base64');
    }
    if (data instanceof Uint8Array) {
      return Buffer.from(data).toString('base64');
    }
    return Buffer.from(new Uint8Array(data)).toString('base64');
  }),
  base64Decode: vi.fn((data: string) => {
    const buffer = Buffer.from(data, 'base64');
    return Array.from(buffer);
  }),
  newBlob: vi.fn((data: string) => ({
    getBytes: () => Array.from(new TextEncoder().encode(data)),
  })),
  computeHmacSha256Signature: vi.fn(() => {
    // 簡易的なモック実装
    return Array.from(new Uint8Array(32));
  }),
  sleep: vi.fn(),
} as unknown as typeof Utilities;

global.ContentService = {
  createTextOutput: vi.fn((content: string) => ({
    setMimeType: vi.fn().mockReturnThis(),
    getContent: () => content,
  })),
  MimeType: {
    JSON: 'application/json',
    TEXT: 'text/plain',
  },
} as unknown as typeof ContentService;

// デフォルトのCONFIG設定
// CONFIGの再宣言を避けるため、globalに直接設定
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
