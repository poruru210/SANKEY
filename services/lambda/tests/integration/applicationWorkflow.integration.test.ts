// tests/integration/applicationWorkflow.integration.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EAApplicationRepository } from '../../src/repositories/eaApplicationRepository';
import { EAApplication, ApplicationStatus, isTerminalStatus, calculateTTL } from '../../src/models/eaApplication';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

// DynamoDB Client のモック
const dynamoMock = mockClient(DynamoDBDocumentClient);

describe('Application Workflow Integration Tests with TTL', () => {
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

    describe('完全な承認ワークフロー: 申請 → 承認 → 通知待ち → アクティブ化（TTL対応）', () => {
        it('should complete full approval workflow successfully without TTL for non-terminal statuses', async () => {
            // 📝 Step 1: アプリケーション作成
            const applicationData = {
                userId: 'integration-user-001',
                broker: 'MetaTrader5',
                accountNumber: '2025001',
                eaName: 'SuperTrend EA',
                email: 'user@integration.test',
                xAccount: '@supertrend',
                appliedAt: '2025-01-01T00:00:00Z'
            };

            // 重複チェック: なし
            mockDocClient.send.mockResolvedValueOnce({ Items: [] });
            // 作成成功
            mockDocClient.send.mockResolvedValueOnce({});

            const createdApp = await repository.createApplication(applicationData);

            expect(createdApp.status).toBe('Pending');
            expect(createdApp.sk).toMatch(/^APPLICATION#/);
            expect(createdApp.ttl).toBeUndefined(); // TTLは設定されていない

            // 📝 Step 2: 承認処理 (Pending → Approve)
            mockDocClient.send.mockResolvedValueOnce({ Item: createdApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: { ...createdApp, status: 'Approve' }
            }); // updateStatus

            const approvedApp = await repository.updateStatus(
                createdApp.userId,
                createdApp.sk,
                'Approve',
                {
                    eaName: 'SuperTrend EA',
                    email: 'user@integration.test',
                    expiryDate: '2025-12-31T23:59:59.000Z'
                }
            );

            expect(approvedApp?.status).toBe('Approve');
            expect(approvedApp?.ttl).toBeUndefined(); // 非終了ステータスなのでTTLなし

            // 📝 Step 3: 承認履歴記録（TTLなし）
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.recordHistory({
                userId: createdApp.userId,
                applicationSK: createdApp.sk,
                action: 'Approve',
                changedBy: createdApp.userId,
                previousStatus: 'Pending',
                newStatus: 'Approve',
                reason: 'Application approved by admin'
            });

            // 📝 Step 4: 通知待ち状態への遷移 + notificationScheduledAt設定
            const notificationScheduledAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

            mockDocClient.send.mockResolvedValueOnce({ Item: approvedApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    ...approvedApp,
                    status: 'AwaitingNotification',
                    notificationScheduledAt
                }
            }); // updateStatus

            const awaitingApp = await repository.updateStatus(
                createdApp.userId,
                createdApp.sk,
                'AwaitingNotification',
                { notificationScheduledAt }
            );

            expect(awaitingApp?.status).toBe('AwaitingNotification');
            expect(awaitingApp?.notificationScheduledAt).toBeDefined();
            expect(awaitingApp?.ttl).toBeUndefined(); // 非終了ステータスなのでTTLなし

            // 📝 Step 5: 通知待ち履歴記録（TTLなし）
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.recordHistory({
                userId: createdApp.userId,
                applicationSK: createdApp.sk,
                action: 'AwaitingNotification',
                changedBy: 'system',
                previousStatus: 'Approve',
                newStatus: 'AwaitingNotification',
                reason: `License generation scheduled for ${notificationScheduledAt}`
            });

            // 📝 Step 6: ライセンス有効化 (AwaitingNotification → Active)
            mockDocClient.send.mockResolvedValueOnce({ Item: awaitingApp }); // getApplication (in activateApplicationWithLicense)
            mockDocClient.send.mockResolvedValueOnce({ Item: awaitingApp }); // getApplication (in updateStatus)
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    ...awaitingApp,
                    status: 'Active',
                    licenseKey: 'encrypted-license-key-integration-001'
                }
            }); // updateStatus
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.activateApplicationWithLicense(
                createdApp.userId,
                createdApp.sk,
                'encrypted-license-key-integration-001',
                '2025-06-05T12:00:00Z'
            );

            // 📊 検証: 全ステップの実行確認
            expect(mockDocClient.send).toHaveBeenCalledTimes(12);

            // 作成: 2回 (重複チェック + 作成)
            // 承認: 2回 (getApplication + updateStatus)
            // 承認履歴: 1回 (recordHistory)
            // 通知待ち: 2回 (getApplication + updateStatus)
            // 通知待ち履歴: 1回 (recordHistory)
            // アクティブ化: 4回 (getApplication×2 + updateStatus + recordHistory)

            console.log('✅ 完全な承認ワークフロー成功 (TTL対応・非終了ステータスはTTLなし)');
        });
    });

    describe('キャンセルワークフローでTTL設定テスト', () => {
        it('should complete cancellation workflow with TTL set for terminal status', async () => {
            // 📝 Step 1-4: 申請から通知待ちまで (notificationScheduledAt設定)
            const applicationData = {
                userId: 'integration-user-003',
                broker: 'cTrader',
                accountNumber: '2025003',
                eaName: 'Cancelled EA',
                email: 'cancelled@integration.test',
                xAccount: '@cancelled',
                appliedAt: '2025-01-01T00:00:00Z'
            };

            // 作成
            mockDocClient.send.mockResolvedValueOnce({ Items: [] });
            mockDocClient.send.mockResolvedValueOnce({});
            const createdApp = await repository.createApplication(applicationData);

            // 承認
            mockDocClient.send.mockResolvedValueOnce({ Item: createdApp });
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: { ...createdApp, status: 'Approve' }
            });
            await repository.updateStatus(createdApp.userId, createdApp.sk, 'Approve');

            // 承認履歴
            mockDocClient.send.mockResolvedValueOnce({});
            await repository.recordHistory({
                userId: createdApp.userId,
                applicationSK: createdApp.sk,
                action: 'Approve',
                changedBy: createdApp.userId,
                previousStatus: 'Pending',
                newStatus: 'Approve',
                reason: 'Application approved'
            });

            // notificationScheduledAt を5分後に設定
            const notificationScheduledAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

            // 通知待ち
            mockDocClient.send.mockResolvedValueOnce({ Item: { ...createdApp, status: 'Approve' } });
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    ...createdApp,
                    status: 'AwaitingNotification',
                    notificationScheduledAt
                }
            });
            const awaitingApp = await repository.updateStatus(
                createdApp.userId,
                createdApp.sk,
                'AwaitingNotification',
                { notificationScheduledAt }
            );

            // 📝 Step 5: キャンセル処理 (AwaitingNotification → Cancelled) - TTL設定
            const awaitingAppWithSchedule = {
                ...awaitingApp,
                notificationScheduledAt
            };

            const cancelledAppWithTTL = {
                ...awaitingAppWithSchedule,
                status: 'Cancelled' as ApplicationStatus,
                ttl: calculateTTL() // 6ヶ月後のTTL
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: awaitingAppWithSchedule }); // getApplication (in cancelApplication)
            mockDocClient.send.mockResolvedValueOnce({ Item: awaitingAppWithSchedule }); // getApplication (in updateStatus)
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: cancelledAppWithTTL
            }); // updateStatus with TTL
            mockDocClient.send.mockResolvedValueOnce({ Items: [] }); // getApplicationHistories (for setHistoryTTL)
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory with TTL

            await repository.cancelApplication(
                createdApp.userId,
                createdApp.sk,
                'Cancelled by user within notification schedule'
            );

            // 📊 検証: TTL設定の確認
            expect(mockDocClient.send).toHaveBeenCalledTimes(12);

            // updateStatusでTTL設定を確認
            const updateCall = mockDocClient.send.mock.calls[9][0]; // 10番目のcall
            expect(updateCall.input.UpdateExpression).toContain('#ttl = :ttl');
            expect(updateCall.input.ExpressionAttributeValues[':ttl']).toBeDefined();

            // recordHistoryでTTL設定を確認
            const historyCall = mockDocClient.send.mock.calls[11][0]; // 12番目のcall
            expect(historyCall.input.Item.ttl).toBeDefined();
            expect(historyCall.input.Item.newStatus).toBe('Cancelled');

            console.log('✅ キャンセルワークフロー成功 (TTL設定確認)');
        });

        it('should validate TTL calculation for cancelled applications', async () => {
            // TTL計算のテスト
            const now = new Date('2025-01-01T00:00:00Z');
            const ttl = calculateTTL(now.toISOString());

            // 6ヶ月後の日付を確認
            const expectedDate = new Date('2025-07-01T00:00:00Z');
            const expectedTTL = Math.floor(expectedDate.getTime() / 1000);

            expect(ttl).toBeGreaterThanOrEqual(expectedTTL - 86400); // 1日の誤差許容
            expect(ttl).toBeLessThanOrEqual(expectedTTL + 86400);

            // TTLが現在時刻より未来であることを確認
            const currentTTL = Math.floor(Date.now() / 1000);
            expect(ttl).toBeGreaterThan(currentTTL);

            console.log('✅ TTL計算テスト成功');
        });
    });

    describe('拒否ワークフローでTTL設定テスト', () => {
        it('should complete rejection workflow with TTL set', async () => {
            // 📝 Step 1: アプリケーション作成
            const applicationData = {
                userId: 'integration-user-002',
                broker: 'MetaTrader4',
                accountNumber: '2025002',
                eaName: 'Rejected EA',
                email: 'rejected@integration.test',
                xAccount: '@rejected',
                appliedAt: '2025-01-01T00:00:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Items: [] }); // 重複チェック
            mockDocClient.send.mockResolvedValueOnce({}); // 作成

            const createdApp = await repository.createApplication(applicationData);
            expect(createdApp.status).toBe('Pending');
            expect(createdApp.ttl).toBeUndefined(); // 初期状態はTTLなし

            // 📝 Step 2: 拒否処理 (Pending → Rejected) - TTL設定
            const rejectedAppWithTTL = {
                ...createdApp,
                status: 'Rejected' as ApplicationStatus,
                ttl: calculateTTL()
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: createdApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: rejectedAppWithTTL
            }); // updateStatus with TTL

            const rejectedApp = await repository.updateStatus(
                createdApp.userId,
                createdApp.sk,
                'Rejected'
            );

            expect(rejectedApp?.status).toBe('Rejected');
            expect(rejectedApp?.ttl).toBeDefined(); // TTLが設定されている

            // 📝 Step 3: 拒否履歴記録（TTL付き）
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.recordHistory({
                userId: createdApp.userId,
                applicationSK: createdApp.sk,
                action: 'Rejected',
                changedBy: createdApp.userId,
                previousStatus: 'Pending',
                newStatus: 'Rejected',
                reason: 'Application rejected by administrator'
            });

            // 📊 検証
            expect(mockDocClient.send).toHaveBeenCalledTimes(5);

            // updateStatusでTTL設定を確認
            const updateCall = mockDocClient.send.mock.calls[3][0];
            expect(updateCall.input.UpdateExpression).toContain('#ttl = :ttl');

            // recordHistoryでTTL設定を確認
            const historyCall = mockDocClient.send.mock.calls[4][0];
            expect(historyCall.input.Item.ttl).toBeDefined();

            console.log('✅ 拒否ワークフロー成功 (TTL設定)');
        });
    });

    describe('無効化ワークフローでTTL設定テスト', () => {
        it('should complete revocation workflow with TTL set', async () => {
            // 📝 Setup: アクティブなアプリケーション
            const activeApp: EAApplication = {
                userId: 'integration-user-004',
                sk: 'APPLICATION#2025-01-01T00:00:00Z#MetaTrader5#2025004#Revoked EA',
                broker: 'MetaTrader5',
                accountNumber: '2025004',
                eaName: 'Revoked EA',
                email: 'revoked@integration.test',
                xAccount: '@revoked',
                status: 'Active',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T12:00:00Z',
                licenseKey: 'encrypted-license-key-004'
            };

            // 📝 Step 1: 無効化処理 (Active → Revoked) - TTL設定
            const revokedAppWithTTL = {
                ...activeApp,
                status: 'Revoked' as ApplicationStatus,
                ttl: calculateTTL()
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: activeApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: revokedAppWithTTL
            }); // updateStatus with TTL

            const revokedApp = await repository.updateStatus(
                activeApp.userId,
                activeApp.sk,
                'Revoked'
            );

            expect(revokedApp?.status).toBe('Revoked');
            expect(revokedApp?.ttl).toBeDefined(); // TTLが設定されている

            // 📝 Step 2: 無効化履歴記録（TTL付き）
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.recordHistory({
                userId: activeApp.userId,
                applicationSK: activeApp.sk,
                action: 'Revoked',
                changedBy: activeApp.userId,
                previousStatus: 'Active',
                newStatus: 'Revoked',
                reason: 'Security violation detected'
            });

            // 📊 検証
            expect(mockDocClient.send).toHaveBeenCalledTimes(3);

            // updateStatusでTTL設定を確認
            const updateCall = mockDocClient.send.mock.calls[1][0];
            expect(updateCall.input.UpdateExpression).toContain('#ttl = :ttl');

            // recordHistoryでTTL設定を確認
            const historyCall = mockDocClient.send.mock.calls[2][0];
            expect(historyCall.input.Item.ttl).toBeDefined();

            console.log('✅ 無効化ワークフロー成功 (TTL設定)');
        });
    });

    describe('期限切れワークフローでTTL設定テスト', () => {
        it('should complete expiration workflow with TTL set', async () => {
            // 📝 Setup: アクティブなアプリケーション
            const activeApp: EAApplication = {
                userId: 'integration-user-005',
                sk: 'APPLICATION#2025-01-01T00:00:00Z#MetaTrader5#2025005#Expired EA',
                broker: 'MetaTrader5',
                accountNumber: '2025005',
                eaName: 'Expired EA',
                email: 'expired@integration.test',
                xAccount: '@expired',
                status: 'Active',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T12:00:00Z',
                licenseKey: 'encrypted-license-key-005',
                expiryDate: '2025-06-01T00:00:00Z'
            };

            // 📝 期限切れ処理テスト
            const expiredAppWithTTL = {
                ...activeApp,
                status: 'Expired' as ApplicationStatus,
                ttl: calculateTTL()
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: activeApp }); // getApplication (in updateStatus)
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: expiredAppWithTTL
            }); // updateStatus with TTL
            mockDocClient.send.mockResolvedValueOnce({ Items: [] }); // getApplicationHistories (empty)
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.expireApplication(
                activeApp.userId,
                activeApp.sk
            );

            // 📊 検証
            expect(mockDocClient.send).toHaveBeenCalledTimes(4);

            // updateStatusでTTL設定を確認
            const updateCall = mockDocClient.send.mock.calls[1][0];
            expect(updateCall.input.UpdateExpression).toContain('#ttl = :ttl');
            expect(updateCall.input.ExpressionAttributeValues[':newStatus']).toBe('Expired');

            // recordHistoryでTTL設定を確認
            const historyCall = mockDocClient.send.mock.calls[3][0];
            expect(historyCall.input.Item.action).toBe('SystemExpired');
            expect(historyCall.input.Item.newStatus).toBe('Expired');
            expect(historyCall.input.Item.ttl).toBeDefined();

            console.log('✅ 期限切れワークフロー成功 (TTL設定)');
        });
    });

    describe('TTL設定統合テスト', () => {
        it('should demonstrate TTL behavior for all terminal statuses', async () => {
            const terminalStatuses: ApplicationStatus[] = ['Expired', 'Revoked', 'Rejected', 'Cancelled'];

            for (const terminalStatus of terminalStatuses) {
                // 各終了ステータスがTTL設定対象であることを確認
                expect(isTerminalStatus(terminalStatus)).toBe(true);
            }

            const nonTerminalStatuses: ApplicationStatus[] = ['Pending', 'Approve', 'AwaitingNotification', 'Active'];

            for (const nonTerminalStatus of nonTerminalStatuses) {
                // 各非終了ステータスがTTL設定対象外であることを確認
                expect(isTerminalStatus(nonTerminalStatus)).toBe(false);
            }

            console.log('✅ TTL設定対象ステータスの確認完了');
        });

        it('should verify TTL inheritance in history records', async () => {
            // 履歴レコードのTTL継承テスト
            const userId = 'ttl-history-user';
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#TTLBroker#2025001#TTL EA';

            // 終了ステータスの履歴記録
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.recordHistory({
                userId,
                applicationSK,
                action: 'Cancelled',
                changedBy: userId,
                previousStatus: 'AwaitingNotification',
                newStatus: 'Cancelled',
                reason: 'TTL test cancellation'
            });

            // 📊 検証: 履歴にTTLが設定されている
            const historyCall = mockDocClient.send.mock.calls[0][0];
            expect(historyCall.input.Item.ttl).toBeDefined();
            expect(historyCall.input.Item.newStatus).toBe('Cancelled');

            // 非終了ステータスの履歴記録
            mockDocClient.send.mockResolvedValueOnce({}); // recordHistory

            await repository.recordHistory({
                userId,
                applicationSK,
                action: 'Approve',
                changedBy: userId,
                previousStatus: 'Pending',
                newStatus: 'Approve',
                reason: 'TTL test approval'
            });

            // 📊 検証: 履歴にTTLが設定されていない
            const nonTerminalHistoryCall = mockDocClient.send.mock.calls[1][0];
            expect(nonTerminalHistoryCall.input.Item.ttl).toBeUndefined();
            expect(nonTerminalHistoryCall.input.Item.newStatus).toBe('Approve');

            console.log('✅ 履歴レコードTTL継承テスト成功');
        });
    });

    describe('エラーハンドリング統合テスト（TTL対応）', () => {
        it('should handle workflow errors gracefully with TTL considerations', async () => {
            // 📝 シナリオ: 承認処理中にエラー
            const applicationData = {
                userId: 'integration-user-006',
                broker: 'ErrorBroker',
                accountNumber: '2025006',
                eaName: 'Error EA',
                email: 'error@integration.test',
                xAccount: '@error',
                appliedAt: '2025-01-01T00:00:00Z'
            };

            // 作成成功
            mockDocClient.send.mockResolvedValueOnce({ Items: [] });
            mockDocClient.send.mockResolvedValueOnce({});
            const createdApp = await repository.createApplication(applicationData);

            // 承認処理でエラー
            mockDocClient.send.mockResolvedValueOnce({ Item: createdApp });
            mockDocClient.send.mockRejectedValueOnce(new Error('DynamoDB update failed'));

            // 📊 検証: エラーが適切に伝播される
            await expect(
                repository.updateStatus(createdApp.userId, createdApp.sk, 'Approve')
            ).rejects.toThrow('DynamoDB update failed');

            console.log('✅ エラーハンドリング確認（TTL対応）');
        });

        it('should handle invalid status transitions with TTL considerations', async () => {
            // 📝 シナリオ: 無効なステータス遷移
            const cancelledApp: EAApplication = {
                userId: 'integration-user-007',
                sk: 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#2025007#Invalid EA',
                broker: 'TestBroker',
                accountNumber: '2025007',
                eaName: 'Invalid EA',
                email: 'invalid@integration.test',
                xAccount: '@invalid',
                status: 'Cancelled', // キャンセル済み（TTL設定済み）
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T12:00:00Z',
                ttl: calculateTTL()
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: cancelledApp });

            // 📊 検証: キャンセル済みからアクティブへの遷移は無効
            await expect(
                repository.updateStatus(cancelledApp.userId, cancelledApp.sk, 'Active')
            ).rejects.toThrow('Invalid status transition: Cancelled -> Active');

            console.log('✅ 無効なステータス遷移の検出（TTL設定済みレコード）');
        });
    });

    describe('手動TTL調整機能テスト', () => {
        it('should allow manual TTL adjustment', async () => {
            // 📝 手動TTL調整のテスト
            const userId = 'manual-ttl-user';
            const sk = 'APPLICATION#2025-01-01T00:00:00Z#ManualBroker#2025001#Manual EA';

            mockDocClient.send.mockResolvedValueOnce({}); // UpdateCommand for TTL adjustment

            // 3ヶ月でTTL調整
            await repository.adjustTTL(userId, sk, 3);

            // 📊 検証
            expect(mockDocClient.send).toHaveBeenCalledTimes(1);

            const updateCall = mockDocClient.send.mock.calls[0][0];
            expect(updateCall.input.UpdateExpression).toBe('SET #ttl = :ttl');
            expect(updateCall.input.ExpressionAttributeNames['#ttl']).toBe('ttl');
            expect(updateCall.input.ExpressionAttributeValues[':ttl']).toBeDefined();

            console.log('✅ 手動TTL調整機能テスト成功');
        });
    });
});