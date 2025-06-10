// tests/repositories/eaApplicationRepository.failure.test.ts
// Repository の失敗通知関連メソッドのテスト

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EAApplicationRepository } from '../../src/repositories/eaApplicationRepository';
import { EAApplication, MAX_RETRY_COUNT } from '../../src/models/eaApplication';

// DynamoDB Client のモック
const dynamoMock = mockClient(DynamoDBDocumentClient);

describe('EAApplicationRepository - Failure Methods', () => {
    let repository: EAApplicationRepository;
    let mockDocClient: any;

    beforeEach(() => {
        vi.clearAllMocks();
        dynamoMock.reset();

        // モッククライアントの作成
        mockDocClient = {
            send: vi.fn()
        };

        repository = new EAApplicationRepository(mockDocClient, 'test-table');
    });

    // ヘルパー関数: 失敗したアプリケーション作成
    const createFailedApplication = (
        applicationId: string,
        userId: string,
        failureCount: number = 1,
        additionalProps: Partial<EAApplication> = {}
    ): EAApplication => ({
        userId,
        sk: `APPLICATION#${applicationId}`,
        broker: 'TestBroker',
        accountNumber: '123456',
        eaName: 'TestEA',
        email: 'test@example.com',
        xAccount: '@test',
        status: 'FailedNotification',
        appliedAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T01:00:00Z',
        failureCount,
        lastFailureReason: 'SMTP timeout error',
        lastFailedAt: '2025-01-01T01:00:00Z',
        ...additionalProps
    });

    describe('retryFailedNotification', () => {
        it('should successfully retry failed notification', async () => {
            // Arrange
            const userId = 'test-user-123';
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const retryReason = 'Manual retry after investigation';

            const failedApp = createFailedApplication(
                '2025-01-01T00:00:00Z#TestBroker#123456#TestEA',
                userId,
                2
            );

            const awaitingApp = {
                ...failedApp,
                status: 'AwaitingNotification',
                notificationScheduledAt: expect.any(String)
            };

            // getApplication モック
            mockDocClient.send.mockResolvedValueOnce({ Item: failedApp });
            // updateStatus モック（getApplication + updateStatus）
            mockDocClient.send.mockResolvedValueOnce({ Item: failedApp });
            mockDocClient.send.mockResolvedValueOnce({ Attributes: awaitingApp });
            // recordHistory モック
            mockDocClient.send.mockResolvedValueOnce({});

            // Act
            const result = await repository.retryFailedNotification(userId, applicationSK, retryReason);

            // Assert
            expect(result).toEqual(awaitingApp);

            // Repository メソッドの呼び出し確認
            expect(mockDocClient.send).toHaveBeenCalledTimes(4);

            // updateStatus の確認
            const updateCall = mockDocClient.send.mock.calls[2][0];
            expect(updateCall.input.UpdateExpression).toContain('#status = :newStatus');
            expect(updateCall.input.ExpressionAttributeValues[':newStatus']).toBe('AwaitingNotification');
            expect(updateCall.input.ExpressionAttributeValues).toHaveProperty(':notificationScheduledAt');

            // recordHistory の確認
            const historyCall = mockDocClient.send.mock.calls[3][0];
            expect(historyCall.input.Item.action).toBe('RetryNotification');
            expect(historyCall.input.Item.reason).toBe(retryReason);
            expect(historyCall.input.Item.retryCount).toBe(3); // failureCount + 1
        });

        it('should throw error when application not found', async () => {
            // Arrange
            const userId = 'test-user-123';
            const applicationSK = 'APPLICATION#non-existent';

            mockDocClient.send.mockResolvedValueOnce({ Item: null });

            // Act & Assert
            await expect(
                repository.retryFailedNotification(userId, applicationSK, 'Test retry')
            ).rejects.toThrow('Application not found');

            expect(mockDocClient.send).toHaveBeenCalledTimes(1);
        });

        it('should throw error when application not in FailedNotification status', async () => {
            // Arrange
            const userId = 'test-user-123';
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA';

            const activeApp = createFailedApplication(
                '2025-01-01T00:00:00Z#TestBroker#123456#TestEA',
                userId,
                1,
                { status: 'Active' }
            );

            mockDocClient.send.mockResolvedValueOnce({ Item: activeApp });

            // Act & Assert
            await expect(
                repository.retryFailedNotification(userId, applicationSK, 'Test retry')
            ).rejects.toThrow('Cannot retry notification for application in Active status');
        });
    });

    describe('getFailedNotificationApplications', () => {
        it('should return all failed notification applications for user', async () => {
            // Arrange
            const userId = 'test-user-123';
            const failedApps = [
                createFailedApplication('app-1', userId, 1),
                createFailedApplication('app-2', userId, 2),
                createFailedApplication('app-3', userId, 3)
            ];

            mockDocClient.send.mockResolvedValueOnce({ Items: failedApps });

            // Act
            const result = await repository.getFailedNotificationApplications(userId);

            // Assert
            expect(result).toEqual(failedApps);

            const queryCall = mockDocClient.send.mock.calls[0][0];
            expect(queryCall.input.KeyConditionExpression).toContain('userId = :userId');
            expect(queryCall.input.FilterExpression).toContain('#status = :failedStatus');
            expect(queryCall.input.ExpressionAttributeValues[':failedStatus']).toBe('FailedNotification');
        });

        it('should return empty array when no failed applications exist', async () => {
            // Arrange
            const userId = 'test-user-123';

            mockDocClient.send.mockResolvedValueOnce({ Items: [] });

            // Act
            const result = await repository.getFailedNotificationApplications(userId);

            // Assert
            expect(result).toEqual([]);
        });
    });

    describe('getRetryableFailedNotifications', () => {
        it('should return only retryable failed notifications', async () => {
            // Arrange
            const userId = 'test-user-123';
            const allFailedApps = [
                createFailedApplication('app-1', userId, 1),  // リトライ可能
                createFailedApplication('app-2', userId, 2),  // リトライ可能
                createFailedApplication('app-3', userId, 3),  // MAX_RETRY_COUNT到達
                createFailedApplication('app-4', userId, 4)   // MAX_RETRY_COUNT超過
            ];

            mockDocClient.send.mockResolvedValueOnce({ Items: allFailedApps });

            // Act
            const result = await repository.getRetryableFailedNotifications(userId);

            // Assert
            expect(result).toHaveLength(2);
            expect(result[0].sk).toBe('APPLICATION#app-1');
            expect(result[1].sk).toBe('APPLICATION#app-2');

            // failureCount < MAX_RETRY_COUNT のもののみ返される
            result.forEach(app => {
                expect(app.failureCount || 0).toBeLessThan(MAX_RETRY_COUNT);
            });
        });

        it('should handle applications without failureCount', async () => {
            // Arrange
            const userId = 'test-user-123';
            const appsWithoutFailureCount = [
                createFailedApplication('app-1', userId, 0, { failureCount: undefined }),
                createFailedApplication('app-2', userId, 1)
            ];

            mockDocClient.send.mockResolvedValueOnce({ Items: appsWithoutFailureCount });

            // Act
            const result = await repository.getRetryableFailedNotifications(userId);

            // Assert
            expect(result).toHaveLength(2);
            // failureCount が undefined の場合は 0 として扱われリトライ可能
        });
    });

    describe('getFailureStatistics', () => {
        it('should calculate failure statistics correctly', async () => {
            // Arrange
            const userId = 'test-user-123';
            const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1時間前
            const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();   // 48時間前

            const failedApps = [
                createFailedApplication('app-1', userId, 1, { lastFailedAt: recentTime }),   // リトライ可能、最近
                createFailedApplication('app-2', userId, 2, { lastFailedAt: oldTime }),      // リトライ可能、古い
                createFailedApplication('app-3', userId, 3, { lastFailedAt: recentTime }),   // 最大リトライ到達、最近
                createFailedApplication('app-4', userId, 4, { lastFailedAt: oldTime })       // 最大リトライ超過、古い
            ];

            mockDocClient.send.mockResolvedValueOnce({ Items: failedApps });

            // Act
            const result = await repository.getFailureStatistics(userId);

            // Assert
            expect(result).toEqual({
                totalFailures: 4,
                retryableFailures: 2,      // failureCount < 3
                maxRetryExceeded: 2,       // failureCount >= 3
                recentFailures: 2          // 24時間以内
            });
        });
    });

    describe('generateFailureReport', () => {
        it('should generate detailed failure report for specific user', async () => {
            // Arrange
            const userId = 'test-user-123';
            const failedApps = [
                createFailedApplication('app-1', userId, 1),
                createFailedApplication('app-2', userId, 2),
                createFailedApplication('app-3', userId, 4) // MAX_RETRY_COUNT超過
            ];

            mockDocClient.send.mockResolvedValueOnce({ Items: failedApps });

            // Act
            const result = await repository.generateFailureReport(userId);

            // Assert
            expect(result.summary).toEqual({
                totalFailed: 3,
                retryable: 2,
                nonRetryable: 1,
                avgFailureCount: (1 + 2 + 4) / 3 // 2.33...
            });

            expect(result.applications).toHaveLength(3);
            expect(result.applications[0]).toMatchObject({
                userId,
                applicationSK: 'APPLICATION#app-1',
                eaName: 'TestEA',
                email: 'test@example.com',
                failureCount: 1,
                lastFailureReason: 'SMTP timeout error',
                lastFailedAt: '2025-01-01T01:00:00Z',
                isRetryable: true
            });

            expect(result.applications[2].isRetryable).toBe(false); // failureCount: 4 >= MAX_RETRY_COUNT
        });

        it('should generate failure report for all users when no userId provided', async () => {
            // Arrange
            const allUsersFailedApps = [
                createFailedApplication('app-1', 'user-1', 1),
                createFailedApplication('app-2', 'user-2', 3),
                createFailedApplication('app-3', 'user-1', 2)
            ];

            mockDocClient.send.mockResolvedValueOnce({ Items: allUsersFailedApps });

            // Act
            const result = await repository.generateFailureReport();

            // Assert
            expect(result.summary.totalFailed).toBe(3);
            expect(result.summary.retryable).toBe(2); // user-1: 2個、user-2: 0個
            expect(result.summary.nonRetryable).toBe(1);

            expect(result.applications).toHaveLength(3);
            expect(result.applications.map(app => app.userId)).toEqual(['user-1', 'user-2', 'user-1']);

            // getAllFailedNotificationApplications が呼ばれる
            const queryCall = mockDocClient.send.mock.calls[0][0];
            expect(queryCall.input.IndexName).toBe('StatusIndex');
        });
    });

    describe('エラーハンドリング', () => {
        it('should handle DynamoDB errors in retryFailedNotification', async () => {
            // Arrange
            const userId = 'test-user-123';
            const applicationSK = 'APPLICATION#test';

            mockDocClient.send.mockRejectedValueOnce(new Error('DynamoDB error'));

            // Act & Assert
            await expect(
                repository.retryFailedNotification(userId, applicationSK, 'Test')
            ).rejects.toThrow('DynamoDB error');
        });

        it('should handle DynamoDB errors in failure statistics', async () => {
            // Arrange
            const userId = 'test-user-123';

            mockDocClient.send.mockRejectedValueOnce(new Error('Query failed'));

            // Act & Assert
            await expect(
                repository.getFailureStatistics(userId)
            ).rejects.toThrow('Query failed');
        });
    });
});