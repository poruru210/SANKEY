import { Config } from './types';

/**
 * ============================================
 * 設定セクション(ここを編集してください)
 * ============================================
 */
export const CONFIG: Config = {
  WEBHOOK_URL: 'https://api-dev.sankey.trade/applications/webhook',
  TEST_NOTIFICATION_URL:
    'https://api-dev.sankey.trade/integration/test/gas-connection',
  RESULT_NOTIFICATION_URL:
    'https://api-dev.sankey.trade/integration/result/notification',
  USER_ID: '57f45a18-8041-701c-90fe-8085763ffea1',
  JWT_SECRET: 'LYuaIQTxttljKvZral2gOH4fss7zBFihBj9Q0MfhXdQ=',

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
