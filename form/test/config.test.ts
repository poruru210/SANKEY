import { Config } from '../src/config';
import { validateConfig, getConfig } from '../src/config-manager';

// テスト環境では実際の値を持つ設定を使用
jest.mock('../src/config-values', () => ({
  CONFIG: {
    WEBHOOK_URL: 'https://example.com/webhook',
    TEST_NOTIFICATION_URL: 'https://example.com/test',
    RESULT_NOTIFICATION_URL: 'https://example.com/result',
    USER_ID: 'test-user-id',
    JWT_SECRET: 'test-jwt-secret',
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
  }
}));

const mockConfigValues = require('../src/config-values');

describe('Config Validation', () => {
  let originalConfig: Config;

  beforeEach(() => {
    // 元の設定を保存
    originalConfig = { ...mockConfigValues.CONFIG };
  });

  afterEach(() => {
    // 設定を元に戻す
    mockConfigValues.CONFIG = originalConfig;
  });

  test('should return true for valid config', () => {
    expect(validateConfig()).toBe(true);
  });

  test('should return false for invalid WEBHOOK_URL', () => {
    mockConfigValues.CONFIG = {
      ...originalConfig,
      WEBHOOK_URL: 'your-api-endpoint'
    };

    expect(validateConfig()).toBe(false);
  });

  test('should return false for empty WEBHOOK_URL', () => {
    mockConfigValues.CONFIG = {
      ...originalConfig,
      WEBHOOK_URL: ''
    };

    expect(validateConfig()).toBe(false);
  });

  test('should return false for invalid USER_ID', () => {
    mockConfigValues.CONFIG = {
      ...originalConfig,
      USER_ID: 'xxxx-xxxx-xxxx'
    };

    expect(validateConfig()).toBe(false);
  });

  test('should return false for invalid JWT_SECRET', () => {
    mockConfigValues.CONFIG = {
      ...originalConfig,
      JWT_SECRET: 'your-jwt-secret'
    };

    expect(validateConfig()).toBe(false);
  });

  test('should return false for multiple invalid fields', () => {
    mockConfigValues.CONFIG = {
      ...originalConfig,
      WEBHOOK_URL: '',
      USER_ID: 'xxxx',
      JWT_SECRET: 'your-secret'
    };

    expect(validateConfig()).toBe(false);
  });
});

describe('Config Manager', () => {
  test('should return config object', () => {
    const config = getConfig();
    expect(config).toBeDefined();
    expect(config).toHaveProperty('WEBHOOK_URL');
    expect(config).toHaveProperty('USER_ID');
    expect(config).toHaveProperty('JWT_SECRET');
    expect(config).toHaveProperty('FORM_FIELDS');
  });

  test('should have correct form field structure', () => {
    const config = getConfig();
    expect(config.FORM_FIELDS).toHaveProperty('EA_NAME');
    expect(config.FORM_FIELDS).toHaveProperty('ACCOUNT_NUMBER');
    expect(config.FORM_FIELDS).toHaveProperty('BROKER');
    expect(config.FORM_FIELDS).toHaveProperty('EMAIL');
    expect(config.FORM_FIELDS).toHaveProperty('X_ACCOUNT');
  });

  test('should have correct form field properties', () => {
    const config = getConfig();

    // EA_NAMEフィールドの検証
    expect(config.FORM_FIELDS.EA_NAME).toHaveProperty('label');
    expect(config.FORM_FIELDS.EA_NAME).toHaveProperty('type');
    expect(config.FORM_FIELDS.EA_NAME).toHaveProperty('required');
    expect(config.FORM_FIELDS.EA_NAME.type).toBe('select');

    // ACCOUNT_NUMBERフィールドの検証
    expect(config.FORM_FIELDS.ACCOUNT_NUMBER).toHaveProperty('validation');
    expect(config.FORM_FIELDS.ACCOUNT_NUMBER.validation).toBe('number');

    // EMAILフィールドの検証
    expect(config.FORM_FIELDS.EMAIL.validation).toBe('email');
  });
});
