import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateConfig, getConfig } from '../src/config-manager';
import type { Config } from '../src/types';

// モックされた設定の型
interface MockedConfigModule {
  CONFIG: Config;
}

// vi.mockは巻き上げられるため、ファイルのトップレベルで定義
vi.mock('../src/config-values', () => ({
  CONFIG: {
    WEBHOOK_URL: 'https://example.com/webhook',
    TEST_NOTIFICATION_URL: 'https://example.com/test',
    RESULT_NOTIFICATION_URL: 'https://example.com/result',
    USER_ID: 'test-user-id',
    JWT_SECRET: 'test-jwt-secret',
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

describe('設定の検証', () => {
  beforeEach(async () => {
    const mod = await vi.importMock<MockedConfigModule>('../src/config-values');
    // originalConfigを保存（各テストで元の値を参照するため）
    JSON.parse(JSON.stringify(mod.CONFIG));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('有効な設定の場合はtrueを返す', () => {
    expect(validateConfig()).toBe(true);
  });

  it('無効なWEBHOOK_URLの場合はfalseを返す', async () => {
    const mod = await vi.importMock<MockedConfigModule>('../src/config-values');
    mod.CONFIG.WEBHOOK_URL = 'your-api-endpoint';

    vi.resetModules();
    const { validateConfig: validate } = await import('../src/config-manager');
    expect(validate()).toBe(false);
  });

  it('空のWEBHOOK_URLの場合はfalseを返す', async () => {
    const mod = await vi.importMock<MockedConfigModule>('../src/config-values');
    mod.CONFIG.WEBHOOK_URL = '';

    vi.resetModules();
    const { validateConfig: validate } = await import('../src/config-manager');
    expect(validate()).toBe(false);
  });

  it('無効なUSER_IDの場合はfalseを返す', async () => {
    const mod = await vi.importMock<MockedConfigModule>('../src/config-values');
    mod.CONFIG.USER_ID = 'xxxx-xxxx-xxxx';

    vi.resetModules();
    const { validateConfig: validate } = await import('../src/config-manager');
    expect(validate()).toBe(false);
  });

  it('無効なJWT_SECRETの場合はfalseを返す', async () => {
    const mod = await vi.importMock<MockedConfigModule>('../src/config-values');
    mod.CONFIG.JWT_SECRET = 'your-jwt-secret';

    vi.resetModules();
    const { validateConfig: validate } = await import('../src/config-manager');
    expect(validate()).toBe(false);
  });

  it('複数の無効なフィールドがある場合はfalseを返す', async () => {
    const mod = await vi.importMock<MockedConfigModule>('../src/config-values');
    mod.CONFIG.WEBHOOK_URL = '';
    mod.CONFIG.USER_ID = 'xxxx';
    mod.CONFIG.JWT_SECRET = 'your-secret';

    vi.resetModules();
    const { validateConfig: validate } = await import('../src/config-manager');
    expect(validate()).toBe(false);
  });
});

describe('設定マネージャー', () => {
  it('設定オブジェクトを返す', () => {
    const config = getConfig();
    expect(config).toBeDefined();
    expect(config).toHaveProperty('WEBHOOK_URL');
    expect(config).toHaveProperty('USER_ID');
    expect(config).toHaveProperty('JWT_SECRET');
    expect(config).toHaveProperty('FORM_FIELDS');
  });

  it('正しいフォームフィールド構造を持つ', () => {
    const config = getConfig();
    expect(config.FORM_FIELDS).toHaveProperty('EA_NAME');
    expect(config.FORM_FIELDS).toHaveProperty('ACCOUNT_NUMBER');
    expect(config.FORM_FIELDS).toHaveProperty('BROKER');
    expect(config.FORM_FIELDS).toHaveProperty('EMAIL');
    expect(config.FORM_FIELDS).toHaveProperty('X_ACCOUNT');
  });

  it('正しいフォームフィールドプロパティを持つ', () => {
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
