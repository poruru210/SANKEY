import { onFormSubmit as formSubmitHandler } from './form-handler';
import { doPost as doPostHandler } from './webapp';
import { testConnection as testConnectionHandler, triggerIntegrationTest as triggerIntegrationTestHandler } from './integration';
import { validateConfig as validateConfigHandler } from './config-manager';

// エクスポート（TypeScript用）
export {
  formSubmitHandler as onFormSubmit,
  doPostHandler as doPost,
  testConnectionHandler as testConnection,
  triggerIntegrationTestHandler as triggerIntegrationTest,
  validateConfigHandler as validateConfig
};

// グローバル関数として公開（GAS用）
(global as any).onFormSubmit = formSubmitHandler;
(global as any).doPost = doPostHandler;
(global as any).testConnection = testConnectionHandler;
(global as any).triggerIntegrationTest = triggerIntegrationTestHandler;
(global as any).validateConfig = validateConfigHandler;
