import { Config } from '../src/config';

// config-valuesモジュールをモック
jest.mock('../src/config-values', () => ({
  CONFIG: {
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
  }
}));

// デフォルトのCONFIG設定
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
} as Config;

// テスト環境のセットアップ
export {};
