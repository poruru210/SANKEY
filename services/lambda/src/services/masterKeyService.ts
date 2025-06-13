import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { webcrypto } from 'crypto';
import { Logger } from '@aws-lambda-powertools/logger';

/**
 * DI用の依存関係インターフェース
 */
export interface MasterKeyServiceDependencies {
    ssmClient: SSMClient;
    logger: Logger;
}

export class MasterKeyService {
    private readonly ssmClient: SSMClient;
    private readonly logger: Logger;
    private readonly ssmUserPrefix: string;

    /**
     * DI対応コンストラクタ
     */
    constructor(dependencies: MasterKeyServiceDependencies) {
        this.ssmClient = dependencies.ssmClient;
        this.logger = dependencies.logger;

        // 環境変数から動的にパスを構築
        const environment = process.env.ENVIRONMENT || process.env.STAGE || 'dev';
        const defaultPrefix = `/sankey/${environment}/users`;
        // ssmUserPrefixは依存関係からではなく、環境変数から直接取得
        this.ssmUserPrefix = process.env.SSM_USER_PREFIX || defaultPrefix;

        this.logger.debug('MasterKeyService initialized', {
            ssmUserPrefix: this.ssmUserPrefix,
            environment
        });
    }

    /**
     * マスターキーが存在しない場合は作成する（postConfirmation用）
     */
    async ensureMasterKeyExists(userId: string, email?: string): Promise<void> {
        const paramName = `${this.ssmUserPrefix}/${userId}/master-key`;

        try {
            // 既存確認
            await this.ssmClient.send(new GetParameterCommand({ Name: paramName }));
            this.logger.info('Master key already exists', { userId, paramName });
        } catch (error: any) {
            if (error.name === 'ParameterNotFound') {
                // 新規作成
                await this.createMasterKey(userId, email);
                this.logger.info('Created new master key', { userId, paramName });
            } else {
                this.logger.error('Unexpected error checking master key', { error, userId });
                throw error;
            }
        }
    }

    private async createMasterKey(userId: string, email?: string): Promise<void> {
        const masterKey = webcrypto.getRandomValues(new Uint8Array(32));
        const masterKeyBase64 = Buffer.from(masterKey).toString('base64');
        const paramName = `${this.ssmUserPrefix}/${userId}/master-key`;

        const tags = [
            { Key: 'userId', Value: userId },
            ...(email ? [{ Key: 'email', Value: email }] : [])
        ];

        await this.ssmClient.send(
            new PutParameterCommand({
                Name: paramName,
                Value: masterKeyBase64,
                Type: 'String',
                Description: email ? `Master key for user ${email}` : `Master key for user ${userId}`,
                Tags: tags,
            })
        );
    }

    /**
     * ユーザーのマスターキーを取得してCryptoKeyとして返す
     * @param userId ユーザーID
     * @param keyUsage キーの用途（暗号化、復号化、両方）
     * @returns CryptoKey
     */
    async getUserMasterKey(
        userId: string,
        keyUsage: KeyUsage[] = ['encrypt', 'decrypt']
    ): Promise<CryptoKey> {
        const paramName = `${this.ssmUserPrefix}/${userId}/master-key`;

        try {
            const { Parameter } = await this.ssmClient.send(
                new GetParameterCommand({
                    Name: paramName,
                    WithDecryption: true,
                })
            );

            if (!Parameter?.Value) {
                this.logger.error('Master key parameter not found', { userId, paramName });
                throw new Error(`Master key not found for user: ${userId}`);
            }

            const keyBuffer = Buffer.from(Parameter.Value, 'base64');

            // キーの長さを検証（256-bit / 32 bytes）
            if (keyBuffer.length !== 32) {
                this.logger.error('Invalid master key length', {
                    userId,
                    expectedLength: 32,
                    actualLength: keyBuffer.length
                });
                throw new Error('Invalid master key length. Expected 256-bit key.');
            }

            return await webcrypto.subtle.importKey(
                'raw',
                keyBuffer,
                'AES-CBC',
                true,
                keyUsage
            );
        } catch (error) {
            this.logger.error('Failed to retrieve master key', { userId, error, paramName });

            // エラーの詳細をより具体的に
            if (error instanceof Error) {
                if (error.name === 'ParameterNotFound') {
                    throw new Error(`Master key not found for user: ${userId}`);
                } else if (error.name === 'AccessDenied') {
                    throw new Error(`Access denied to master key for user: ${userId}`);
                } else if (error.message.includes('Invalid master key length')) {
                    throw error; // 既に適切なエラーメッセージ
                } else {
                    throw new Error(`Failed to retrieve encryption key for user: ${userId}`);
                }
            }

            throw new Error(`Failed to retrieve encryption key for user: ${userId}`);
        }
    }

    /**
     * 暗号化用のマスターキーを取得
     * @param userId ユーザーID
     * @returns CryptoKey (encrypt権限のみ)
     */
    async getUserMasterKeyForEncryption(userId: string): Promise<CryptoKey> {
        return this.getUserMasterKey(userId, ['encrypt']);
    }

    /**
     * 復号化用のマスターキーを取得
     * @param userId ユーザーID
     * @returns CryptoKey (decrypt権限のみ)
     */
    async getUserMasterKeyForDecryption(userId: string): Promise<CryptoKey> {
        return this.getUserMasterKey(userId, ['decrypt']);
    }

    /**
     * マスターキーの原始データ（Base64）を取得
     * 注意: セキュリティ上の理由で、必要な場合のみ使用
     * @param userId ユーザーID
     * @returns Base64エンコードされたマスターキー
     */
    async getUserMasterKeyRaw(userId: string): Promise<string> {
        const paramName = `${this.ssmUserPrefix}/${userId}/master-key`;

        try {
            const { Parameter } = await this.ssmClient.send(
                new GetParameterCommand({
                    Name: paramName,
                    WithDecryption: true,
                })
            );

            if (!Parameter?.Value) {
                this.logger.error('Master key parameter not found', { userId, paramName });
                throw new Error(`Master key not found for user: ${userId}`);
            }

            return Parameter.Value;
        } catch (error) {
            this.logger.error('Failed to retrieve raw master key', { userId, error, paramName });
            throw new Error(`Failed to retrieve raw master key for user: ${userId}`);
        }
    }

    /**
     * マスターキーの存在確認
     * @param userId ユーザーID
     * @returns マスターキーが存在するかどうか
     */
    async hasMasterKey(userId: string): Promise<boolean> {
        const paramName = `${this.ssmUserPrefix}/${userId}/master-key`;

        try {
            const { Parameter } = await this.ssmClient.send(
                new GetParameterCommand({
                    Name: paramName,
                    WithDecryption: false, // 存在確認のみなので復号化不要
                })
            );

            return !!Parameter?.Value;
        } catch (error) {
            if (error instanceof Error && error.name === 'ParameterNotFound') {
                return false;
            }

            this.logger.error('Error checking master key existence', { userId, error, paramName });
            throw new Error(`Failed to check master key existence for user: ${userId}`);
        }
    }
}