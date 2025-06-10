export interface BaseLicensePayload {
  version: number;
}

// Version 1 payload structure
export interface LicensePayloadV1 extends BaseLicensePayload {
  version: 1;
  eaName: string;
  accountId: string;
  expiry: string;
  userId: string;
  issuedAt: string;
}

// Type alias for current version
export type LicensePayload = LicensePayloadV1;

// Version constants
export const PAYLOAD_VERSIONS = {
  V1: 1 as const,
  // V2: 2 as const  // 将来の拡張用
  // V3: 3 as const  // 将来の拡張用
} as const;

// Helper function to create V1 payload
export function createLicensePayloadV1(params: {
  eaName: string;
  accountId: string;
  expiry: string;
  userId: string;
  issuedAt: string;
}): LicensePayloadV1 {
  return {
    version: PAYLOAD_VERSIONS.V1,
    ...params
  };
}

// Type guard to check payload version
export function isLicensePayloadV1(payload: any): payload is LicensePayloadV1 {
  return payload &&
      typeof payload === 'object' &&
      payload.version === PAYLOAD_VERSIONS.V1 &&
      typeof payload.eaName === 'string' &&
      typeof payload.accountId === 'string' &&
      typeof payload.expiry === 'string' &&
      typeof payload.userId === 'string' &&
      typeof payload.issuedAt === 'string';
}