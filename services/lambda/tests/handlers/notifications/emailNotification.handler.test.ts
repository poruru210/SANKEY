import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { AwilixContainer } from 'awilix';
import { createTestContainer } from '../../di/testContainer';
import { createHandler } from '../../../src/handlers/notifications/emailNotification.handler';
import { DIContainer, EmailNotificationHandlerDependencies } from '../../../src/di/dependencies';
import { NotificationMessage } from '../../../src/models/eaApplication';

// Resendのモック
vi.mock('resend', () => ({
    Resend: vi.fn().mockImplementation(() => ({
        emails: {
            send: vi.fn()
        }
    }))
}));

// 暗号化サービスのモック
vi.mock('../../../src/services/encryption', () => ({
    encryptLicense: vi.fn()
}));

// ライセンスペイロードのモック
vi.mock('../../../src/models/licensePayload', () => ({
    createLicensePayloadV1: vi.fn()
}));

describe('emailNotification.handler', () => {
    let container: AwilixContainer<DIContainer>;
    let mockEaApplicationRepository: any;
    let mockMasterKeyService: any;
    let mockIntegrationTestService: any;
    let mockUserProfileRepository: any;
    let mockSsmClient: any;
    let mockLogger: any;
    let mockTracer: any;
    let handler: any;
    let dependencies: EmailNotificationHandlerDependencies;

    beforeEach(() => {
        vi.clearAllMocks();

        // 環境変数の設定
        process.env.USER_PROFILE_TABLE_NAME = 'test-user-profile-table';
        process.env.EMAIL_FROM_ADDRESS = 'test@example.com';
        process.env.RESEND_API_KEY_PARAM = '/test/resend/api-key';

        // テストコンテナから依存関係を取得
        container = createTestContainer({ useRealServices: false });
        mockEaApplicationRepository = container.resolve('eaApplicationRepository');
        mockMasterKeyService = container.resolve('masterKeyService');
        mockIntegrationTestService = container.resolve('integrationTestService');
        mockUserProfileRepository = container.resolve('userProfileRepository');
        mockSsmClient = container.resolve('ssmClient');
        mockLogger = container.resolve('logger');
        mockTracer = container.resolve('tracer');

        // mockSsmClientのsendメソッドを明示的にモック関数にする
        if (!mockSsmClient.send || typeof mockSsmClient.send.mockResolvedValue !== 'function') {
            mockSsmClient.send = vi.fn();
        }

        // ハンドラー用の依存関係を構築
        dependencies = {
            eaApplicationRepository: mockEaApplicationRepository,
            masterKeyService: mockMasterKeyService,
            integrationTestService: mockIntegrationTestService,
            userProfileRepository: mockUserProfileRepository,
            ssmClient: mockSsmClient,
            logger: mockLogger,
            tracer: mockTracer
        };

        handler = createHandler(dependencies);
    });

    afterEach(() => {
        vi.clearAllMocks();
        delete process.env.USER_PROFILE_TABLE_NAME;
        delete process.env.EMAIL_FROM_ADDRESS;
        delete process.env.RESEND_API_KEY_PARAM;
    });

    // ヘルパー関数: テスト用のSQSイベント作成
    const createTestEvent = (messages: NotificationMessage[]): SQSEvent => ({
        Records: messages.map((msg, index) => ({
            messageId: `test-message-${index}`,
            receiptHandle: `test-receipt-${index}`,
            body: JSON.stringify(msg),
            attributes: {
                ApproximateReceiveCount: '1',
                SentTimestamp: '1234567890',
                SenderId: 'test-sender',
                ApproximateFirstReceiveTimestamp: '1234567890'
            },
            messageAttributes: {},
            md5OfBody: 'test-md5',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:region:account:queue',
            awsRegion: 'ap-northeast-1'
        } as SQSRecord))
    });

    describe('通常のライセンス発行フロー', () => {
        it('承認済みアプリケーションのライセンスを生成してメールを送信する', async () => {
            const message: NotificationMessage = {
                userId: 'test-user-id',
                applicationSK: 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA'
            };

            const mockApplication = {
                userId: 'test-user-id',
                sk: 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA',
                status: 'AwaitingNotification',
                email: 'user@example.com',
                eaName: 'TestEA',
                accountNumber: '123456',
                expiryDate: '2025-12-31T23:59:59Z',
                broker: 'TestBroker'
            };

            const mockUserProfile = {
                userId: 'test-user-id',
                testResults: {
                    integration: {
                        gasWebappUrl: 'https://script.google.com/test'
                    }
                }
            };

            const mockLicensePayload = {
                eaName: 'TestEA',
                accountId: '123456',
                expiry: '2025-12-31T23:59:59Z',
                userId: 'test-user-id',
                issuedAt: '2025-01-15T00:00:00Z'
            };

            const mockEncryptedLicense = 'encrypted-license-key-12345';
            const mockMasterKey = Buffer.from('test-master-key');

            // モックの設定
            mockEaApplicationRepository.getApplication.mockResolvedValue(mockApplication);
            mockIntegrationTestService.isIntegrationTestApplication.mockReturnValue(false);
            mockMasterKeyService.getUserMasterKeyForEncryption.mockResolvedValue(mockMasterKey);

            const { createLicensePayloadV1 } = await import('../../../src/models/licensePayload');
            (createLicensePayloadV1 as any).mockReturnValue(mockLicensePayload);

            const { encryptLicense } = await import('../../../src/services/encryption');
            (encryptLicense as any).mockResolvedValue(mockEncryptedLicense);

            mockUserProfileRepository.getUserProfile.mockResolvedValue(mockUserProfile);

            // Resend API keyの取得
            mockSsmClient.send.mockResolvedValue({
                Parameter: { Value: 'test-resend-api-key' }
            });

            // Resendのモック
            const { Resend } = await import('resend');
            const mockSend = vi.fn().mockResolvedValue({ data: { id: 'email-id-123' } });
            (Resend as any).mockImplementation(() => ({
                emails: { send: mockSend }
            }));

            mockEaApplicationRepository.activateApplicationWithLicense.mockResolvedValue({
                ...mockApplication,
                status: 'Active',
                licenseKey: mockEncryptedLicense,
                updatedAt: '2025-01-15T00:00:00Z'
            });

            // GAS通知のfetchモック
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true })
            });

            const event = createTestEvent([message]);
            await handler(event);

            // 検証
            expect(mockEaApplicationRepository.getApplication).toHaveBeenCalledWith(
                'test-user-id',
                'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA'
            );
            expect(mockMasterKeyService.getUserMasterKeyForEncryption).toHaveBeenCalledWith('test-user-id');
            expect(encryptLicense).toHaveBeenCalledWith(mockMasterKey, mockLicensePayload, '123456');
            expect(mockSend).toHaveBeenCalledWith(
                expect.objectContaining({
                    from: 'test@example.com',
                    to: 'user@example.com',
                    subject: 'EA License Approved - TestEA'
                })
            );
            expect(mockEaApplicationRepository.activateApplicationWithLicense).toHaveBeenCalled();
            expect(global.fetch).toHaveBeenCalledWith(
                'https://script.google.com/test',
                expect.objectContaining({
                    method: 'POST'
                })
            );
        });

        it('アプリケーションが見つからない場合はエラーログを出力して続行する', async () => {
            const message: NotificationMessage = {
                userId: 'test-user-id',
                applicationSK: 'APPLICATION#not-found'
            };

            mockEaApplicationRepository.getApplication.mockResolvedValue(null);

            const event = createTestEvent([message]);
            await handler(event);

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Application not found',
                expect.objectContaining({
                    userId: 'test-user-id',
                    applicationSK: 'APPLICATION#not-found'
                })
            );
            expect(mockMasterKeyService.getUserMasterKeyForEncryption).not.toHaveBeenCalled();
        });

        it('ステータスがAwaitingNotificationでない場合は警告を出力して続行する', async () => {
            const message: NotificationMessage = {
                userId: 'test-user-id',
                applicationSK: 'APPLICATION#test'
            };

            const mockApplication = {
                userId: 'test-user-id',
                sk: 'APPLICATION#test',
                status: 'Active'
            };

            mockEaApplicationRepository.getApplication.mockResolvedValue(mockApplication);

            const event = createTestEvent([message]);
            await handler(event);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Application not in AwaitingNotification status',
                expect.objectContaining({
                    currentStatus: 'Active'
                })
            );
            expect(mockMasterKeyService.getUserMasterKeyForEncryption).not.toHaveBeenCalled();
        });
    });

    describe('統合テストのライセンス発行フロー', () => {
        it('統合テストアプリケーションの場合はメール送信をスキップして進捗を記録する', async () => {
            const message: NotificationMessage = {
                userId: 'test-user-id',
                applicationSK: 'APPLICATION#integration-test'
            };

            const mockApplication = {
                userId: 'test-user-id',
                sk: 'APPLICATION#integration-test',
                status: 'AwaitingNotification',
                email: 'test@integration.test',
                eaName: 'Integration Test EA',
                accountNumber: 'INTEGRATION_TEST_123456',
                expiryDate: '2025-12-31T23:59:59Z',
                broker: 'Test Broker',
                integrationTestId: 'test-id-123'
            };

            const mockUserProfile = {
                userId: 'test-user-id',
                testResults: {
                    integration: {
                        gasWebappUrl: 'https://script.google.com/test'
                    }
                }
            };

            const mockLicensePayload = {
                eaName: 'Integration Test EA',
                accountId: 'INTEGRATION_TEST_123456',
                expiry: '2025-12-31T23:59:59Z',
                userId: 'test-user-id',
                issuedAt: '2025-01-15T00:00:00Z'
            };

            const mockEncryptedLicense = 'encrypted-test-license';
            const mockMasterKey = Buffer.from('test-master-key');

            // モックの設定
            mockEaApplicationRepository.getApplication.mockResolvedValue(mockApplication);
            mockIntegrationTestService.isIntegrationTestApplication.mockReturnValue(true);
            mockMasterKeyService.getUserMasterKeyForEncryption.mockResolvedValue(mockMasterKey);

            const { createLicensePayloadV1 } = await import('../../../src/models/licensePayload');
            (createLicensePayloadV1 as any).mockReturnValue(mockLicensePayload);

            const { encryptLicense } = await import('../../../src/services/encryption');
            (encryptLicense as any).mockResolvedValue(mockEncryptedLicense);

            mockUserProfileRepository.getUserProfile.mockResolvedValue(mockUserProfile);

            mockEaApplicationRepository.activateApplicationWithLicense.mockResolvedValue({
                ...mockApplication,
                status: 'Active',
                licenseKey: mockEncryptedLicense,
                updatedAt: '2025-01-15T00:00:00Z'
            });

            mockIntegrationTestService.recordProgress.mockResolvedValue({});

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true })
            });

            const event = createTestEvent([message]);
            await handler(event);

            // 検証
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Skipping email for integration test',
                expect.any(Object)
            );

            // メール送信がスキップされていることを確認
            const { Resend } = await import('resend');
            expect(Resend).not.toHaveBeenCalled();

            // 統合テストの進捗が記録されていることを確認
            expect(mockIntegrationTestService.recordProgress).toHaveBeenCalledWith(
                'test-user-id',
                'LICENSE_ISSUED',
                true,
                expect.objectContaining({
                    applicationSK: 'APPLICATION#integration-test',
                    licenseId: mockEncryptedLicense
                })
            );
        });
    });

    describe('エラーハンドリング', () => {
        it('必須フィールドが不足している場合はエラーをスローする', async () => {
            const message: NotificationMessage = {
                userId: 'test-user-id',
                applicationSK: 'APPLICATION#incomplete'
            };

            const mockApplication = {
                userId: 'test-user-id',
                sk: 'APPLICATION#incomplete',
                status: 'AwaitingNotification',
                // emailが不足
                eaName: 'TestEA',
                accountNumber: '123456'
            };

            mockEaApplicationRepository.getApplication.mockResolvedValue(mockApplication);

            const event = createTestEvent([message]);

            await expect(handler(event)).rejects.toThrow();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Missing required application data',
                expect.any(Object)
            );
        });

        it('複数のメッセージで一部が失敗した場合もエラーをスローする', async () => {
            const messages: NotificationMessage[] = [
                { userId: 'user1', applicationSK: 'APP1' },
                { userId: 'user2', applicationSK: 'APP2' }
            ];

            mockEaApplicationRepository.getApplication
                .mockResolvedValueOnce({
                    userId: 'user1',
                    sk: 'APP1',
                    status: 'AwaitingNotification',
                    email: 'user1@example.com',
                    eaName: 'EA1',
                    accountNumber: '111111',
                    expiryDate: '2025-12-31T23:59:59Z'
                })
                .mockResolvedValueOnce(null); // 2つ目は見つからない

            const event = createTestEvent(messages);

            await expect(handler(event)).rejects.toThrow();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Some notification messages failed',
                expect.any(Object)
            );
        });
    });

    describe('GAS通知', () => {
        it('ユーザープロファイルが存在しない場合はGAS通知をスキップする', async () => {
            const message: NotificationMessage = {
                userId: 'test-user-id',
                applicationSK: 'APPLICATION#test'
            };

            const mockApplication = {
                userId: 'test-user-id',
                sk: 'APPLICATION#test',
                status: 'AwaitingNotification',
                email: 'user@example.com',
                eaName: 'TestEA',
                accountNumber: '123456',
                expiryDate: '2025-12-31T23:59:59Z'
            };

            mockEaApplicationRepository.getApplication.mockResolvedValue(mockApplication);
            mockIntegrationTestService.isIntegrationTestApplication.mockReturnValue(false);
            mockMasterKeyService.getUserMasterKeyForEncryption.mockResolvedValue(Buffer.from('key'));

            const { createLicensePayloadV1 } = await import('../../../src/models/licensePayload');
            (createLicensePayloadV1 as any).mockReturnValue({});

            const { encryptLicense } = await import('../../../src/services/encryption');
            (encryptLicense as any).mockResolvedValue('license');

            // ユーザープロファイルが見つからない
            mockUserProfileRepository.getUserProfile.mockResolvedValue(null);

            mockSsmClient.send.mockResolvedValue({
                Parameter: { Value: 'test-api-key' }
            });

            const { Resend } = await import('resend');
            const mockSend = vi.fn().mockResolvedValue({ data: { id: 'email-id' } });
            (Resend as any).mockImplementation(() => ({
                emails: { send: mockSend }
            }));

            mockEaApplicationRepository.activateApplicationWithLicense.mockResolvedValue({
                ...mockApplication,
                status: 'Active',
                licenseKey: 'license',
                updatedAt: '2025-01-15T00:00:00Z'
            });

            const event = createTestEvent([message]);
            await handler(event);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'UserProfile not found',
                expect.objectContaining({ userId: 'test-user-id' })
            );
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('GAS通知が失敗しても処理は継続する', async () => {
            const message: NotificationMessage = {
                userId: 'test-user-id',
                applicationSK: 'APPLICATION#test'
            };

            const mockApplication = {
                userId: 'test-user-id',
                sk: 'APPLICATION#test',
                status: 'AwaitingNotification',
                email: 'user@example.com',
                eaName: 'TestEA',
                accountNumber: '123456',
                expiryDate: '2025-12-31T23:59:59Z',
                updatedAt: '2025-01-15T00:00:00Z'
            };

            const mockUserProfile = {
                userId: 'test-user-id',
                testResults: {
                    integration: {
                        gasWebappUrl: 'https://script.google.com/test'
                    }
                }
            };

            mockEaApplicationRepository.getApplication.mockResolvedValue(mockApplication);
            mockIntegrationTestService.isIntegrationTestApplication.mockReturnValue(false);
            mockMasterKeyService.getUserMasterKeyForEncryption.mockResolvedValue(Buffer.from('key'));

            const { createLicensePayloadV1 } = await import('../../../src/models/licensePayload');
            (createLicensePayloadV1 as any).mockReturnValue({});

            const { encryptLicense } = await import('../../../src/services/encryption');
            (encryptLicense as any).mockResolvedValue('license');

            mockUserProfileRepository.getUserProfile.mockResolvedValue(mockUserProfile);
            mockSsmClient.send.mockResolvedValue({
                Parameter: { Value: 'test-api-key' }
            });

            const { Resend } = await import('resend');
            const mockSend = vi.fn().mockResolvedValue({ data: { id: 'email-id' } });
            (Resend as any).mockImplementation(() => ({
                emails: { send: mockSend }
            }));

            mockEaApplicationRepository.activateApplicationWithLicense.mockResolvedValue({
                ...mockApplication,
                status: 'Active',
                licenseKey: 'license'
            });

            // GAS通知が失敗
            global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

            const event = createTestEvent([message]);

            // エラーをスローしないことを確認
            await expect(handler(event)).resolves.not.toThrow();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error sending GAS notification',
                expect.objectContaining({
                    error: 'Network error'
                })
            );
        });
    });
});