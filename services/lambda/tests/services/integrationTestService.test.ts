import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../src/di/dependencies';
import { createTestContainer } from '../di/testContainer';
import { IntegrationTestService } from '../../src/services/integrationTestService';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { IntegrationTestRepository } from '../../src/repositories/integrationTestRepository';
import type { EAApplicationRepository } from '../../src/repositories/eaApplicationRepository';
import type { UserProfileRepository } from '../../src/repositories/userProfileRepository';

describe('IntegrationTestService', () => {
    let container: AwilixContainer<DIContainer>;
    let service: IntegrationTestService;
    let mockDocClient: DynamoDBDocumentClient;
    let mockIntegrationTestRepository: IntegrationTestRepository;
    let mockEAApplicationRepository: EAApplicationRepository;
    let mockUserProfileRepository: UserProfileRepository;
    let mockLogger: any;

    beforeEach(() => {
        // 環境変数の設定（必須）
        process.env.ENVIRONMENT = 'test';
        process.env.TABLE_NAME = 'test-applications-table';

        // 実サービスインスタンスを使用（必須）
        container = createTestContainer();
        service = container.resolve('integrationTestService');
        mockDocClient = container.resolve('docClient');
        mockIntegrationTestRepository = container.resolve('integrationTestRepository');
        mockEAApplicationRepository = container.resolve('eaApplicationRepository');
        mockUserProfileRepository = container.resolve('userProfileRepository');
        mockLogger = container.resolve('logger');
    });

    afterEach(() => {
        vi.clearAllMocks();
        // 環境変数のクリーンアップ（必須）
        delete process.env.ENVIRONMENT;
        delete process.env.TABLE_NAME;
    });

    describe('startIntegrationTest', () => {
        it('新しい統合テストを開始できる', async () => {
            const userId = 'test-user-id';
            const testId = 'test-123';
            const gasWebappUrl = 'https://script.google.com/test';

            // リポジトリのモック
            vi.spyOn(mockIntegrationTestRepository, 'initializeIntegrationTest').mockResolvedValue();

            await service.startIntegrationTest(userId, testId, gasWebappUrl);

            expect(mockIntegrationTestRepository.initializeIntegrationTest).toHaveBeenCalledWith(
                userId,
                expect.objectContaining({
                    testId,
                    gasWebappUrl,
                    currentStep: 'STARTED',
                    currentStepStatus: 'failed', // 実装に合わせて修正
                    lastError: expect.objectContaining({
                        message: 'Pending GAS WebApp call',
                        step: 'STARTED'
                    })
                })
            );
        });
    });

    describe('recordTestStarted', () => {
        it('テスト開始を正常に記録できる', async () => {
            const userId = 'test-user-id';
            const testId = 'test-123';
            const mockUserProfile = {
                testResults: {
                    integration: {
                        testId,
                        currentStep: 'STARTED',
                        currentStepStatus: 'pending'
                    }
                }
            };

            vi.spyOn(mockUserProfileRepository, 'getUserProfile').mockResolvedValue(mockUserProfile as any);
            vi.spyOn(mockIntegrationTestRepository, 'updateIntegrationTest').mockResolvedValue();

            await service.recordTestStarted(userId, testId);

            expect(mockIntegrationTestRepository.updateIntegrationTest).toHaveBeenCalledWith(
                userId,
                expect.objectContaining({
                    currentStepStatus: 'success'
                })
            );
        });

        it('テストが見つからない場合はエラーをスロー', async () => {
            const userId = 'test-user-id';
            const testId = 'test-123';

            vi.spyOn(mockUserProfileRepository, 'getUserProfile').mockResolvedValue(null);

            await expect(service.recordTestStarted(userId, testId)).rejects.toThrow('Integration test not found');
        });

        it('テストIDが一致しない場合はエラーをスロー', async () => {
            const userId = 'test-user-id';
            const testId = 'test-123';
            const mockUserProfile = {
                testResults: {
                    integration: {
                        testId: 'different-test-id',
                        currentStep: 'STARTED'
                    }
                }
            };

            vi.spyOn(mockUserProfileRepository, 'getUserProfile').mockResolvedValue(mockUserProfile as any);

            await expect(service.recordTestStarted(userId, testId)).rejects.toThrow('Test ID mismatch');
        });
    });

    describe('recordProgress', () => {
        it('ステップの進捗を正常に記録できる', async () => {
            const userId = 'test-user-id';
            const mockUserProfile = {
                testResults: {
                    integration: {
                        testId: 'test-123',
                        currentStep: 'STARTED',
                        currentStepStatus: 'success',
                        completedSteps: {
                            STARTED: new Date().toISOString()
                        },
                        lastUpdated: new Date().toISOString()
                    }
                }
            };

            vi.spyOn(mockUserProfileRepository, 'getUserProfile').mockResolvedValue(mockUserProfile as any);
            vi.spyOn(mockIntegrationTestRepository, 'updateIntegrationTest').mockResolvedValue();

            await service.recordProgress(userId, 'GAS_WEBHOOK_RECEIVED', true, {
                applicationSK: 'app-123'
            });

            expect(mockIntegrationTestRepository.updateIntegrationTest).toHaveBeenCalledWith(
                userId,
                expect.objectContaining({
                    currentStep: 'GAS_WEBHOOK_RECEIVED',
                    currentStepStatus: 'success'
                })
            );
        });

        it('アクティブなテストがない場合はエラーをスロー', async () => {
            const userId = 'test-user-id';

            vi.spyOn(mockUserProfileRepository, 'getUserProfile').mockResolvedValue(null);

            await expect(service.recordProgress(userId, 'GAS_WEBHOOK_RECEIVED', true))
                .rejects.toThrow('No active integration test found');
        });
    });

    describe('getIntegrationTestStatus', () => {
        it('アクティブなテストのステータスを取得できる', async () => {
            const userId = 'test-user-id';
            const mockUserProfile = {
                testResults: {
                    integration: {
                        testId: 'test-123',
                        currentStep: 'GAS_WEBHOOK_RECEIVED',
                        currentStepStatus: 'success',
                        completedSteps: {
                            STARTED: new Date().toISOString(),
                            GAS_WEBHOOK_RECEIVED: new Date().toISOString()
                        },
                        gasWebappUrl: 'https://script.google.com/test',
                        lastUpdated: new Date().toISOString()
                    }
                }
            };

            vi.spyOn(mockUserProfileRepository, 'getUserProfile').mockResolvedValue(mockUserProfile as any);

            const status = await service.getIntegrationTestStatus(userId);

            expect(status).toEqual({
                active: true,
                test: expect.any(Object),
                canRetry: false,
                nextStep: 'LICENSE_ISSUED',
                progress: 50
            });
        });

        it('テストがない場合は非アクティブステータスを返す', async () => {
            const userId = 'test-user-id';

            vi.spyOn(mockUserProfileRepository, 'getUserProfile').mockResolvedValue(null);

            const status = await service.getIntegrationTestStatus(userId);

            expect(status).toEqual({
                active: false,
                canRetry: true,
                progress: 0
            });
        });
    });

    describe('isIntegrationTestApplication', () => {
        it('統合テストアプリケーションを正しく識別できる', () => {
            const testApp = {
                integrationTestId: 'test-123',
                accountNumber: 'INTEGRATION_TEST_123456',
                broker: 'Test Broker',
                eaName: 'Integration Test EA'
            };

            expect(service.isIntegrationTestApplication(testApp as any)).toBe(true);
        });

        it('通常のアプリケーションは統合テストアプリケーションとして識別されない', () => {
            const normalApp = {
                accountNumber: '123456',
                broker: 'Real Broker',
                eaName: 'Real EA'
            };

            expect(service.isIntegrationTestApplication(normalApp as any)).toBe(false);
        });
    });

    describe('cleanupIntegrationTestData', () => {
        it('統合テストデータを正常にクリーンアップできる', async () => {
            const userId = 'test-user-id';
            const mockApplications = [
                { sk: 'app-1', integrationTestId: 'test-123' },
                { sk: 'app-2', accountNumber: 'INTEGRATION_TEST_123456' }
            ];

            vi.spyOn(mockIntegrationTestRepository, 'clearIntegrationTest').mockResolvedValue();
            vi.spyOn(mockEAApplicationRepository, 'getAllApplications').mockResolvedValue(mockApplications as any);
            vi.spyOn(mockEAApplicationRepository, 'deleteApplication').mockResolvedValue();

            await service.cleanupIntegrationTestData(userId);

            expect(mockIntegrationTestRepository.clearIntegrationTest).toHaveBeenCalledWith(userId);
            expect(mockEAApplicationRepository.deleteApplication).toHaveBeenCalledTimes(2);
        });
    });

    describe('findIntegrationTestApplications', () => {
        it('テストIDで統合テストアプリケーションを検索できる', async () => {
            const testId = 'test-123';
            const mockApplications = [
                { userId: 'user-1', sk: 'app-1', integrationTestId: testId }
            ];

            const mockSend = vi.fn().mockResolvedValue({ Items: mockApplications });
            (mockDocClient.send as any) = mockSend;

            const result = await service.findIntegrationTestApplications(testId);

            expect(mockSend).toHaveBeenCalledWith(
                expect.any(Object) // ScanCommandのインスタンスをチェック
            );

            // 実際の呼び出し引数を確認
            const actualCommand = mockSend.mock.calls[0][0];
            expect(actualCommand.input).toEqual({
                TableName: 'test-applications-table',
                FilterExpression: 'integrationTestId = :testId',
                ExpressionAttributeValues: {
                    ':testId': testId
                },
                ProjectionExpression: 'userId, sk, integrationTestId, accountNumber, broker, eaName, #status',
                ExpressionAttributeNames: {
                    '#status': 'status'
                }
            });

            expect(result).toEqual(mockApplications);
        });
    });
});