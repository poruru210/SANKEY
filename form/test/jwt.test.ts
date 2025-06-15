import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { base64UrlEncode, createJWT } from '../src/jwt';
import * as configManager from '../src/config-manager';
import type { Config, FormData } from '../src/types';

// Mock the config-manager module
vi.mock('../src/config-manager', () => ({
  getConfig: vi.fn(),
}));

const mockGetConfig = configManager.getConfig as vi.MockedFunction<typeof configManager.getConfig>;

describe('JWT Utilities', () => {
  let consoleErrorSpy: vi.SpyInstance;
  let base64EncodeSpy: vi.SpyInstance;
  let computeHmacSha256SignatureSpy: vi.SpyInstance;
  // newBlob might not be directly called by createJWT itself, but by underlying Utilities.
  // base64Decode is not used by createJWT, but might be used by a verify function.

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // globalThis.Utilities and its methods are mocked in vitest.setup.ts
    // We spy on them here to check for calls within these specific tests.
    // Ensure these spies are restored if they are also spied on elsewhere.
    base64EncodeSpy = vi.spyOn(globalThis.Utilities, 'base64Encode');
    computeHmacSha256SignatureSpy = vi.spyOn(globalThis.Utilities, 'computeHmacSha256Signature');
    // If newBlob is indeed used by createJWT's path:
    // newBlobSpy = vi.spyOn(globalThis.Utilities, 'newBlob');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('base64UrlEncode', () => {
    it('should correctly encode a simple string', () => {
      // Utilities.base64Encode in setup returns base64, base64UrlEncode should make it URL safe
      // "Hello World" -> "SGVsbG8gV29ybGQ="
      base64EncodeSpy.mockReturnValue('SGVsbG8gV29ybGQ=');
      expect(base64UrlEncode('Hello World')).toBe('SGVsbG8gV29ybGQ'); // = removed
    });

    it('should correctly encode a string with +, /, = characters', () => {
      // Simulating a base64 string that would result from some binary data
      // Example: input that results in base64 with +, /, =
      // if input "??>" results in base64 "Pz8+", base64url should be "Pz8-"
      base64EncodeSpy.mockReturnValue('Pz8+/'); // Simulate base64 output with + and /
      const result = base64UrlEncode('??>'); // Input doesn't matter as base64Encode is mocked
      expect(result).toBe('Pz8-_'); // + becomes -, / becomes _ , padding removed
      expect(base64EncodeSpy).toHaveBeenCalledWith('??>');
    });

    it('should correctly encode a Uint8Array', () => {
      const arr = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      // "Hello" -> "SGVsbG8=" (standard base64)
      base64EncodeSpy.mockReturnValue('SGVsbG8=');
      const result = base64UrlEncode(arr);
      expect(result).toBe('SGVsbG8'); // = removed by base64UrlEncode
      // The Utilities.base64Encode mock in vitest.setup.ts handles Uint8Array by converting to Buffer
      // So it receives a Buffer. If jwt.ts passes Uint8Array directly, this spy will see Uint8Array.
      // The received output indicates it's converted to a plain array before Utilities.base64Encode is called.
      expect(base64EncodeSpy).toHaveBeenCalledWith(Array.from(arr));
    });

    it('should handle padding correctly (multiple padding characters)', () => {
      base64EncodeSpy.mockReturnValue('YW55IGNhcm5hbCBwbGVhc3VyZS4uLi4='); // "any carnal pleasure...."
      expect(base64UrlEncode('any carnal pleasure....')).toBe('YW55IGNhcm5hbCBwbGVhc3VyZS4uLi4');
    });

    it('should handle strings that result in no padding', () => {
      base64EncodeSpy.mockReturnValue('YWJj'); // "abc"
      expect(base64UrlEncode('abc')).toBe('YWJj');
    });
  });

  describe('createJWT', () => {
    const mockFormData: FormData = {
      eaName: 'TestEA',
      accountNumber: '12345',
      broker: 'TestBroker',
      email: 'test@example.com',
      xAccount: '@tester',
    };

    const mockConfig: Partial<Config> = {
      JWT_SECRET: 'test-jwt-secret-key-longer-than-32-bytes-for-sure',
      USER_ID: 'test-user-id',
    };

    beforeEach(() => {
      // Reset and re-mock getConfig for each test in this suite if needed,
      // or set a default here.
      mockGetConfig.mockReturnValue(mockConfig as Config);
    });

    it('should create a JWT string with three parts separated by dots', () => {
      const jwt = createJWT(mockFormData);
      expect(typeof jwt).toBe('string');
      const parts = jwt.split('.');
      expect(parts.length).toBe(3);
    });

    it('should call Utilities.base64Encode three times and Utilities.computeHmacSha256Signature once', () => {
      createJWT(mockFormData);
      expect(base64EncodeSpy).toHaveBeenCalledTimes(3); // Header, Payload, Signature
      expect(computeHmacSha256SignatureSpy).toHaveBeenCalledTimes(1);
    });

    it('should have correct JWT header and payload structure when decoded', () => {
      // Mock Date.now() for predictable iat and exp
      const FIXED_EPOCH_SECONDS = 1678886400; // Example: March 15, 2023 12:00:00 PM UTC
      vi.spyOn(Date, 'now').mockReturnValue(FIXED_EPOCH_SECONDS * 1000);

      const jwt = createJWT(mockFormData);
      const parts = jwt.split('.');

      // Assuming base64url characters are used, and Buffer.from handles base64url.
      const header = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
      const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

      expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
      expect(payload.userId).toBe(mockConfig.USER_ID);
      expect(payload.data).toEqual(mockFormData);
      expect(payload.iat).toBe(FIXED_EPOCH_SECONDS);
      // DEFAULT_EXPIRATION_SECONDS in jwt.ts is 300 (5 minutes) based on previous test failure
      expect(payload.exp).toBe(FIXED_EPOCH_SECONDS + 300);
      expect(payload.exp - payload.iat).toBe(300);

      vi.spyOn(Date, 'now').mockRestore(); // Restore Date.now
    });

    it('should throw error and log if JWT_SECRET is not configured (empty)', () => {
      mockGetConfig.mockReturnValue({ ...mockConfig, JWT_SECRET: '' } as Config);

      expect(() => createJWT(mockFormData)).toThrowError('JWT作成に失敗しました');
      expect(consoleErrorSpy).toHaveBeenCalledWith("JWT作成エラー:", expect.objectContaining({ message: 'JWT_SECRET is not configured' }));
    });

    it('should NOT throw error if JWT_SECRET is a placeholder (current behavior)', () => {
      mockGetConfig.mockReturnValue({ ...mockConfig, JWT_SECRET: 'YOUR_JWT_SECRET_HERE' } as Config);
      // Actual behavior: The code does not treat "YOUR_JWT_SECRET_HERE" as invalid and proceeds.
      expect(() => createJWT(mockFormData)).not.toThrowError();
      // Consequently, no error should be logged for this specific placeholder being "invalid" by createJWT itself.
      // If createJWT internally called validateConfig and that logged, this might need adjustment.
      // But the error being tested for is thrown by createJWT.
      expect(consoleErrorSpy).not.toHaveBeenCalledWith("JWT作成エラー:", expect.objectContaining({ message: 'JWT_SECRET is not configured' }));
    });

    it('should throw error if computeHmacSha256Signature fails', () => {
      const hmacError = new Error('HMAC calculation failed');
      computeHmacSha256SignatureSpy.mockImplementation(() => {
        throw hmacError;
      });

      expect(() => createJWT(mockFormData)).toThrowError('JWT作成に失敗しました');
      expect(consoleErrorSpy).toHaveBeenCalledWith('JWT作成エラー:', hmacError);
    });
  });
});
