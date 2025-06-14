import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
// Import functions to be tested from setup-environment.js if needed directly
import { validateEnvironmentVariables, getOrCreateAuthSecret } from '../setup-environment-logic.js';
// For example:
// import { validateEnvironmentVariables, getOrCreateAuthSecret } from '../setup-environment.js';
import { log } from '../core/utils.js'; // Ensure log is imported for spying on its methods
import { ENVIRONMENTS } from '../core/constants.js'; // For ENVIRONMENTS.DEV / ENVIRONMENTS.PROD
// Import mocks from services/vercel.js (already mocked in the boilerplate)
import { readAuthSecretFromEnvLocal, getExistingAuthSecret, generateAuthSecret } from '../services/vercel.js';

// Mocking core/utils.js as it's heavily used and contains console logs / prompts
vi.mock('../core/utils.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    log: {
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      progress: vi.fn(),
      search: vi.fn(),
      generate: vi.fn(),
      database: vi.fn(),
      complete: vi.fn(),
      user: vi.fn(),
      email: vi.fn(),
    },
    // Add mocks for other utility functions like displayTitle, confirm, prompt etc. if they are directly called
    // or if their side-effects need to be controlled.
  };
});

// Mocking services/vercel.js for getOrCreateAuthSecret tests
vi.mock('../services/vercel.js', () => ({
  readAuthSecretFromEnvLocal: vi.fn(),
  getExistingAuthSecret: vi.fn(),
  generateAuthSecret: vi.fn(),
  // Add other functions if they are called and need mocking
}));


describe('setup-environment.js', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original process.env
    originalEnv = { ...process.env };
    // Reset mocks before each test
    vi.resetAllMocks();
  });

  afterEach(() => {
    // Restore original process.env
    process.env = originalEnv;
  });

  describe('validateEnvironmentVariables', () => {
    // Spy on console.log as it's used by log.warning for specific formatting
    let consoleLogSpy;

    beforeEach(() => {
      // Reset spies and environment variables
      // log.warning is already a vi.fn() due to the vi.mock setup, so direct spying might be redundant
      // or ensure it's spied if the mock isn't directly usable for assertion counts at this scope
      // For simplicity, if log.warning from mock is sufficient, direct spy can be removed.
      // vi.spyOn(log, 'warning'); // Let's rely on the mock from vi.mock

      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); // Mock implementation to silence actual console output during tests

      // Default: all required env vars are set
      process.env.CLOUDFLARE_API_TOKEN = 'test_cf_api_token';
      process.env.CLOUDFLARE_ZONE_ID = 'test_cf_zone_id';
      process.env.VERCEL_TOKEN = 'test_vercel_token';
      process.env.VERCEL_PROJECT_ID = 'test_vercel_project_id';
      process.env.VERCEL_DEPLOY_HOOK_DEV = 'test_dev_hook';
      process.env.VERCEL_DEPLOY_HOOK_PROD = 'test_prod_hook';
    });

    afterEach(() => {
      consoleLogSpy.mockRestore(); // Restore console.log
    });

    test('should not call log.warning if all required environment variables are set', () => {
      validateEnvironmentVariables();
      expect(log.warning).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('⚠️'));
    });

    test('should call log.warning for missing CLOUDFLARE_API_TOKEN', () => {
      delete process.env.CLOUDFLARE_API_TOKEN;
      validateEnvironmentVariables();
      expect(log.warning).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('CLOUDFLARE_API_TOKEN'));
    });

    test('should call log.warning for missing CLOUDFLARE_ZONE_ID', () => {
      delete process.env.CLOUDFLARE_ZONE_ID;
      validateEnvironmentVariables();
      expect(log.warning).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('CLOUDFLARE_ZONE_ID'));
    });

    test('should call log.warning for missing VERCEL_TOKEN', () => {
      delete process.env.VERCEL_TOKEN;
      validateEnvironmentVariables();
      expect(log.warning).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('VERCEL_TOKEN'));
    });

    test('should call log.warning for missing VERCEL_PROJECT_ID', () => {
      delete process.env.VERCEL_PROJECT_ID;
      validateEnvironmentVariables();
      expect(log.warning).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('VERCEL_PROJECT_ID'));
    });

    test('should call log.warning for missing VERCEL_DEPLOY_HOOK_DEV', () => {
      delete process.env.VERCEL_DEPLOY_HOOK_DEV;
      validateEnvironmentVariables();
      expect(log.warning).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('VERCEL_DEPLOY_HOOK_DEV'));
    });

    test('should call log.warning for missing VERCEL_DEPLOY_HOOK_PROD', () => {
      delete process.env.VERCEL_DEPLOY_HOOK_PROD;
      validateEnvironmentVariables();
      expect(log.warning).toHaveBeenCalledOnce();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('VERCEL_DEPLOY_HOOK_PROD'));
    });

    test('should call log.warning multiple times for multiple missing environment variables', () => {
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.VERCEL_TOKEN;
      delete process.env.VERCEL_PROJECT_ID;

      validateEnvironmentVariables();

      // log.warning is called once to print "Missing environment variables:"
      expect(log.warning).toHaveBeenCalledOnce();

      // console.log is called for each missing variable warning line
      // The function itself calls log.warning once, then console.log for each warning.
      // So, 1 header line by log.warning (which might use console.log internally or not, depending on mock)
      // + 3 individual warnings via console.log directly from validateEnvironmentVariables
      // The current mock of log.warning doesn't call console.log itself.
      // The validateEnvironmentVariables function calls:
      // log.warning('Missing environment variables:');
      // warnings.forEach(warning => console.log(`   ⚠️  ${warning}`));
      // console.log('\n   Please set these in your .env file to enable all features.\n');
      // So consoleLogSpy should be called 3 times for warnings + 1 time for the footer.
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('CLOUDFLARE_API_TOKEN'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('VERCEL_TOKEN'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('VERCEL_PROJECT_ID'));
      // Total calls to console.log by the function: number of warnings + 1 footer.
      expect(consoleLogSpy).toHaveBeenCalledTimes(3 + 1);
    });
  });

  describe('getOrCreateAuthSecret', () => {
    const mockEnvFilePath = '/fake/path/.env.local';
    const mockVercelConfig = { apiToken: 'test_vercel_api_token', projectId: 'test_vercel_project_id' };
    const mockGeneratedSecret = 'newly_generated_secret';
    const mockEnvLocalSecret = 'secret_from_env_local';
    const mockVercelSecret = 'secret_from_vercel';

    beforeEach(() => {
      // Reset mocks for vercel service functions
      readAuthSecretFromEnvLocal.mockReset();
      getExistingAuthSecret.mockReset();
      generateAuthSecret.mockReset();
      // log.debug is already a vi.fn() due to the main mock of core/utils.js
      // If we need to spy on it specifically for a test, ensure it's reset or use vi.spyOn(log, 'debug');
      // For now, relying on vi.resetAllMocks() in the outer describe's beforeEach.
      generateAuthSecret.mockReturnValue(mockGeneratedSecret); // Default mock behavior
    });

    test('should return secret from .env.local if env is DEV and secret exists', async () => {
      readAuthSecretFromEnvLocal.mockResolvedValue(mockEnvLocalSecret);
      const secret = await getOrCreateAuthSecret(ENVIRONMENTS.DEV, mockEnvFilePath, mockVercelConfig);
      expect(secret).toBe(mockEnvLocalSecret);
      expect(readAuthSecretFromEnvLocal).toHaveBeenCalledWith(mockEnvFilePath);
      expect(getExistingAuthSecret).not.toHaveBeenCalled();
      expect(generateAuthSecret).not.toHaveBeenCalled();
      expect(log.debug).toHaveBeenCalledWith('AUTH_SECRET found in .env.local', { debug: true });
    });

    test('should return secret from Vercel if env is DEV and not in .env.local', async () => {
      readAuthSecretFromEnvLocal.mockResolvedValue(null);
      getExistingAuthSecret.mockResolvedValue(mockVercelSecret);
      const secret = await getOrCreateAuthSecret(ENVIRONMENTS.DEV, mockEnvFilePath, mockVercelConfig);
      expect(secret).toBe(mockVercelSecret);
      expect(readAuthSecretFromEnvLocal).toHaveBeenCalledWith(mockEnvFilePath);
      expect(getExistingAuthSecret).toHaveBeenCalledWith(mockVercelConfig.apiToken, mockVercelConfig.projectId);
      expect(generateAuthSecret).not.toHaveBeenCalled();
      expect(log.debug).toHaveBeenCalledWith('AUTH_SECRET found in Vercel environment variables', { debug: true });
    });

    test('should generate new secret if env is DEV and not in .env.local or Vercel', async () => {
      readAuthSecretFromEnvLocal.mockResolvedValue(null);
      getExistingAuthSecret.mockResolvedValue(null);
      const secret = await getOrCreateAuthSecret(ENVIRONMENTS.DEV, mockEnvFilePath, mockVercelConfig);
      expect(secret).toBe(mockGeneratedSecret);
      expect(readAuthSecretFromEnvLocal).toHaveBeenCalledWith(mockEnvFilePath);
      expect(getExistingAuthSecret).toHaveBeenCalledWith(mockVercelConfig.apiToken, mockVercelConfig.projectId);
      expect(generateAuthSecret).toHaveBeenCalledOnce();
      expect(log.info).toHaveBeenCalledWith('Generated new AUTH_SECRET');
    });

    test('should return secret from Vercel if env is PROD (does not check .env.local)', async () => {
      getExistingAuthSecret.mockResolvedValue(mockVercelSecret);
      const secret = await getOrCreateAuthSecret(ENVIRONMENTS.PROD, mockEnvFilePath, mockVercelConfig);
      expect(secret).toBe(mockVercelSecret);
      expect(readAuthSecretFromEnvLocal).not.toHaveBeenCalled();
      expect(getExistingAuthSecret).toHaveBeenCalledWith(mockVercelConfig.apiToken, mockVercelConfig.projectId);
      expect(generateAuthSecret).not.toHaveBeenCalled();
    });

    test('should generate new secret if env is PROD and not in Vercel', async () => {
      getExistingAuthSecret.mockResolvedValue(null);
      const secret = await getOrCreateAuthSecret(ENVIRONMENTS.PROD, mockEnvFilePath, mockVercelConfig);
      expect(secret).toBe(mockGeneratedSecret);
      expect(readAuthSecretFromEnvLocal).not.toHaveBeenCalled();
      expect(getExistingAuthSecret).toHaveBeenCalledWith(mockVercelConfig.apiToken, mockVercelConfig.projectId);
      expect(generateAuthSecret).toHaveBeenCalledOnce();
      expect(log.info).toHaveBeenCalledWith('Generated new AUTH_SECRET');
    });

    test('should generate new secret if Vercel config is not provided', async () => {
      readAuthSecretFromEnvLocal.mockResolvedValue(null); // For DEV case
      const secret = await getOrCreateAuthSecret(ENVIRONMENTS.DEV, mockEnvFilePath, null);
      expect(secret).toBe(mockGeneratedSecret);
      expect(getExistingAuthSecret).not.toHaveBeenCalled();
      expect(generateAuthSecret).toHaveBeenCalledOnce();
    });

    test('should handle Vercel API error gracefully and generate new secret', async () => {
      readAuthSecretFromEnvLocal.mockResolvedValue(null);
      getExistingAuthSecret.mockRejectedValue(new Error('Vercel API Error'));
      const secret = await getOrCreateAuthSecret(ENVIRONMENTS.DEV, mockEnvFilePath, mockVercelConfig);
      expect(secret).toBe(mockGeneratedSecret);
      expect(generateAuthSecret).toHaveBeenCalledOnce();
      expect(log.debug).toHaveBeenCalledWith('Failed to get AUTH_SECRET from Vercel: Vercel API Error', { debug: true });
    });
  });
});
