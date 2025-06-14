// services/lambda/src/services/jwtKeyService.ts
import { createHmac, timingSafeEqual } from 'crypto';
import { Logger } from '@aws-lambda-powertools/logger';
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { webcrypto } from 'crypto';
import {JWTKeyServiceDependencies} from "@lambda/di/dependencies";

export interface JWTPayload {
    data: any;
    iat: number;
    exp: number;
    userId: string;
}

export class JWTKeyService {
    private readonly ssmClient: SSMClient;
    private readonly logger: Logger;
    private readonly ssmUserPrefix: string;

    constructor(dependencies: JWTKeyServiceDependencies) {
        this.ssmClient = dependencies.ssmClient;
        this.logger = dependencies.logger;

        // 環境変数から動的にパスを構築
        const environment = process.env.ENVIRONMENT || process.env.STAGE || 'dev';
        const defaultPrefix = `/sankey/${environment}/users`;
        this.ssmUserPrefix = process.env.SSM_USER_PREFIX || defaultPrefix;

        this.logger.debug('JWTKeyService initialized', {
            ssmUserPrefix: this.ssmUserPrefix,
            environment
        });
    }

    /**
     * Base64URL デコード
     */
    private base64UrlDecode(str: string): string {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) {
            str += '=';
        }
        return Buffer.from(str, 'base64').toString('utf8');
    }

    /**
     * Base64URL デコード（バイナリ用）
     */
    private base64UrlDecodeBuffer(str: string): Buffer {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) {
            str += '=';
        }
        return Buffer.from(str, 'base64');
    }

    /**
     * セキュアキーの生成
     */
    private generateSecureKey(): string {
        const keyBytes = webcrypto.getRandomValues(new Uint8Array(32));
        return Buffer.from(keyBytes).toString('base64');
    }

    /**
     * JWT_SECRET が存在しない場合は作成する（postConfirmation用）
     */
    async ensureJwtSecretExists(userId: string, email?: string): Promise<void> {
        const paramName = `${this.ssmUserPrefix}/${userId}/jwt-secret`;

        try {
            // 既存確認
            await this.ssmClient.send(new GetParameterCommand({ Name: paramName }));
            this.logger.info('JWT secret already exists', { userId, paramName });
        } catch (error: any) {
            if (error.name === 'ParameterNotFound') {
                // 新規作成
                await this.createJwtSecret(userId, email);
                this.logger.info('Created new JWT secret', { userId, paramName });
            } else {
                this.logger.error('Unexpected error checking JWT secret', { error, userId });
                throw error;
            }
        }
    }

    /**
     * JWT_SECRET の作成
     */
    private async createJwtSecret(userId: string, email?: string): Promise<void> {
        const jwtSecret = this.generateSecureKey();
        const paramName = `${this.ssmUserPrefix}/${userId}/jwt-secret`;

        const tags = [
            { Key: 'Environment', Value: process.env.ENVIRONMENT || 'dev' },
            { Key: 'UserID', Value: userId },
            { Key: 'KeyType', Value: 'JWT' },
            { Key: 'SecurityLevel', Value: 'Public' },
            ...(email ? [{ Key: 'Email', Value: email }] : [])
        ];

        await this.ssmClient.send(
            new PutParameterCommand({
                Name: paramName,
                Value: jwtSecret,
                Type: 'SecureString',
                Description: email ? `JWT Secret Key for user ${email} - Safe for GAS templates` : `JWT Secret Key for user ${userId} - Safe for GAS templates`,
                Tags: tags,
            })
        );

        this.logger.info('JWT secret created successfully', { userId, paramName });
    }

    /**
     * SSMからユーザーのJWTシークレットキーを取得
     * 注意: これはJWT認証専用で、GASテンプレートに露出されます
     */
    async getJwtSecret(userId: string): Promise<string> {
        const parameterName = `${this.ssmUserPrefix}/${userId}/jwt-secret`;

        try {
            const command = new GetParameterCommand({
                Name: parameterName,
                WithDecryption: true
            });

            const result = await this.ssmClient.send(command);

            if (!result.Parameter?.Value) {
                throw new Error(`JWT secret not found for user: ${userId}`);
            }

            this.logger.debug('JWT secret retrieved', { userId });
            return result.Parameter.Value;

        } catch (error) {
            this.logger.error('Failed to retrieve JWT secret', {
                error: error instanceof Error ? error.message : String(error),
                userId,
                parameterName
            });
            throw error;
        }
    }

    /**
     * JWT_SECRET の存在確認
     */
    async hasJwtSecret(userId: string): Promise<boolean> {
        const paramName = `${this.ssmUserPrefix}/${userId}/jwt-secret`;

        try {
            const { Parameter } = await this.ssmClient.send(new GetParameterCommand({
                Name: paramName,
                WithDecryption: false, // 存在確認のみなので復号化不要
            }));

            return !!Parameter?.Value;
        } catch (error) {
            if (error instanceof Error && error.name === 'ParameterNotFound') {
                return false;
            }

            this.logger.error('Error checking JWT secret existence', { userId, error, paramName });
            throw new Error(`Failed to check JWT secret existence for user: ${userId}`);
        }
    }

    /**
     * JWT検証（JWTシークレットを使用）
     */
    public async verifyJWT(jwt: string, key: string): Promise<JWTPayload> {
        try {
            const parts = jwt.split('.');
            if (parts.length !== 3) {
                throw new Error('Invalid JWT format - expected 3 parts, got ' + parts.length);
            }

            const [headerB64, payloadB64, signatureB64] = parts;

            // ヘッダーとペイロードのデコード
            let header, payload;
            try {
                header = JSON.parse(this.base64UrlDecode(headerB64));
                payload = JSON.parse(this.base64UrlDecode(payloadB64));
            } catch (decodeError) {
                const errorMessage = decodeError instanceof Error ? decodeError.message : String(decodeError);
                this.logger.error('Failed to decode JWT parts', { error: errorMessage });
                throw new Error('Failed to decode JWT parts');
            }

            // アルゴリズム確認
            if (header.alg !== 'HS256') {
                throw new Error(`Unsupported algorithm: ${header.alg}`);
            }

            if (header.typ !== 'JWT') {
                throw new Error(`Unsupported type: ${header.typ}`);
            }

            // 署名検証
            const signatureInput = headerB64 + '.' + payloadB64;
            const keyBuffer = Buffer.from(key, 'base64');
            const expectedSignature = createHmac('sha256', keyBuffer)
                .update(signatureInput)
                .digest();

            const receivedSignature = this.base64UrlDecodeBuffer(signatureB64);

            if (!timingSafeEqual(expectedSignature, receivedSignature)) {
                this.logger.error('JWT signature verification failed');
                throw new Error('Invalid signature');
            }

            // 有効期限確認
            const currentTime = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < currentTime) {
                this.logger.warn('JWT expired', {
                    exp: payload.exp,
                    currentTime,
                    diff: currentTime - payload.exp
                });
                throw new Error('JWT expired');
            }

            // 発行時刻確認（未来の時刻でないこと）
            if (payload.iat && payload.iat > currentTime + 60) { // 1分の余裕
                this.logger.warn('JWT issued in the future', {
                    iat: payload.iat,
                    currentTime,
                    diff: payload.iat - currentTime
                });
                throw new Error('JWT issued in the future');
            }

            return payload as JWTPayload;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('JWT verification failed', {
                error: errorMessage
            });
            throw error;
        }
    }

    /**
     * ユーザー認証（ユーザーIDでJWTシークレットを取得してJWT検証）
     */
    public async verifyUserRequest(requestBody: string, expectedUserId: string): Promise<JWTPayload> {
        try {
            // リクエストボディを解析
            let requestData;
            try {
                requestData = JSON.parse(requestBody);
            } catch (error) {
                throw new Error('Invalid JSON in request body');
            }

            // ユーザーIDの確認
            if (requestData.userId !== expectedUserId) {
                throw new Error('User ID mismatch');
            }

            // JWTシークレットを取得
            const jwtSecret = await this.getJwtSecret(expectedUserId);

            // JWT検証（リクエストボディ全体がJWT形式の場合）
            if (requestData.data && requestData.data.includes('.')) {
                return await this.verifyJWT(requestData.data, jwtSecret);
            }

            throw new Error('No valid JWT data found');

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('User request verification failed', {
                error: errorMessage,
                userId: expectedUserId
            });
            throw error;
        }
    }

    /**
     * JWT認証の存在確認（JWT認証用）
     */
    public async validateJwtAccess(userId: string): Promise<boolean> {
        try {
            await this.getJwtSecret(userId);
            return true;
        } catch (error) {
            this.logger.error('JWT access validation failed', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return false;
        }
    }
}