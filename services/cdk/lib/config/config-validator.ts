import * as cdk from 'aws-cdk-lib';
import type { EnvironmentSettings, Environment } from '../types/config-types';
import { EnvironmentConfig } from './environment-settings';

/**
 * 設定検証クラス
 */
export class ConfigValidator {
    /**
     * 環境設定を検証
     */
    static validateEnvironment(environment: string): void {
        // 環境名の検証
        if (!EnvironmentConfig.getAvailableEnvironments().includes(environment as Environment)) {
            throw new Error(
                `Invalid environment: ${environment}. Available: ${EnvironmentConfig.getAvailableEnvironments().join(', ')}`
            );
        }

        const config = EnvironmentConfig.get(environment);
        this.validateConfig(config, environment);
    }

    /**
     * 設定内容を検証
     */
    private static validateConfig(config: EnvironmentSettings, environment: string): void {
        // 基本設定の検証
        this.validateBasicSettings(config, environment);

        // セキュリティ設定の検証
        this.validateSecuritySettings(config, environment);

        // 認証設定の検証
        this.validateAuthSettings(config, environment);

        // Lambda設定の検証
        this.validateLambdaSettings(config, environment);

        // DynamoDB設定の検証
        this.validateDynamoDbSettings(config, environment);

        // 通知設定の検証
        this.validateNotificationSettings(config, environment);
    }

    /**
     * 基本設定の検証
     */
    private static validateBasicSettings(config: EnvironmentSettings, environment: string): void {
        if (!config.domain) {
            throw new Error(`Domain is required for environment: ${environment}`);
        }

        if (!config.domain.includes('.')) {
            throw new Error(`Invalid domain format for environment: ${environment}`);
        }

        // 本番環境の特別な検証
        if (EnvironmentConfig.isProduction(environment)) {
            if (config.removalPolicy !== cdk.RemovalPolicy.RETAIN) {
                throw new Error('Production environment must use RETAIN removal policy');
            }
        }
    }

    /**
     * セキュリティ設定の検証
     */
    private static validateSecuritySettings(config: EnvironmentSettings, environment: string): void {
        if (!config.security.enableDeletionProtection && EnvironmentConfig.isProduction(environment)) {
            throw new Error('Production environment must have deletion protection enabled');
        }

        if (config.security.corsOrigins.includes('*') && EnvironmentConfig.isProduction(environment)) {
            throw new Error('Production environment should not allow CORS from all origins');
        }

        if (config.security.corsOrigins.length === 0) {
            throw new Error(`CORS origins cannot be empty for environment: ${environment}`);
        }
    }

    /**
     * 認証設定の検証
     */
    private static validateAuthSettings(config: EnvironmentSettings, environment: string): void {
        if (!config.auth.authDomainPrefix) {
            throw new Error(`Auth domain prefix is required for environment: ${environment}`);
        }

        if (config.auth.callbackUrls.length === 0) {
            throw new Error(`Callback URLs are required for environment: ${environment}`);
        }

        if (config.auth.logoutUrls.length === 0) {
            throw new Error(`Logout URLs are required for environment: ${environment}`);
        }

        // URL形式の検証
        const allUrls = [...config.auth.callbackUrls, ...config.auth.logoutUrls];
        for (const url of allUrls) {
            if (!this.isValidUrl(url)) {
                throw new Error(`Invalid URL format: ${url} in environment: ${environment}`);
            }
        }
    }

    /**
     * Lambda設定の検証
     */
    private static validateLambdaSettings(config: EnvironmentSettings, environment: string): void {
        if (config.lambda.memorySize < 128 || config.lambda.memorySize > 10240) {
            throw new Error(`Invalid Lambda memory size for environment: ${environment}. Must be between 128 and 10240 MB`);
        }

        if (config.lambda.timeoutSeconds < 1 || config.lambda.timeoutSeconds > 900) {
            throw new Error(`Invalid Lambda timeout for environment: ${environment}. Must be between 1 and 900 seconds`);
        }

        if (!config.lambda.runtime) {
            throw new Error(`Lambda runtime is required for environment: ${environment}`);
        }
    }

    /**
     * DynamoDB設定の検証
     */
    private static validateDynamoDbSettings(config: EnvironmentSettings, environment: string): void {
        if (config.dynamodb.billingMode === 'PROVISIONED') {
            if (!config.dynamodb.readCapacity || !config.dynamodb.writeCapacity) {
                throw new Error(`Read and write capacity are required for PROVISIONED billing mode in environment: ${environment}`);
            }

            if (config.dynamodb.readCapacity < 1 || config.dynamodb.writeCapacity < 1) {
                throw new Error(`DynamoDB capacity must be at least 1 for environment: ${environment}`);
            }
        }
    }

    /**
     * 通知設定の検証
     */
    private static validateNotificationSettings(config: EnvironmentSettings, environment: string): void {
        if (!config.notification.emailFromAddress) {
            throw new Error(`Email from address is required for environment: ${environment}`);
        }

        if (!this.isValidEmail(config.notification.emailFromAddress)) {
            throw new Error(`Invalid email format for environment: ${environment}: ${config.notification.emailFromAddress}`);
        }

        if (config.notification.defaultTtlMonths < 1 || config.notification.defaultTtlMonths > 60) {
            throw new Error(`TTL months must be between 1 and 60 for environment: ${environment}`);
        }
    }

    /**
     * URL形式の検証
     */
    private static isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * メールアドレス形式の検証
     */
    private static isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * 環境間の設定整合性チェック
     */
    static validateCrossEnvironmentConsistency(): void {
        const environments = EnvironmentConfig.getAvailableEnvironments();
        const configs = environments.map((env: Environment) => ({ env, config: EnvironmentConfig.get(env) }));

        // ドメインの重複チェック
        const domains = configs.map((c: { env: Environment; config: EnvironmentSettings }) => c.config.domain);
        const uniqueDomains = new Set(domains);
        if (domains.length !== uniqueDomains.size) {
            throw new Error('Duplicate domains found across environments');
        }

        // 認証ドメインプレフィックスの重複チェック
        const authPrefixes = configs.map((c: { env: Environment; config: EnvironmentSettings }) => c.config.auth.authDomainPrefix);
        const uniqueAuthPrefixes = new Set(authPrefixes);
        if (authPrefixes.length !== uniqueAuthPrefixes.size) {
            throw new Error('Duplicate auth domain prefixes found across environments');
        }
    }
}