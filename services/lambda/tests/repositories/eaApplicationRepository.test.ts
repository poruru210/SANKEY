// tests/repositories/eaApplicationRepository.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestContainer } from '../di/testContainer';
import { EAApplicationRepository } from '../../src/repositories/eaApplicationRepository';
import { EAApplication, ApplicationStatus, HistoryAction, isTerminalStatus, calculateTTL } from '../../src/models/eaApplication';
import { PutCommand, UpdateCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { AwilixContainer } from 'awilix';
import type { DIContainer } from '../../src/types/dependencies';

// モッククライアントの型定義
interface MockCall {
    [0]: {
        constructor: { name: string };
        input?: {
            UpdateExpression?: string;
            ExpressionAttributeValues?: Record<string, any>;
            [key: string]: any;
        };
        [key: string]: any;
    };
}

// ヘルパー関数
function getUpdateCommandsWithTTL(mockCalls: MockCall[]): MockCall[] {
    return mockCalls.filter(call =>
        call[0].constructor.name === 'UpdateCommand' &&
        call[0].input?.UpdateExpression?.includes('#ttl = :ttl')
    );
}

function findUpdateCommandAt(mockCalls: MockCall[], index: number): MockCall | undefined {
    return mockCalls[index];
}

describe('EAApplicationRepository (DI対応)', () => {
    let container: AwilixContainer<DIContainer>;
    let repository: EAApplicationRepository;
    let mockDocClient: any;

    beforeEach(() => {
        // テストコンテナから依存関係を取得
        container = createTestContainer();
        repository = container.resolve('eaApplicationRepository');
        mockDocClient = container.resolve('docClient');

        // sendメソッドをモック
        mockDocClient.send = vi.fn();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('DIコンテナからの解決', () => {
        it('サービスがDIコンテナから正しく解決されること', () => {
            expect(repository).toBeDefined();
            expect(repository).toBeInstanceOf(EAApplicationRepository);
        });

        it('docClientが注入されていること', () => {
            // @ts-expect-error - private propertyへのアクセス
            expect(repository.docClient).toBeDefined();
        });

        it('loggerが注入されていること', () => {
            // @ts-expect-error - private propertyへのアクセス
            expect(repository.logger).toBeDefined();
        });

        it('tableNameが注入されていること', () => {
            // @ts-expect-error - private propertyへのアクセス
            expect(repository.tableName).toBeDefined();
            // @ts-expect-error - private propertyへのアクセス
            expect(repository.tableName).toBe('test-ea-applications');
        });
    });

    describe('createApplication', () => {
        it('新しいアプリケーションを正常に作成できること', async () => {
            // Arrange
            const applicationData = {
                userId: 'test-user-123',
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'Test EA',
                email: 'test@example.com',
                xAccount: '@test_account',
                appliedAt: '2025-01-01T00:00:00Z'
            };

            // 重複チェックで何も見つからない
            mockDocClient.send.mockResolvedValueOnce({ Items: [] });
            // 作成成功
            mockDocClient.send.mockResolvedValueOnce({});

            // Act
            const result = await repository.createApplication(applicationData);

            // Assert
            expect(result).toMatchObject({
                userId: 'test-user-123',
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'Test EA',
                status: 'Pending'
            });
            expect(result.sk).toMatch(/^APPLICATION#/);
            expect(result.ttl).toBeUndefined(); // 初期状態はTTLなし
            expect(mockDocClient.send).toHaveBeenCalledTimes(2);
        });

        it('アクティブなアプリケーションが既に存在する場合はエラーをスローすること', async () => {
            // Arrange
            const applicationData = {
                userId: 'test-user-123',
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'Test EA',
                email: 'test@example.com',
                xAccount: '@test_account',
                appliedAt: '2025-01-01T00:00:00Z'
            };

            const existingApp = {
                userId: 'test-user-123',
                sk: 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#Test EA',
                status: 'Active',
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'Test EA'
            };

            mockDocClient.send.mockResolvedValueOnce({ Items: [existingApp] });

            // Act & Assert
            await expect(repository.createApplication(applicationData))
                .rejects.toThrow('Active application already exists');
        });
    });

    describe('TTLヘルパー関数', () => {
        it('終了ステータスを正しく識別できること', () => {
            expect(isTerminalStatus('Expired')).toBe(true);
            expect(isTerminalStatus('Revoked')).toBe(true);
            expect(isTerminalStatus('Rejected')).toBe(true);
            expect(isTerminalStatus('Cancelled')).toBe(true);

            expect(isTerminalStatus('Pending')).toBe(false);
            expect(isTerminalStatus('Active')).toBe(false);
            expect(isTerminalStatus('AwaitingNotification')).toBe(false);
        });

        it('デフォルトの6ヶ月でTTLを正しく計算できること', () => {
            const now = new Date('2025-01-01T00:00:00Z');
            const expectedTTL = Math.floor(new Date('2025-07-01T00:00:00Z').getTime() / 1000);

            const result = calculateTTL(now.toISOString());

            // 6ヶ月後の範囲内であることを確認（月によって日数が異なるため）
            expect(result).toBeGreaterThanOrEqual(expectedTTL - 86400); // 1日の誤差許容
            expect(result).toBeLessThanOrEqual(expectedTTL + 86400);
        });

        it('カスタム月数でTTLを正しく計算できること', () => {
            const now = new Date('2025-01-01T00:00:00Z');

            // 12ヶ月後のテスト
            const result12 = calculateTTL(now.toISOString(), 12);
            const expected12 = Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000);
            expect(result12).toBeGreaterThanOrEqual(expected12 - 86400);
            expect(result12).toBeLessThanOrEqual(expected12 + 86400);

            // 3ヶ月後のテスト
            const result3 = calculateTTL(now.toISOString(), 3);
            const expected3 = Math.floor(new Date('2025-04-01T00:00:00Z').getTime() / 1000);
            expect(result3).toBeGreaterThanOrEqual(expected3 - 86400);
            expect(result3).toBeLessThanOrEqual(expected3 + 86400);

            // 24ヶ月後のテスト
            const result24 = calculateTTL(now.toISOString(), 24);
            const expected24 = Math.floor(new Date('2027-01-01T00:00:00Z').getTime() / 1000);
            expect(result24).toBeGreaterThanOrEqual(expected24 - 86400);
            expect(result24).toBeLessThanOrEqual(expected24 + 86400);
        });
    });

    describe('設定可能なTTLを使用したupdateStatus', () => {
        it('終了ステータスに更新する際にTTLを設定すること', async () => {
            // Arrange
            const userId = 'test-user-123';
            const sk = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#Test EA';

            const currentApp: EAApplication = {
                userId,
                sk,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'Test EA',
                email: 'test@example.com',
                xAccount: '@test_account',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            const updatedApp = { ...currentApp, status: 'Cancelled' as ApplicationStatus, ttl: 1735689600 };

            mockDocClient.send
                .mockResolvedValueOnce({ Item: currentApp }) // getApplication
                .mockResolvedValueOnce({ Attributes: updatedApp }); // updateStatus

            // Act
            const result = await repository.updateStatus(userId, sk, 'Cancelled');

            // Assert
            expect(result?.status).toBe('Cancelled');
            expect(result?.ttl).toBeDefined();
            expect(mockDocClient.send).toHaveBeenCalledTimes(2);

            // UpdateCommandのTTL設定を確認
            const updateCall = mockDocClient.send.mock.calls[1][0];
            expect(updateCall).toBeInstanceOf(UpdateCommand);
            expect(updateCall.input.UpdateExpression).toContain('#ttl = :ttl');
            expect(updateCall.input.ExpressionAttributeNames['#ttl']).toBe('ttl');
            expect(updateCall.input.ExpressionAttributeValues[':ttl']).toBeDefined();
        });

        it('非終了ステータスから非終了ステータスへの遷移ではTTLを変更しないこと', async () => {
            // Arrange
            const userId = 'test-user-123';
            const sk = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#Test EA';

            const currentApp: EAApplication = {
                userId,
                sk,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'Test EA',
                email: 'test@example.com',
                xAccount: '@test_account',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            const updatedApp = { ...currentApp, status: 'Approve' as ApplicationStatus };

            mockDocClient.send
                .mockResolvedValueOnce({ Item: currentApp }) // getApplication
                .mockResolvedValueOnce({ Attributes: updatedApp }); // updateStatus

            // Act
            const result = await repository.updateStatus(userId, sk, 'Approve');

            // Assert
            expect(result?.status).toBe('Approve');
            expect(mockDocClient.send).toHaveBeenCalledTimes(2);

            // UpdateCommandにTTL関連の操作がないことを確認
            const updateCall = mockDocClient.send.mock.calls[1][0];
            expect(updateCall).toBeInstanceOf(UpdateCommand);
            expect(updateCall.input.UpdateExpression).not.toContain('ttl');
        });
    });

    describe('getApplication', () => {
        it('userIdとskでアプリケーションを取得できること', async () => {
            const userId = 'test-user-123';
            const sk = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#Test EA';

            const mockApplication: EAApplication = {
                userId,
                sk,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'Test EA',
                email: 'test@example.com',
                xAccount: '@test_account',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Item: mockApplication });

            const result = await repository.getApplication(userId, sk);

            expect(result).toEqual(mockApplication);
            expect(mockDocClient.send).toHaveBeenCalledTimes(1);
        });

        it('アプリケーションが見つからない場合はnullを返すこと', async () => {
            const userId = 'test-user-123';
            const sk = 'APPLICATION#non-existent';

            mockDocClient.send.mockResolvedValueOnce({ Item: undefined });

            const result = await repository.getApplication(userId, sk);

            expect(result).toBeNull();
        });
    });

    describe('recordHistory', () => {
        it('新しいステータスが終了ステータスの場合、履歴レコードにTTLを設定すること', async () => {
            // Arrange
            const historyParams = {
                userId: 'test-user-123',
                applicationSK: 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#Test EA',
                action: 'Cancelled' as HistoryAction,
                changedBy: 'test-user-123',
                previousStatus: 'AwaitingNotification' as ApplicationStatus,
                newStatus: 'Cancelled' as ApplicationStatus,
                reason: 'ユーザーによりキャンセルされました'
            };

            mockDocClient.send.mockResolvedValueOnce({});

            // Act
            await repository.recordHistory(historyParams);

            // Assert
            expect(mockDocClient.send).toHaveBeenCalledTimes(1);

            const calledCommand = mockDocClient.send.mock.calls[0][0];
            expect(calledCommand).toBeInstanceOf(PutCommand);

            const putInput = calledCommand.input;
            expect(putInput.Item).toMatchObject({
                userId: 'test-user-123',
                action: 'Cancelled',
                changedBy: 'test-user-123',
                previousStatus: 'AwaitingNotification',
                newStatus: 'Cancelled',
                reason: 'ユーザーによりキャンセルされました'
            });
            expect(putInput.Item.ttl).toBeDefined(); // TTLが設定されている
            expect(putInput.Item.sk).toMatch(/^HISTORY#/);
        });

        it('新しいステータスが非終了ステータスの場合、履歴レコードにTTLを設定しないこと', async () => {
            // Arrange
            const historyParams = {
                userId: 'test-user-123',
                applicationSK: 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#Test EA',
                action: 'Approve' as HistoryAction,
                changedBy: 'test-user-123',
                previousStatus: 'Pending' as ApplicationStatus,
                newStatus: 'Approve' as ApplicationStatus,
                reason: 'アプリケーションが承認されました'
            };

            mockDocClient.send.mockResolvedValueOnce({});

            // Act
            await repository.recordHistory(historyParams);

            // Assert
            expect(mockDocClient.send).toHaveBeenCalledTimes(1);

            const calledCommand = mockDocClient.send.mock.calls[0][0];
            expect(calledCommand).toBeInstanceOf(PutCommand);

            const putInput = calledCommand.input;
            expect(putInput.Item.ttl).toBeUndefined(); // TTLが設定されていない
        });
    });

    describe('cancelApplication', () => {
        it('アプリケーションをキャンセルする際にTTLを設定すること', async () => {
            // Arrange
            const userId = 'test-user-123';
            const sk = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#Test EA';
            const reason = '承認から120秒以内にユーザーによりキャンセルされました';

            const mockApplication: EAApplication = {
                userId,
                sk,
                eaName: 'Test EA',
                accountNumber: '123456',
                broker: 'TestBroker',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z'
            };

            const cancelledApp = { ...mockApplication, status: 'Cancelled' as ApplicationStatus, ttl: 1735689600 };

            // updateStatusWithHistoryTTLの流れをモック
            mockDocClient.send
                .mockResolvedValueOnce({ Item: mockApplication }) // getApplication (in cancelApplication)
                .mockResolvedValueOnce({ Item: mockApplication }) // getApplication (in updateStatus)
                .mockResolvedValueOnce({ Attributes: cancelledApp }) // updateStatus
                .mockResolvedValueOnce({ Items: [] }) // getApplicationHistories (empty history)
                .mockResolvedValueOnce({}); // recordHistory

            // Act
            await repository.cancelApplication(userId, sk, reason);

            // Assert
            expect(mockDocClient.send).toHaveBeenCalledTimes(5);

            // updateStatus が正しく呼ばれた (3回目のcall)
            const updateCall = mockDocClient.send.mock.calls[2][0];
            expect(updateCall.input.ExpressionAttributeValues[':newStatus']).toBe('Cancelled');
            expect(updateCall.input.UpdateExpression).toContain('#ttl = :ttl');

            // recordHistory が正しく呼ばれた (5回目のcall)
            const historyCall = mockDocClient.send.mock.calls[4][0];
            expect(historyCall).toBeInstanceOf(PutCommand);
            expect(historyCall.input.Item).toMatchObject({
                userId,
                action: 'Cancelled',
                changedBy: userId,
                previousStatus: 'AwaitingNotification',
                newStatus: 'Cancelled',
                reason
            });
            expect(historyCall.input.Item.ttl).toBeDefined(); // 履歴にもTTL設定
        });
    });

    describe('統合テスト - TTLワークフロー', () => {
        it('承認からキャンセルまでの完全なTTLワークフローを実証すること', async () => {
            // このテストは、TTL設定の完全なワークフローを示す
            const userId = 'integration-user';

            // Step 1: アプリケーション作成（TTLなし）
            const applicationData = {
                userId,
                broker: 'IntegrationBroker',
                accountNumber: '999888',
                eaName: 'Integration EA',
                email: 'integration@test.com',
                xAccount: '@integration',
                appliedAt: '2025-01-01T00:00:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({ Items: [] }); // 重複チェック
            mockDocClient.send.mockResolvedValueOnce({}); // 作成

            const createdApp = await repository.createApplication(applicationData);
            expect(createdApp.status).toBe('Pending');
            expect(createdApp.ttl).toBeUndefined();

            // Step 2: 承認処理 (Pending → Approve) - TTLなし
            mockDocClient.send.mockResolvedValueOnce({ Item: createdApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: { ...createdApp, status: 'Approve' }
            }); // updateStatus

            const approvedApp = await repository.updateStatus(createdApp.userId, createdApp.sk, 'Approve');
            expect(approvedApp?.status).toBe('Approve');
            expect(approvedApp?.ttl).toBeUndefined(); // 非終了ステータスなのでTTLなし

            // Step 3: AwaitingNotification への遷移 - TTLなし
            mockDocClient.send.mockResolvedValueOnce({ Item: approvedApp }); // getApplication
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: { ...approvedApp, status: 'AwaitingNotification' }
            }); // updateStatus

            const awaitingApp = await repository.updateStatus(userId, createdApp.sk, 'AwaitingNotification');
            expect(awaitingApp?.status).toBe('AwaitingNotification');
            expect(awaitingApp?.ttl).toBeUndefined(); // 非終了ステータスなのでTTLなし

            // Step 4: キャンセル処理 (AwaitingNotification → Cancelled) - TTL設定
            const cancelledApp = { ...awaitingApp, status: 'Cancelled' as ApplicationStatus, ttl: 1735689600 };

            mockDocClient.send
                .mockResolvedValueOnce({ Item: awaitingApp }) // getApplication (in cancelApplication)
                .mockResolvedValueOnce({ Item: awaitingApp }) // getApplication (in updateStatus)
                .mockResolvedValueOnce({ Attributes: cancelledApp }) // updateStatus
                .mockResolvedValueOnce({ Items: [] }) // getApplicationHistories
                .mockResolvedValueOnce({}); // recordHistory

            await repository.cancelApplication(userId, createdApp.sk, 'ユーザーがキャンセル');

            // Step 5: 検証
            expect(mockDocClient.send).toHaveBeenCalledTimes(11);

            // TTL設定が含まれるUpdateCommandを確認（インデックス8、9番目のcall）
            const ttlUpdateCall = mockDocClient.send.mock.calls[8][0]; // 9番目のcall
            expect(ttlUpdateCall.constructor.name).toBe('UpdateCommand');

            if (ttlUpdateCall.input && ttlUpdateCall.input.UpdateExpression) {
                expect(ttlUpdateCall.input.UpdateExpression).toContain('#ttl = :ttl');
                expect(ttlUpdateCall.input.ExpressionAttributeValues[':ttl']).toBeDefined();
            }

            console.log('✅ TTL統合ワークフロー成功');
        });
    });
});