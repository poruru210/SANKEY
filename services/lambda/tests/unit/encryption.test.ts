import { encryptLicense, decryptLicense } from '../../src/services/encryption';
import { createLicensePayloadV1, LicensePayloadV1 } from '../../src/models/licensePayload';
import { webcrypto } from 'crypto';

describe('License Encryption/Decryption', () => {
  const keyData = Buffer.alloc(32, 1); // 固定キー
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
    // 正しいLicensePayloadV1形式を使用
    const payload = createLicensePayloadV1({
      eaName: 'TestEA',
      accountId: accountId,
      expiry: '2025-12-31T23:59:59Z',
      userId: 'test-user-123',
      issuedAt: new Date().toISOString()
    });

    const result = await encryptLicense(key, payload, accountId);
    expect(typeof result).toBe('string');

    const buf = Buffer.from(result, 'base64');
    expect(buf.length).toBeGreaterThan(48); // IV (16) + HMAC (32) + Ciphertext (>0)
  });

  it('should decrypt the license back to original payload', async () => {
    // 正しいLicensePayloadV1形式を使用
    const payload = createLicensePayloadV1({
      eaName: 'TestEA',
      accountId: accountId,
      expiry: '2025-12-31T23:59:59Z',
      userId: 'test-user-123',
      issuedAt: new Date().toISOString()
    });

    const encrypted = await encryptLicense(key, payload, accountId);
    const decrypted = await decryptLicense(key, encrypted, accountId);

    // decryptLicenseはLicensePayloadV1オブジェクトを返すので、期待値と比較
    expect(decrypted.eaName).toBe(payload.eaName);
    expect(decrypted.accountId).toBe(payload.accountId);
    expect(decrypted.expiry).toBe(payload.expiry);
    expect(decrypted.userId).toBe(payload.userId);
    expect(decrypted.version).toBe(payload.version);
    expect(decrypted.issuedAt).toBe(payload.issuedAt);
  });

  it('should fail decryption with wrong accountId', async () => {
    const payload = createLicensePayloadV1({
      eaName: 'TestEA',
      accountId: accountId,
      expiry: '2025-12-31T23:59:59Z',
      userId: 'test-user-123',
      issuedAt: new Date().toISOString()
    });

    const encrypted = await encryptLicense(key, payload, accountId);
    await expect(decryptLicense(key, encrypted, 'wrong-account')).rejects.toThrow('HMAC verification failed');
  });

  it('should fail if key is wrong', async () => {
    const payload = createLicensePayloadV1({
      eaName: 'TestEA',
      accountId: accountId,
      expiry: '2025-12-31T23:59:59Z',
      userId: 'test-user-123',
      issuedAt: new Date().toISOString()
    });

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

  it('should handle different payload versions correctly', async () => {
    const payload = createLicensePayloadV1({
      eaName: 'TestEA',
      accountId: accountId,
      expiry: '2025-12-31T23:59:59Z',
      userId: 'test-user-123',
      issuedAt: new Date().toISOString()
    });

    expect(payload.version).toBe(1);

    const encrypted = await encryptLicense(key, payload, accountId);
    const decrypted = await decryptLicense(key, encrypted, accountId);

    expect(decrypted.version).toBe(1);
  });

  it('should preserve all payload fields during encryption/decryption', async () => {
    const originalPayload = createLicensePayloadV1({
      eaName: 'AdvancedEA',
      accountId: '9876543210',
      expiry: '2026-06-30T23:59:59Z',
      userId: 'advanced-user-456',
      issuedAt: '2025-06-10T12:00:00Z'
    });

    const encrypted = await encryptLicense(key, originalPayload, originalPayload.accountId);
    const decrypted = await decryptLicense(key, encrypted, originalPayload.accountId);

    // すべてのフィールドが保持されていることを確認
    expect(decrypted).toEqual(originalPayload);
    expect(decrypted.version).toBe(1);
  });

  it('should fail with invalid payload (missing version)', async () => {
    // 手動で不正なペイロードを作成（versionフィールドなし）
    const invalidPayload = {
      eaName: 'TestEA',
      accountId: accountId,
      expiry: '2025-12-31T23:59:59Z',
      userId: 'test-user-123',
      issuedAt: new Date().toISOString()
      // version フィールドなし
    } as any;

    const encrypted = await encryptLicense(key, invalidPayload, accountId);
    await expect(decryptLicense(key, encrypted, accountId)).rejects.toThrow('Invalid payload: missing or invalid version field');
  });

  it('should fail with invalid payload (invalid version type)', async () => {
    // versionが文字列の場合
    const invalidPayload = {
      version: "invalid",
      eaName: 'TestEA',
      accountId: accountId,
      expiry: '2025-12-31T23:59:59Z',
      userId: 'test-user-123',
      issuedAt: new Date().toISOString()
    } as any;

    const encrypted = await encryptLicense(key, invalidPayload, accountId);
    await expect(decryptLicense(key, encrypted, accountId)).rejects.toThrow('Invalid payload: missing or invalid version field');
  });

  it('should fail with invalid payload (zero version)', async () => {
    // versionが0の場合
    const invalidPayload = {
      version: 0,
      eaName: 'TestEA',
      accountId: accountId,
      expiry: '2025-12-31T23:59:59Z',
      userId: 'test-user-123',
      issuedAt: new Date().toISOString()
    } as any;

    const encrypted = await encryptLicense(key, invalidPayload, accountId);
    await expect(decryptLicense(key, encrypted, accountId)).rejects.toThrow('Invalid payload: missing or invalid version field');
  });

  it('should handle future version compatibility', async () => {
    // 将来のバージョン2のペイロードをシミュレート
    const futurePayload = {
      version: 2,
      eaName: 'FutureEA',
      accountId: accountId,
      expiry: '2025-12-31T23:59:59Z',
      userId: 'test-user-123',
      issuedAt: new Date().toISOString(),
      // 将来追加される可能性があるフィールド
      newFeature: 'some-data'
    } as any; // anyを使用して型チェックを回避

    const encrypted = await encryptLicense(key, futurePayload, accountId);
    const decrypted = await decryptLicense(key, encrypted, accountId);

    expect(decrypted.version).toBe(2);
    expect((decrypted as any).newFeature).toBe('some-data'); // 型安全性のためにanyキャスト
  });
});