import { FormSubmitEvent } from './types';
import { onFormSubmit as formSubmitHandler } from './form-handler';
import { doPost as doPostHandler } from './webapp';
import {
  testConnection as testConnectionHandler,
  triggerIntegrationTest as triggerIntegrationTestHandler,
} from './integration';
import { validateConfig as validateConfigHandler } from './config-manager';

// GAS用のトップレベル関数定義
// これらの関数はGASによって自動的にグローバルスコープで利用可能になります

function onFormSubmit(e: FormSubmitEvent): void {
  return formSubmitHandler(e);
}

function doPost(
  e: GoogleAppsScript.Events.DoPost
): GoogleAppsScript.Content.TextOutput {
  return doPostHandler(e);
}

function testConnection(): unknown {
  return testConnectionHandler();
}

function triggerIntegrationTest(testId: string): unknown {
  return triggerIntegrationTestHandler(testId);
}

function validateConfig(): boolean {
  return validateConfigHandler();
}
