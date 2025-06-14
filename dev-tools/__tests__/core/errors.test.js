/**
 * core/errors.js のテストスイート
 * カスタムエラークラスの動作確認
 */

import { describe, test, expect } from 'vitest';

// テスト対象のモジュール
import {
    BaseError,
    ConfigurationError,
    ApiError,
    ResourceNotFoundError,
    CdkNotDeployedError
} from '../../core/errors.js';

describe('カスタムエラークラス', () => {
    describe('BaseError', () => {
        test('メッセージのみで正しくインスタンス化される', () => {
            const error = new BaseError('Test error message');
            
            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(BaseError);
            expect(error.message).toBe('Test error message');
            expect(error.name).toBe('BaseError');
            expect(error.cause).toBeNull();
        });

        test('メッセージとcauseで正しくインスタンス化される', () => {
            const cause = new Error('Original error');
            const error = new BaseError('Wrapped error', cause);
            
            expect(error.message).toBe('Wrapped error');
            expect(error.cause).toBe(cause);
            expect(error.stack).toContain('Caused by:');
        });

        test('causeが文字列の場合も正しく処理される', () => {
            const error = new BaseError('Error message', 'String cause');
            
            expect(error.cause).toBe('String cause');
            expect(error.stack).toContain('Caused by: String cause');
        });
    });

    describe('ConfigurationError', () => {
        test('ConfigurationErrorが正しくインスタンス化される', () => {
            const error = new ConfigurationError('Config error');
            
            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(BaseError);
            expect(error).toBeInstanceOf(ConfigurationError);
            expect(error.name).toBe('ConfigurationError');
            expect(error.message).toBe('Config error');
        });

        test('causeを含むConfigurationErrorが正しく作成される', () => {
            const cause = new Error('Invalid JSON');
            const error = new ConfigurationError('Failed to parse config', cause);
            
            expect(error.cause).toBe(cause);
            expect(error.stack).toContain('Caused by:');
            expect(error.stack).toContain('Invalid JSON');
        });
    });

    describe('ApiError', () => {
        test('基本的なApiErrorが正しくインスタンス化される', () => {
            const error = new ApiError('API request failed');
            
            expect(error).toBeInstanceOf(ApiError);
            expect(error.name).toBe('ApiError');
            expect(error.message).toBe('API request failed');
            expect(error.serviceName).toBe('API');
            expect(error.statusCode).toBeNull();
        });

        test('すべてのパラメータを含むApiErrorが正しく作成される', () => {
            const cause = new Error('Network error');
            const error = new ApiError('Request failed', 'AWS S3', 403, cause);
            
            expect(error.message).toBe('Request failed');
            expect(error.serviceName).toBe('AWS S3');
            expect(error.statusCode).toBe(403);
            expect(error.cause).toBe(cause);
        });

        test('serviceNameのデフォルト値が正しく設定される', () => {
            const error = new ApiError('Error message', undefined, 500);
            
            expect(error.serviceName).toBe('API');
            expect(error.statusCode).toBe(500);
        });
    });

    describe('ResourceNotFoundError', () => {
        test('ResourceNotFoundErrorが正しくインスタンス化される', () => {
            const error = new ResourceNotFoundError('Stack', 'my-stack-name');
            
            expect(error).toBeInstanceOf(ResourceNotFoundError);
            expect(error.name).toBe('ResourceNotFoundError');
            expect(error.message).toBe("Stack 'my-stack-name' not found.");
            expect(error.resourceType).toBe('Stack');
            expect(error.resourceIdentifier).toBe('my-stack-name');
        });

        test('causeを含むResourceNotFoundErrorが正しく作成される', () => {
            const cause = new Error('AWS API error');
            const error = new ResourceNotFoundError('User', 'user-123', cause);
            
            expect(error.message).toBe("User 'user-123' not found.");
            expect(error.cause).toBe(cause);
        });
    });

    describe('CdkNotDeployedError', () => {
        test('基本的なCdkNotDeployedErrorが正しくインスタンス化される', () => {
            const error = new CdkNotDeployedError();
            
            expect(error).toBeInstanceOf(CdkNotDeployedError);
            expect(error).toBeInstanceOf(ConfigurationError);
            expect(error.name).toBe('CdkNotDeployedError');
            expect(error.message).toBe('Required CDK resources are not deployed.');
            expect(error.missingResources).toEqual([]);
            expect(error.environment).toBeNull();
        });

        test('missingResourcesを含むCdkNotDeployedErrorが正しく作成される', () => {
            const missingResources = ['UserPool', 'ApiGateway'];
            const error = new CdkNotDeployedError(missingResources);
            
            expect(error.message).toBe('Required CDK resources are not deployed. Missing: UserPool, ApiGateway.');
            expect(error.missingResources).toEqual(missingResources);
        });

        test('environmentを含むCdkNotDeployedErrorが正しく作成される', () => {
            const error = new CdkNotDeployedError([], 'production');
            
            expect(error.message).toBe("Required CDK resources are not deployed for environment 'production'.");
            expect(error.environment).toBe('production');
        });

        test('すべてのパラメータを含むCdkNotDeployedErrorが正しく作成される', () => {
            const missingResources = ['DynamoDB', 'Lambda'];
            const cause = new Error('Stack not found');
            const error = new CdkNotDeployedError(missingResources, 'dev', cause);
            
            expect(error.message).toBe("Required CDK resources are not deployed for environment 'dev'. Missing: DynamoDB, Lambda.");
            expect(error.missingResources).toEqual(missingResources);
            expect(error.environment).toBe('dev');
            expect(error.cause).toBe(cause);
        });
    });

    describe('エラーの継承関係', () => {
        test('すべてのカスタムエラーがErrorを継承している', () => {
            const errors = [
                new BaseError('test'),
                new ConfigurationError('test'),
                new ApiError('test'),
                new ResourceNotFoundError('type', 'id'),
                new CdkNotDeployedError()
            ];

            errors.forEach(error => {
                expect(error).toBeInstanceOf(Error);
                expect(error.stack).toBeDefined();
            });
        });

        test('ConfigurationErrorとCdkNotDeployedErrorの継承関係が正しい', () => {
            const cdkError = new CdkNotDeployedError();
            
            expect(cdkError).toBeInstanceOf(BaseError);
            expect(cdkError).toBeInstanceOf(ConfigurationError);
            expect(cdkError).toBeInstanceOf(CdkNotDeployedError);
        });
    });
});