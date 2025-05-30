import { encryptLicense, decryptLicense } from '../../src/services/encryption';
import { webcrypto } from 'crypto';

describe('License Encryption/Decryption', () => {
  const keyData = Buffer.alloc(32, 1); // 固定キー
  const payload = JSON.stringify({ eaName: 'TestEA', expiry: '2025-12-31T23:59:59Z' });
  const accountId = '1234';
  let key: CryptoKey;

  beforeAll(async () => {
    key = await webcrypto.subtle.importKey(
        'raw',
        keyData,
        'AES-CBC',
        true, // extractable
        ['encrypt', 'decrypt']
    );
  });

  it('should return a base64 string containing IV, HMAC, and ciphertext', async () => {
    const result = await encryptLicense(key, payload, accountId);
    expect(typeof result).toBe('string');

    const buf = Buffer.from(result, 'base64');
    expect(buf.length).toBeGreaterThan(48); // IV (16) + HMAC (32) + Ciphertext (>0)
  });

  it('should decrypt the license back to original payload', async () => {
    const encrypted = await encryptLicense(key, payload, accountId);
    const decrypted = await decryptLicense(key, encrypted, accountId);
    expect(decrypted).toBe(payload);
  });

  it('should fail decryption with wrong accountId', async () => {
    const encrypted = await encryptLicense(key, payload, accountId);
    await expect(decryptLicense(key, encrypted, 'wrong-account')).rejects.toThrow('HMAC verification failed');
  });

  it('should fail if key is wrong', async () => {
    const encrypted = await encryptLicense(key, payload, accountId);

    // 別のキーを使って復号
    const wrongKey = await webcrypto.subtle.importKey(
        'raw',
        Buffer.alloc(32, 2), // 異なる内容
        'AES-CBC',
        true,
        ['decrypt']
    );

    await expect(decryptLicense(wrongKey, encrypted, accountId)).rejects.toThrow();
  });
});
