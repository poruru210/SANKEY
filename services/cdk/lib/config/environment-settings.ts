import * as cdk from 'aws-cdk-lib';
import type { Environment, EnvironmentSettings } from '../types/config-types';

/**
 * 環境別設定管理クラス
 */
export class EnvironmentConfig {
    /**
     * 環境別設定の定義
     */
    private static readonly configs: Record<Environment, EnvironmentSettings> = {
        dev: {
            // 基本設定
            logLevel: 'DEBUG',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            domain: 'dev.sankey.trade',

            // セキュリティ設定
            security: {
                enableDeletionProtection: false,
                corsOrigins: ['*'],
            },

            // 認証設定
            auth: {
                authDomainPrefix: 'sankey-auth-dev',
                callbackUrls: [
                    'http://localhost:3000/api/auth/callback/cognito',
                    'https://dev.sankey.trade/api/auth/callback/cognito',
                ],
                logoutUrls: [
                    'http://localhost:3000/login',
                    'https://dev.sankey.trade/login',
                ],
            },

            // Lambda設定
            lambda: {
                memorySize: 256,
                timeoutSeconds: 30,
                runtime: 'nodejs22.x',
            },

            // DynamoDB設定
            dynamodb: {
                billingMode: 'PROVISIONED',
                readCapacity: 3,
                writeCapacity: 3,
            },

            // モニタリング設定
            monitoring: {
                enableDetailedMonitoring: false,
                enableXRayTracing: false,
                createAlarms: false,
            },

            // 通知設定
            notification: {
                emailFromAddress: 'noreply@sankey.trade',
                defaultTtlMonths: 3,
            },
        },
        prod: {
            // 基本設定
            logLevel: 'WARN',
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            domain: 'sankey.trade',

            // セキュリティ設定
            security: {
                enableDeletionProtection: true,
                corsOrigins: ['https://sankey.trade'],
            },

            // 認証設定
            auth: {
                authDomainPrefix: 'sankey-auth',
                callbackUrls: ['https://sankey.trade/api/auth/callback/cognito'],
                logoutUrls: ['https://sankey.trade/login'],
            },

            // Lambda設定
            lambda: {
                memorySize: 256,
                timeoutSeconds: 300,
                runtime: 'nodejs22.x',
            },

            // DynamoDB設定
            dynamodb: {
                billingMode: 'PROVISIONED',
                readCapacity: 3,
                writeCapacity: 3,
            },

            // モニタリング設定
            monitoring: {
                enableDetailedMonitoring: true,
                enableXRayTracing: true,
                createAlarms: true,
            },

            // 通知設定
            notification: {
                emailFromAddress: 'noreply@sankey.trade',
                defaultTtlMonths: 12,
            },
        },
    };

    /**
     * 環境設定を取得
     */
    static get(environment: string): EnvironmentSettings {
        const env = environment as Environment;
        const config = this.configs[env];

        if (!config) {
            throw new Error(
                `Unknown environment: ${environment}. Available: ${this.getAvailableEnvironments().join(', ')}`
            );
        }

        return config;
    }

    /**
     * 利用可能な環境一覧を取得
     */
    static getAvailableEnvironments(): Environment[] {
        return Object.keys(this.configs) as Environment[];
    }

    /**
     * 環境が本番環境かどうかを判定
     */
    static isProduction(environment: string): boolean {
        return environment === 'prod';
    }

    /**
     * 環境が開発環境かどうかを判定
     */
    static isDevelopment(environment: string): boolean {
        return environment === 'dev';
    }

    /**
     * 環境がステージング環境かどうかを判定
     */
    static isStaging(environment: string): boolean {
        return environment === 'staging';
    }
}