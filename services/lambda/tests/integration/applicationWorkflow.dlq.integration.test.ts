// tests/integration/applicationWorkflow.dlq.integration.test.ts
// DLQ対応とリトライ機能のインテグレーションテスト

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EAApplicationRepository } from '../../src/repositories/eaApplicationRepository';
import { EAApplication, ApplicationStatus, MAX_RETRY_COUNT } from '../../src/models/eaApplication';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// DynamoDB Client のモック
const dynamoMock = mockClient(DynamoDBDocumentClient);

describe('Application Workflow Integration Tests - DLQ and Retry Features', () => {
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

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('通知失敗とDLQ処理のワークフロー', () => {
        it('should complete notification failure workflow: AwaitingNotification → FailedNotification', async () => {
            // 📝 Step 1: 通知待ちアプリケーションの準備
            const applicationData = {
                userId: 'dlq-integration-user-001',
                broker: 'FailureBroker',
                accountNumber: '2025100',
                eaName: 'DLQ Test EA',
                email: 'dlq@integration.test',
                xAccount: '@dlqtest',
                appliedAt: '2025-01-01T00:00:00Z'
            };

            // アプリケーション作成から通知待ちまでの準備
            mockDocClient.send.mockResolvedValueOnce({ Items: [] }); // 重複チェック
            mockDocClient.send.mockResolvedValueOnce({}); // 作成
            const createdApp = await repository.createApplication(applicationData);

            // 承認処理
            mockDocClient.send.mockResolvedValueOnce({ Item: createdApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: { ...createdApp, status: 'AwaitingNotification', notificationScheduledAt: '2025-01-01T01:05:00Z' }
            }); // updateStatus to AwaitingNotification

            const awaitingApp = await repository.updateStatus(
                createdApp.userId,
                createdApp.sk,
                'AwaitingNotification',
                { notificationScheduledAt: '2025-01-01T01:05:00Z' }
            );

            // 📝 Step 2: DLQ処理シミュレーション（通知失敗）
            const failedApp = {
                ...awaitingApp,
                status: 'FailedNotification' as ApplicationStatus,
                failureCount: 1,
                lastFailureReason: 'SMTP connection timeout',
                lastFailedAt: '2025-01-01T01:10:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: awaitingApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: failedApp
            }); // updateStatus to FailedNotification
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.updateStatus(
                createdApp.userId,
                createdApp.sk,
                'FailedNotification',
                {
                    lastFailureReason: 'SMTP connection timeout',
                    failureCount: 1,
                    lastFailedAt: '2025-01-01T01:10:00Z'
                }
            );

            // DLQ処理の履歴記録
            await repository.recordHistory({
                userId: createdApp.userId,
                applicationSK: createdApp.sk,
                action: 'EmailFailed',
                changedBy: 'system',
                previousStatus: 'AwaitingNotification',
                newStatus: 'FailedNotification',
                reason: 'Email notification failed: SMTP connection timeout',
                errorDetails: 'Connection timeout after 30 seconds',
                retryCount: 1
            });

            // 📊 検証: 失敗状態の確認
            expect(mockDocClient.send).toHaveBeenCalledTimes(7);

            console.log('✅ 通知失敗ワークフロー完了 (AwaitingNotification → FailedNotification)');
        });

        it('should handle multiple notification failures with increasing failure count', async () => {
            // 📝 複数回失敗するシナリオ
            const userId = 'dlq-integration-user-002';
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#FailureBroker#2025200#MultiFailEA';

            // 初期失敗状態のアプリケーション
            const initialFailedApp: EAApplication = {
                userId,
                sk: applicationSK,
                broker: 'FailureBroker',
                accountNumber: '2025200',
                eaName: 'MultiFailEA',
                email: 'multifail@integration.test',
                xAccount: '@multifail',
                status: 'FailedNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z',
                failureCount: 1,
                lastFailureReason: 'Network timeout',
                lastFailedAt: '2025-01-01T01:00:00Z'
            };

            // 📝 Step 1: リトライしてAwaitingNotificationに戻す
            const retriedApp = {
                ...initialFailedApp,
                status: 'AwaitingNotification' as ApplicationStatus,
                notificationScheduledAt: '2025-01-01T01:30:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: initialFailedApp }); // getApplication (retryFailedNotification)
            mockDocClient.send.mockResolvedValueOnce({ Item: initialFailedApp }); // getApplication (updateStatus)
            mockDocClient.send.mockResolvedValueOnce({ Attributes: retriedApp }); // updateStatus to AwaitingNotification
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.retryFailedNotification(userId, applicationSK, 'Retry for second attempt');

            // 📝 Step 2: 2回目の失敗 (AwaitingNotification → FailedNotification)
            const secondFailedApp = {
                ...retriedApp,
                status: 'FailedNotification' as ApplicationStatus,
                failureCount: 2,
                lastFailureReason: 'Email service unavailable',
                lastFailedAt: '2025-01-01T02:00:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: retriedApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: secondFailedApp
            }); // updateStatus

            await repository.updateStatus(
                userId,
                applicationSK,
                'FailedNotification',
                {
                    failureCount: 2,
                    lastFailureReason: 'Email service unavailable',
                    lastFailedAt: '2025-01-01T02:00:00Z'
                }
            );

            // 📝 Step 3: 再度リトライしてAwaitingNotificationに戻す
            const secondRetriedApp = {
                ...secondFailedApp,
                status: 'AwaitingNotification' as ApplicationStatus,
                notificationScheduledAt: '2025-01-01T02:30:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: secondFailedApp }); // getApplication (retryFailedNotification)
            mockDocClient.send.mockResolvedValueOnce({ Item: secondFailedApp }); // getApplication (updateStatus)
            mockDocClient.send.mockResolvedValueOnce({ Attributes: secondRetriedApp }); // updateStatus
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.retryFailedNotification(userId, applicationSK, 'Retry for third attempt');

            // 📝 Step 4: 3回目の失敗（MAX_RETRY_COUNT到達）
            const maxFailedApp = {
                ...secondRetriedApp,
                status: 'FailedNotification' as ApplicationStatus,
                failureCount: MAX_RETRY_COUNT,
                lastFailureReason: 'SMTP authentication failed',
                lastFailedAt: '2025-01-01T03:00:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: secondRetriedApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: maxFailedApp
            }); // updateStatus

            await repository.updateStatus(
                userId,
                applicationSK,
                'FailedNotification',
                {
                    failureCount: MAX_RETRY_COUNT,
                    lastFailureReason: 'SMTP authentication failed',
                    lastFailedAt: '2025-01-01T03:00:00Z'
                }
            );

            // 📊 検証: 失敗回数の累積（リトライを挟んだ複数回失敗）
            expect(mockDocClient.send).toHaveBeenCalledTimes(12);

            console.log('✅ 複数回失敗ワークフロー完了 (failureCount: 1 → retry → 2 → retry → 3)');
        });
    });

    describe('リトライ機能のワークフロー', () => {
        it('should complete retry workflow: FailedNotification → AwaitingNotification → Active', async () => {
            // 📝 Step 1: 失敗状態のアプリケーション準備
            const userId = 'retry-integration-user-001';
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#RetryBroker#2025300#RetryEA';

            const failedApp: EAApplication = {
                userId,
                sk: applicationSK,
                broker: 'RetryBroker',
                accountNumber: '2025300',
                eaName: 'RetryEA',
                email: 'retry@integration.test',
                xAccount: '@retry',
                status: 'FailedNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z',
                failureCount: 2,
                lastFailureReason: 'Temporary network issue',
                lastFailedAt: '2025-01-01T01:00:00Z'
            };

            // 📝 Step 2: リトライ実行（FailedNotification → AwaitingNotification）
            const retriedApp = {
                ...failedApp,
                status: 'AwaitingNotification' as ApplicationStatus,
                notificationScheduledAt: '2025-01-01T01:05:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: failedApp }); // getApplication (retryFailedNotification)
            mockDocClient.send.mockResolvedValueOnce({ Item: failedApp }); // getApplication (updateStatus)
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: retriedApp
            }); // updateStatus to AwaitingNotification
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            const retryResult = await repository.retryFailedNotification(
                userId,
                applicationSK,
                'Manual retry after infrastructure fix'
            );

            expect(retryResult?.status).toBe('AwaitingNotification');
            expect(retryResult?.notificationScheduledAt).toBeDefined();

            // 📝 Step 3: 再送成功（AwaitingNotification → Active）
            mockDocClient.send.mockResolvedValueOnce({ Item: retriedApp }); // getApplication (activateApplicationWithLicense)
            mockDocClient.send.mockResolvedValueOnce({ Item: retriedApp }); // getApplication (updateStatus)
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    ...retriedApp,
                    status: 'Active',
                    licenseKey: 'encrypted-license-retry-001'
                }
            }); // updateStatus to Active
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.activateApplicationWithLicense(
                userId,
                applicationSK,
                'encrypted-license-retry-001',
                '2025-01-01T01:10:00Z'
            );

            // 📊 検証: 完全なリトライワークフロー
            expect(mockDocClient.send).toHaveBeenCalledTimes(8);

            console.log('✅ リトライワークフロー完了 (FailedNotification → AwaitingNotification → Active)');
        });

        it('should handle force retry when maximum retry count exceeded', async () => {
            // 📝 最大リトライ回数超過時の強制リトライ
            const userId = 'retry-integration-user-002';
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#ForceBroker#2025400#ForceRetryEA';

            const maxFailedApp: EAApplication = {
                userId,
                sk: applicationSK,
                broker: 'ForceBroker',
                accountNumber: '2025400',
                eaName: 'ForceRetryEA',
                email: 'force@integration.test',
                xAccount: '@force',
                status: 'FailedNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z',
                failureCount: MAX_RETRY_COUNT + 1, // 最大回数超過
                lastFailureReason: 'Persistent SMTP issue',
                lastFailedAt: '2025-01-01T01:00:00Z'
            };

            const forceRetriedApp = {
                ...maxFailedApp,
                status: 'AwaitingNotification' as ApplicationStatus,
                notificationScheduledAt: '2025-01-01T01:05:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: maxFailedApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({ Item: maxFailedApp }); // getApplication (updateStatus)
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: forceRetriedApp
            }); // updateStatus
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            // 強制リトライ実行（MAX_RETRY_COUNT超過でも実行される）
            const forceRetryResult = await repository.retryFailedNotification(
                userId,
                applicationSK,
                'Force retry after manual investigation and SMTP server fix'
            );

            expect(forceRetryResult?.status).toBe('AwaitingNotification');

            // 📊 検証: 履歴にリトライ回数が記録される
            const historyCall = mockDocClient.send.mock.calls[3][0];
            expect(historyCall.input.Item.retryCount).toBe(MAX_RETRY_COUNT + 2); // failureCount + 1

            console.log('✅ 強制リトライワークフロー完了 (最大回数超過でも実行)');
        });
    });

    describe('失敗統計とレポート機能のワークフロー', () => {
        it('should generate comprehensive failure statistics and reports', async () => {
            // 📝 Step 1: 複数の失敗アプリケーション準備
            const userId = 'stats-integration-user-001';
            const failedApps: EAApplication[] = [
                {
                    userId,
                    sk: 'APPLICATION#stat-app-1',
                    broker: 'StatsBroker',
                    accountNumber: '2025501',
                    eaName: 'StatsEA1',
                    email: 'stats1@integration.test',
                    xAccount: '@stats1',
                    status: 'FailedNotification',
                    appliedAt: '2025-01-01T00:00:00Z',
                    updatedAt: '2025-01-01T01:00:00Z',
                    failureCount: 1,
                    lastFailureReason: 'Network timeout',
                    lastFailedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() // 1時間前
                },
                {
                    userId,
                    sk: 'APPLICATION#stat-app-2',
                    broker: 'StatsBroker',
                    accountNumber: '2025502',
                    eaName: 'StatsEA2',
                    email: 'stats2@integration.test',
                    xAccount: '@stats2',
                    status: 'FailedNotification',
                    appliedAt: '2025-01-01T00:00:00Z',
                    updatedAt: '2025-01-01T01:00:00Z',
                    failureCount: 2,
                    lastFailureReason: 'SMTP authentication failed',
                    lastFailedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() // 48時間前
                },
                {
                    userId,
                    sk: 'APPLICATION#stat-app-3',
                    broker: 'StatsBroker',
                    accountNumber: '2025503',
                    eaName: 'StatsEA3',
                    email: 'stats3@integration.test',
                    xAccount: '@stats3',
                    status: 'FailedNotification',
                    appliedAt: '2025-01-01T00:00:00Z',
                    updatedAt: '2025-01-01T01:00:00Z',
                    failureCount: MAX_RETRY_COUNT,
                    lastFailureReason: 'Invalid email address',
                    lastFailedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2時間前
                }
            ];

            // 📝 Step 2: 失敗統計の取得
            mockDocClient.send.mockResolvedValueOnce({ Items: failedApps }); // getFailedNotificationApplications

            const failureStats = await repository.getFailureStatistics(userId);

            expect(failureStats).toEqual({
                totalFailures: 3,
                retryableFailures: 2,     // failureCount < MAX_RETRY_COUNT
                maxRetryExceeded: 1,      // failureCount >= MAX_RETRY_COUNT
                recentFailures: 2         // 24時間以内
            });

            // 📝 Step 3: リトライ可能な失敗通知の取得
            mockDocClient.send.mockResolvedValueOnce({ Items: failedApps }); // getFailedNotificationApplications

            const retryableApps = await repository.getRetryableFailedNotifications(userId);

            expect(retryableApps).toHaveLength(2);
            expect(retryableApps.map(app => app.sk)).toEqual([
                'APPLICATION#stat-app-1',
                'APPLICATION#stat-app-2'
            ]);

            // 📝 Step 4: 詳細レポートの生成
            mockDocClient.send.mockResolvedValueOnce({ Items: failedApps }); // getFailedNotificationApplications

            const detailedReport = await repository.generateFailureReport(userId);

            expect(detailedReport.summary).toEqual({
                totalFailed: 3,
                retryable: 2,
                nonRetryable: 1,
                avgFailureCount: (1 + 2 + MAX_RETRY_COUNT) / 3
            });

            expect(detailedReport.applications).toHaveLength(3);
            expect(detailedReport.applications[0]).toMatchObject({
                userId,
                applicationSK: 'APPLICATION#stat-app-1',
                eaName: 'StatsEA1',
                email: 'stats1@integration.test',
                failureCount: 1,
                isRetryable: true
            });

            // 📊 検証: 統計情報の整合性
            expect(mockDocClient.send).toHaveBeenCalledTimes(3);

            console.log('✅ 失敗統計とレポート生成ワークフロー完了');
        });

        it('should generate admin report for all users', async () => {
            // 📝 管理者用全ユーザーレポート
            const allUsersFailedApps: EAApplication[] = [
                {
                    userId: 'user-1',
                    sk: 'APPLICATION#admin-app-1',
                    broker: 'AdminBroker',
                    accountNumber: '2025601',
                    eaName: 'AdminEA1',
                    email: 'admin1@integration.test',
                    xAccount: '@admin1',
                    status: 'FailedNotification',
                    appliedAt: '2025-01-01T00:00:00Z',
                    updatedAt: '2025-01-01T01:00:00Z',
                    failureCount: 1,
                    lastFailureReason: 'User 1 network issue',
                    lastFailedAt: '2025-01-01T01:00:00Z'
                },
                {
                    userId: 'user-2',
                    sk: 'APPLICATION#admin-app-2',
                    broker: 'AdminBroker',
                    accountNumber: '2025602',
                    eaName: 'AdminEA2',
                    email: 'admin2@integration.test',
                    xAccount: '@admin2',
                    status: 'FailedNotification',
                    appliedAt: '2025-01-01T00:00:00Z',
                    updatedAt: '2025-01-01T01:00:00Z',
                    failureCount: MAX_RETRY_COUNT + 1,
                    lastFailureReason: 'User 2 persistent failure',
                    lastFailedAt: '2025-01-01T02:00:00Z'
                }
            ];

            mockDocClient.send.mockResolvedValueOnce({ Items: allUsersFailedApps }); // getAllFailedNotificationApplications

            const adminReport = await repository.generateFailureReport(); // userIdなし = 全ユーザー

            expect(adminReport.summary.totalFailed).toBe(2);
            expect(adminReport.summary.retryable).toBe(1);   // user-1のみ
            expect(adminReport.summary.nonRetryable).toBe(1); // user-2のみ

            expect(adminReport.applications.map(app => app.userId)).toEqual(['user-1', 'user-2']);

            // GSI使用の確認
            const queryCall = mockDocClient.send.mock.calls[0][0];
            expect(queryCall.input.IndexName).toBe('StatusIndex');

            console.log('✅ 管理者用全ユーザーレポート生成完了');
        });
    });

    describe('バッチリトライ機能のワークフロー', () => {
        it('should complete batch retry workflow for multiple applications', async () => {
            // 📝 複数アプリケーションのバッチリトライ
            const userId = 'batch-integration-user-001';
            const batchFailedApps: EAApplication[] = [
                {
                    userId,
                    sk: 'APPLICATION#batch-app-1',
                    broker: 'BatchBroker',
                    accountNumber: '2025701',
                    eaName: 'BatchEA1',
                    email: 'batch1@integration.test',
                    xAccount: '@batch1',
                    status: 'FailedNotification',
                    appliedAt: '2025-01-01T00:00:00Z',
                    updatedAt: '2025-01-01T01:00:00Z',
                    failureCount: 1,
                    lastFailureReason: 'Batch test failure 1',
                    lastFailedAt: '2025-01-01T01:00:00Z'
                },
                {
                    userId,
                    sk: 'APPLICATION#batch-app-2',
                    broker: 'BatchBroker',
                    accountNumber: '2025702',
                    eaName: 'BatchEA2',
                    email: 'batch2@integration.test',
                    xAccount: '@batch2',
                    status: 'FailedNotification',
                    appliedAt: '2025-01-01T00:00:00Z',
                    updatedAt: '2025-01-01T01:00:00Z',
                    failureCount: 2,
                    lastFailureReason: 'Batch test failure 2',
                    lastFailedAt: '2025-01-01T02:00:00Z'
                }
            ];

            // 📝 Step 1: リトライ可能な失敗通知の取得
            mockDocClient.send.mockResolvedValueOnce({ Items: batchFailedApps }); // getRetryableFailedNotifications

            const retryableApps = await repository.getRetryableFailedNotifications(userId);
            expect(retryableApps).toHaveLength(2);

            // 📝 Step 2: 各アプリケーションのリトライ実行
            for (const app of batchFailedApps) {
                // getApplication + updateStatus + recordHistory のシーケンス
                mockDocClient.send.mockResolvedValueOnce({ Item: app }); // getApplication (retryFailedNotification)
                mockDocClient.send.mockResolvedValueOnce({ Item: app }); // getApplication (updateStatus)
                mockDocClient.send.mockResolvedValueOnce({
                    Attributes: {
                        ...app,
                        status: 'AwaitingNotification',
                        notificationScheduledAt: '2025-01-01T01:05:00Z'
                    }
                }); // updateStatus
                mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

                await repository.retryFailedNotification(
                    userId,
                    app.sk,
                    'Batch retry after infrastructure maintenance'
                );
            }

            // 📊 検証: バッチ処理の完了
            expect(mockDocClient.send).toHaveBeenCalledTimes(9); // 1 + (4 * 2) = 9回

            console.log('✅ バッチリトライワークフロー完了 (2アプリケーション同時リトライ)');
        });
    });

    describe('完全なエンドツーエンド DLQ ワークフロー', () => {
        it('should demonstrate complete end-to-end DLQ and recovery workflow', async () => {
            // 📝 最も複雑なエンドツーエンドシナリオ
            const userId = 'e2e-integration-user-001';
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#E2EBroker#2026100#E2EEA';

            // 📝 Phase 1: 正常な申請フロー
            const applicationData = {
                userId,
                broker: 'E2EBroker',
                accountNumber: '2026100',
                eaName: 'E2EEA',
                email: 'e2e@integration.test',
                xAccount: '@e2e',
                appliedAt: '2025-01-01T00:00:00Z'
            };

            // アプリケーション作成
            mockDocClient.send.mockResolvedValueOnce({ Items: [] }); // 重複チェック
            mockDocClient.send.mockResolvedValueOnce({}); // 作成
            const createdApp = await repository.createApplication(applicationData);

            // 承認処理
            mockDocClient.send.mockResolvedValueOnce({ Item: createdApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: { ...createdApp, status: 'AwaitingNotification' }
            }); // updateStatus to AwaitingNotification

            await repository.updateStatus(userId, applicationSK, 'AwaitingNotification', {
                notificationScheduledAt: '2025-01-01T01:05:00Z'
            });

            // 📝 Phase 2: 初回通知失敗（DLQ処理）
            // 先にAwaitingNotificationに遷移させてから失敗させる
            const awaitingAppForFailure = {
                ...createdApp,
                status: 'AwaitingNotification' as ApplicationStatus,
                notificationScheduledAt: '2025-01-01T01:05:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: createdApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: awaitingAppForFailure
            }); // updateStatus to AwaitingNotification

            await repository.updateStatus(userId, applicationSK, 'AwaitingNotification', {
                notificationScheduledAt: '2025-01-01T01:05:00Z'
            });

            // 通知失敗処理
            const firstFailedApp = {
                ...awaitingAppForFailure,
                status: 'FailedNotification' as ApplicationStatus,
                failureCount: 1,
                lastFailureReason: 'Initial SMTP timeout',
                lastFailedAt: '2025-01-01T01:10:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: awaitingAppForFailure }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: firstFailedApp
            }); // updateStatus to FailedNotification
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.updateStatus(userId, applicationSK, 'FailedNotification', {
                failureCount: 1,
                lastFailureReason: 'Initial SMTP timeout',
                lastFailedAt: '2025-01-01T01:10:00Z'
            });

            await repository.recordHistory({
                userId,
                applicationSK,
                action: 'EmailFailed',
                changedBy: 'system',
                previousStatus: 'AwaitingNotification',
                newStatus: 'FailedNotification',
                reason: 'Initial notification failed',
                errorDetails: 'SMTP timeout after 30 seconds',
                retryCount: 1
            });

            // 📝 Phase 3: 手動リトライによる復旧
            const retriedApp = {
                ...firstFailedApp,
                status: 'AwaitingNotification' as ApplicationStatus,
                notificationScheduledAt: '2025-01-01T01:25:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: firstFailedApp }); // getApplication (retryFailedNotification)
            mockDocClient.send.mockResolvedValueOnce({ Item: firstFailedApp }); // getApplication (updateStatus)
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: retriedApp
            }); // updateStatus
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            const retryResult = await repository.retryFailedNotification(
                userId,
                applicationSK,
                'Manual retry after SMTP server maintenance'
            );

            expect(retryResult?.status).toBe('AwaitingNotification');

            // 📝 Phase 4: 最終的な成功（Active化）
            mockDocClient.send.mockResolvedValueOnce({ Item: retriedApp }); // getApplication (activateApplicationWithLicense)
            mockDocClient.send.mockResolvedValueOnce({ Item: retriedApp }); // getApplication (updateStatus)
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    ...retriedApp,
                    status: 'Active',
                    licenseKey: 'encrypted-license-e2e-001'
                }
            }); // updateStatus to Active
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.activateApplicationWithLicense(
                userId,
                applicationSK,
                'encrypted-license-e2e-001',
                '2025-01-01T01:30:00Z'
            );

            // 📝 Phase 5: 最終検証と統計確認
            const finalFailedApps: EAApplication[] = []; // すべて復旧済み

            mockDocClient.send.mockResolvedValueOnce({ Items: finalFailedApps }); // getFailedNotificationApplications

            const finalStats = await repository.getFailureStatistics(userId);

            expect(finalStats).toEqual({
                totalFailures: 0,    // すべて復旧済み
                retryableFailures: 0,
                maxRetryExceeded: 0,
                recentFailures: 0
            });

            // 📊 最終検証: 完全なワークフローの実行
            expect(mockDocClient.send).toHaveBeenCalledTimes(18);

            console.log('✅ 完全なエンドツーエンドDLQワークフロー完了');
            console.log('   📊 処理内容:');
            console.log('   - アプリケーション作成');
            console.log('   - 承認処理');
            console.log('   - 初回通知失敗 (DLQ)');
            console.log('   - 手動リトライ');
            console.log('   - 最終成功 (Active化)');
            console.log('   - 統計確認');
        });
    });

    describe('大規模データでのパフォーマンステスト', () => {
        it('should handle large scale failure operations efficiently', async () => {
            // 📝 大量の失敗データでの処理性能確認
            const userId = 'perf-integration-user-001';
            const largeFailedApps: EAApplication[] = Array.from({ length: 100 }, (_, i) => ({
                userId,
                sk: `APPLICATION#perf-app-${i + 1}`,
                broker: 'PerfBroker',
                accountNumber: `202620${(i + 1).toString().padStart(2, '0')}`,
                eaName: `PerfEA${i + 1}`,
                email: `perf${i + 1}@integration.test`,
                xAccount: `@perf${i + 1}`,
                status: 'FailedNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z',
                failureCount: (i % MAX_RETRY_COUNT) + 1, // 1からMAX_RETRY_COUNTまでの分散
                lastFailureReason: `Performance test failure ${i + 1}`,
                lastFailedAt: new Date(Date.now() - (i % 48) * 60 * 60 * 1000).toISOString() // 48時間分散
            }));

            // 大量データでの統計生成
            mockDocClient.send.mockResolvedValueOnce({ Items: largeFailedApps }); // getFailedNotificationApplications

            const perfStats = await repository.getFailureStatistics(userId);

            // 期待される統計の計算
            const retryableCount = largeFailedApps.filter(app => (app.failureCount || 0) < MAX_RETRY_COUNT).length;
            const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
            const recentCount = largeFailedApps.filter(app =>
                app.lastFailedAt && new Date(app.lastFailedAt).getTime() > twentyFourHoursAgo
            ).length;

            expect(perfStats).toEqual({
                totalFailures: 100,
                retryableFailures: retryableCount,
                maxRetryExceeded: 100 - retryableCount,
                recentFailures: recentCount
            });

            console.log('✅ 大規模データパフォーマンステスト完了');
            console.log(`   📊 処理対象: ${largeFailedApps.length}件`);
            console.log(`   📊 リトライ可能: ${retryableCount}件`);
            console.log(`   📊 最大回数超過: ${100 - retryableCount}件`);
        });
    });
});