import { webcrypto } from 'crypto';
import { LicensePayload } from '../models/licensePayload';

export async function encryptLicense(
    key: CryptoKey,
    payload: LicensePayload,
    accountId: string
): Promise<string> {
  // --- 鍵長の検証 ---
  const rawKey = await webcrypto.subtle.exportKey("raw", key);
  if (rawKey.byteLength !== 32) {
    throw new Error("Invalid key length. Only 256-bit keys are supported.");
  }

  // --- ペイロードをJSON文字列に変換 ---
  const payloadString = JSON.stringify(payload);

  // --- AES-CBC 用の IV を 16 バイト生成 ---
  const iv = webcrypto.getRandomValues(new Uint8Array(16));

  // --- AES-CBC 暗号化処理 ---
  const algo: AesCbcParams = {
    name: 'AES-CBC',
    iv,
  };

  const ctBuffer = await webcrypto.subtle.encrypt(algo, key, new TextEncoder().encode(payloadString));

  // --- HMAC 用のキー生成 ---
  const hmacKey = await webcrypto.subtle.importKey(
      'raw',
      rawKey,  // AESキーをそのまま HMAC 用のキーに流用
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
  );

  // --- HMAC の生成 (AES-CBC 暗号文 + IV + accountId) ---
  const hmac = await webcrypto.subtle.sign(
      'HMAC',
      hmacKey,
      Buffer.concat([iv, new Uint8Array(ctBuffer), new TextEncoder().encode(accountId)])
  );

  // --- IV + HMAC + Ciphertext を結合 ---
  const combined = Buffer.concat([
    iv,
    new Uint8Array(hmac),
    new Uint8Array(ctBuffer)
  ]);

  // --- Base64 エンコードして返却 ---
  return combined.toString('base64');
}

export async function decryptLicense(
    key: CryptoKey,
    encrypted: string,
    accountId: string
): Promise<LicensePayload> {
  const rawKey = await webcrypto.subtle.exportKey("raw", key);
  if (rawKey.byteLength !== 32) {
    throw new Error("Invalid key length. Only 256-bit keys are supported.");
  }

  const encryptedBuffer = Buffer.from(encrypted, 'base64');

  const iv = encryptedBuffer.subarray(0, 16);
  const hmac = encryptedBuffer.subarray(16, 48); // 32 bytes (SHA-256)
  const ciphertext = encryptedBuffer.subarray(48);

  const hmacKey = await webcrypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
  );

  const isValid = await webcrypto.subtle.verify(
      'HMAC',
      hmacKey,
      hmac,
      Buffer.concat([iv, ciphertext, new TextEncoder().encode(accountId)])
  );

  if (!isValid) {
    throw new Error("HMAC verification failed. Data may be tampered with.");
  }

  const algo: AesCbcParams = {
    name: 'AES-CBC',
    iv
  };

  const decryptedBuffer = await webcrypto.subtle.decrypt(algo, key, ciphertext);
  const decryptedString = new TextDecoder().decode(decryptedBuffer);

  try {
    const payload = JSON.parse(decryptedString) as LicensePayload;
    
    // バージョンフィールドの検証
    if (!payload.version) {
      throw new Error("Invalid payload: missing version field");
    }

    return payload;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Invalid payload: malformed JSON");
    }
    throw error;
  }
}