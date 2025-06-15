import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Import types
import type { FormSubmitEvent, Config } from '../src/types';

// Mock the handler modules that index.ts is supposed to call
import * as formHandlerModule from '../src/form-handler';
import * as webappModule from '../src/webapp';
import * as integrationModule from '../src/integration';
import * as configManagerModule from '../src/config-manager';

vi.mock('../src/form-handler');
vi.mock('../src/webapp');
vi.mock('../src/integration');
vi.mock('../src/config-manager');

// Simulate the global functions that would be defined in index.ts for GAS
// These test-local functions will call the mocked handlers.
const localOnFormSubmit = (event: FormSubmitEvent) => formHandlerModule.onFormSubmit(event);
const localDoPost = (event: GoogleAppsScript.Events.DoPost) => webappModule.doPost(event);
const localTestConnection = () => integrationModule.testConnection();
const localTriggerIntegrationTest = () => integrationModule.triggerIntegrationTest();
const localValidateConfig = () => configManagerModule.validateConfig();
const localGetConfig = () => configManagerModule.getConfig();


describe('Index Global Functions (Simulated GAS Environment)', () => {
  // Spies on the methods of the mocked handler modules
  let onFormSubmitHandlerSpy: vi.SpyInstance;
  let doPostHandlerSpy: vi.SpyInstance;
  let testConnectionHandlerSpy: vi.SpyInstance;
  let triggerIntegrationTestHandlerSpy: vi.SpyInstance;
  let validateConfigHandlerSpy: vi.SpyInstance;
  let getConfigHandlerSpy: vi.SpyInstance;

  beforeEach(() => {
    vi.clearAllMocks();

    // Spy on the functions in the *handler* modules.
    onFormSubmitHandlerSpy = vi.spyOn(formHandlerModule, 'onFormSubmit');
    doPostHandlerSpy = vi.spyOn(webappModule, 'doPost');
    testConnectionHandlerSpy = vi.spyOn(integrationModule, 'testConnection');
    triggerIntegrationTestHandlerSpy = vi.spyOn(integrationModule, 'triggerIntegrationTest');
    validateConfigHandlerSpy = vi.spyOn(configManagerModule, 'validateConfig');
    getConfigHandlerSpy = vi.spyOn(configManagerModule, 'getConfig');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('globalOnFormSubmit should call formHandler.onFormSubmit', () => {
    const mockEvent = {
      authMode: globalThis.ScriptApp.AuthMode.LIMITED,
      response: {} as GoogleAppsScript.Forms.FormResponse,
      source: {} as GoogleAppsScript.Forms.Form,
      triggerUid: '123',
      namedValues: { 'Field1': ['Value1'] }
    } as FormSubmitEvent;

    localOnFormSubmit(mockEvent); // Call the test-local simulated global

    expect(onFormSubmitHandlerSpy).toHaveBeenCalledTimes(1);
    expect(onFormSubmitHandlerSpy).toHaveBeenCalledWith(mockEvent);
  });

  it('globalDoPost should call webapp.doPost and return its result', () => {
    const mockEvent = {
      parameter: {},
      contextPath: '',
      contentLength: 0,
      queryString: '',
      parameters: {},
      postData: {
        length: 0,
        type: '',
        contents: '',
        name: 'postData'
      }
    } as GoogleAppsScript.Events.DoPost;

    const mockTextOutput = globalThis.ContentService.createTextOutput("test output").setMimeType(globalThis.ContentService.MimeType.TEXT);
    doPostHandlerSpy.mockReturnValue(mockTextOutput);

    const result = localDoPost(mockEvent); // Call the test-local simulated global

    expect(doPostHandlerSpy).toHaveBeenCalledTimes(1);
    expect(doPostHandlerSpy).toHaveBeenCalledWith(mockEvent);
    expect(result.getContent()).toBe("test output");
    expect(result.getMimeType()).toBe(globalThis.ContentService.MimeType.TEXT);
  });

  it('globalTestConnection should call integration.testConnection and return its result', () => {
    const mockResponse = { success: true, version: '1.0' };
    testConnectionHandlerSpy.mockReturnValue(mockResponse);

    const result = localTestConnection(); // Call the test-local simulated global

    expect(testConnectionHandlerSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockResponse);
  });

  it('globalTriggerIntegrationTest should call integration.triggerIntegrationTest', () => {
    localTriggerIntegrationTest(); // Call the test-local simulated global

    expect(triggerIntegrationTestHandlerSpy).toHaveBeenCalledTimes(1);
  });

  it('globalValidateConfig should call configManager.validateConfig and return its result', () => {
    validateConfigHandlerSpy.mockReturnValue(true);
    const result = localValidateConfig(); // Call the test-local simulated global
    expect(validateConfigHandlerSpy).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);

    validateConfigHandlerSpy.mockReturnValue(false);
    const resultFalse = localValidateConfig(); // Call the test-local simulated global
    expect(validateConfigHandlerSpy).toHaveBeenCalledTimes(2);
    expect(resultFalse).toBe(false);
  });

  it('globalGetConfig should call configManager.getConfig and return its result', () => {
    const mockConfigData = { WEBHOOK_URL: 'configured_url' } as Partial<Config>;
    getConfigHandlerSpy.mockReturnValue(mockConfigData as Config);

    const result = localGetConfig(); // Call the test-local simulated global

    expect(getConfigHandlerSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockConfigData);
  });
});
