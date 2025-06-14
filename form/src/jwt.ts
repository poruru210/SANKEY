import { FormData } from './config';
import { getConfig } from './config-manager';

/**
 * Base64URL エンコード(JWT用)
 */
export function base64UrlEncode(data: string | Uint8Array): string {
  let base64: string;
  if (typeof data === 'string') {
    base64 = Utilities.base64Encode(data);
  } else {
    // Uint8Arrayの場合はstringに変換
    base64 = Utilities.base64Encode(data as any);
  }
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * JWTの作成（JWT_SECRETを使用）
 */
export function createJWT(payload: FormData): string {
  try {
    const config = getConfig();

    if (!config.JWT_SECRET) {
      throw new Error('JWT_SECRET is not configured');
    }

    const header = {
      alg: "HS256",
      typ: "JWT"
    };

    const jwtPayload = {
      data: payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      userId: config.USER_ID
    };

    const headerEncoded = base64UrlEncode(JSON.stringify(header));
    const payloadEncoded = base64UrlEncode(JSON.stringify(jwtPayload));
    const signatureInput = headerEncoded + "." + payloadEncoded;

    const keyBytes = Utilities.base64Decode(config.JWT_SECRET);
    const signatureInputBytes = Utilities.newBlob(signatureInput).getBytes();
    const signatureBytes = Utilities.computeHmacSha256Signature(signatureInputBytes, keyBytes);
    const signature = base64UrlEncode(new Uint8Array(signatureBytes));

    return signatureInput + "." + signature;

  } catch (error) {
    console.error('JWT作成エラー:', error);
    throw new Error('JWT作成に失敗しました: ' + (error instanceof Error ? error.toString() : String(error)));
  }
}
