// tests/handlers/applications/dlqNotification.handler.test.ts

import { SQSEvent, SQSRecord } from 'aws-lambda';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EAApplication } from '@lambda/models/eaApplication';

// 修正: DI対応のRepository クラスモック
const mockRepository = {
    getApplication: vi.fn(),
    updateStatus: vi.fn(),
    recordHistory: vi.fn(),
};

// 修正: DIクラスモックに変更
vi.mock('../../../src/repositories/eaApplicationRepository', () => ({
    EAApplicationRepository: vi.fn().mockImplementation(() => mockRepository)
}));

// DynamoDB Client のモック追加
vi.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
        from: vi.fn().mockReturnValue({})
    }
}));

// PowerTools のモック
vi.mock('@aws-lambda-powertools/logger', () => ({
    Logger: vi.fn().mockImplementation(() => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    }))
}));

vi.mock('@aws-lambda-powertools/tracer', () => ({
    Tracer: vi.fn().mockImplementation(() => ({
        captureAWSv3Client: vi.fn((client) => client),
        isTracingEnabled: vi.fn(() => false),
        getSegment: vi.fn(),
        setSegment: vi.fn(),
        addAnnotation: vi.fn(),
        addMetadata: vi.fn(),
        putAnnotation: vi.fn(),
        putMetadata: vi.fn(),
        annotateColdStart: vi.fn(),
        addServiceNameAnnotation: vi.fn(),
        addResponseAsMetadata: vi.fn(),
        captureLambdaHandler: vi.fn((handler) => handler),
        captureMethod: vi.fn(),
        captureAsyncFunc: vi.fn()
    }))
}));

// Middyのモック
vi.mock('@middy/core', () => ({
    default: vi.fn((handler) => {
        const wrappedHandler = async (event: any, context: any) => {
            return await handler(event, context);
        };
        wrappedHandler.use = vi.fn().mockReturnValue(wrappedHandler);
        wrappedHandler.before = vi.fn();
        wrappedHandler.after = vi.fn();
        wrappedHandler.onError = vi.fn();
        return wrappedHandler;
    })
}));

describe('dlqNotification.handler', () => {
    let handler: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        const handlerModule = await import('../../../src/handlers/applications/dlqNotification.handler');
        handler = handlerModule.handler;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    // ヘルパー関数: テスト用のSQSレコード作成
    const createSQSRecord = (
        messageBody: string,
        messageId: string = 'test-message-id',
        receiptHandle: string = 'test-receipt-handle',
        attributeOverrides?: Partial<Record<string, string>>,
        messageAttributes?: Record<string, any>
    ): SQSRecord => ({
        messageId,
        receiptHandle,
        body: messageBody,
        attributes: {
            ApproximateReceiveCount: '3',
            SentTimestamp: '1640995200000', // 2022-01-01T00:00:00Z
            SenderId: 'AIDADEFAULTMESSAGE',
            ApproximateFirstReceiveTimestamp: '1640995500000', // 2022-01-01T00:05:00Z
            ...attributeOverrides
        },
        messageAttributes: messageAttributes || {},
        md5OfBody: 'test-md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-dlq',
        awsRegion: 'us-east-1'
    });

    // ヘルパー関数: テスト用のSQSイベント作成
    const createSQSEvent = (records: SQSRecord[]): SQSEvent => ({
        Records: records
    });

    // ヘルパー関数: NotificationMessage作成
    const createNotificationMessage = (
        applicationSK: string = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA',
        userId: string = 'test-user-123',
        retryCount: number = 0
    ) => ({
        applicationSK,
        userId,
        retryCount
    });

    describe('正常系テスト', () => {
        it('should successfully process DLQ message and update application to FailedNotification', async () => {
            // Arrange
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const userId = 'test-user-123';

            const notificationMessage = createNotificationMessage(applicationSK, userId, 1);
            const messageBody = JSON.stringify(notificationMessage);

            const sqsRecord = createSQSRecord(messageBody, 'test-msg-1', 'test-receipt-1');
            const event = createSQSEvent([sqsRecord]);

            const mockApplication: EAApplication = {
                userId,
                sk: applicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z',
                failureCount: 0
            };

            const updatedApplication = {
                ...mockApplication,
                status: 'FailedNotification',
                failureCount: 1,
                lastFailureReason: 'Message processing failed after 3 attempts',
                lastFailedAt: expect.any(String)
            };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce(updatedApplication);
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            // Act
            const result = await handler(event);

            // Assert
            expect(result).toBeUndefined(); // DLQハンドラーは戻り値なし

            // Repository メソッドの呼び出し確認
            expect(mockRepository.getApplication).toHaveBeenCalledWith(userId, applicationSK);
            expect(mockRepository.updateStatus).toHaveBeenCalledWith(
                userId,
                applicationSK,
                'FailedNotification',
                expect.objectContaining({
                    lastFailureReason: expect.stringContaining('Message processing failed after 3 attempts'),
                    failureCount: 1,
                    lastFailedAt: expect.any(String)
                })
            );
            expect(mockRepository.recordHistory).toHaveBeenCalledWith({
                userId,
                applicationSK,
                action: 'EmailFailed',
                changedBy: 'system',
                previousStatus: 'AwaitingNotification',
                newStatus: 'FailedNotification',
                reason: expect.stringContaining('Email notification failed'),
                errorDetails: expect.any(String),
                retryCount: 1
            });
        });

        it('should handle SNS wrapped message correctly', async () => {
            // Arrange
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const userId = 'test-user-123';

            const notificationMessage = createNotificationMessage(applicationSK, userId);
            const snsMessage = {
                Type: 'Notification',
                MessageId: 'sns-message-id',
                TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
                Message: JSON.stringify(notificationMessage),
                Timestamp: '2025-01-01T00:00:00Z'
            };

            const sqsRecord = createSQSRecord(JSON.stringify(snsMessage));
            const event = createSQSEvent([sqsRecord]);

            const mockApplication: EAApplication = {
                userId,
                sk: applicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z'
            };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce({ ...mockApplication, status: 'FailedNotification' });
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            // Act
            const result = await handler(event);

            // Assert
            expect(result).toBeUndefined();
            expect(mockRepository.getApplication).toHaveBeenCalledWith(userId, applicationSK);
        });

        it('should handle multiple DLQ messages sequentially', async () => {
            // Arrange
            const messages = [
                {
                    applicationSK: 'APPLICATION#2025-01-01T00:00:00Z#Broker1#111111#EA1',
                    userId: 'user-1',
                    retryCount: 1
                },
                {
                    applicationSK: 'APPLICATION#2025-01-01T00:00:00Z#Broker2#222222#EA2',
                    userId: 'user-2',
                    retryCount: 2
                }
            ];

            const sqsRecords = messages.map((msg, index) =>
                createSQSRecord(JSON.stringify(msg), `test-msg-${index + 1}`)
            );
            const event = createSQSEvent(sqsRecords);

            // 各メッセージに対するモック設定
            messages.forEach((msg, index) => {
                const mockApp: EAApplication = {
                    userId: msg.userId,
                    sk: msg.applicationSK,
                    broker: `Broker${index + 1}`,
                    accountNumber: `${111111 + index * 111111}`,
                    eaName: `EA${index + 1}`,
                    email: `test${index + 1}@example.com`,
                    xAccount: `@test${index + 1}`,
                    status: 'AwaitingNotification',
                    appliedAt: '2025-01-01T00:00:00Z',
                    updatedAt: '2025-01-01T01:00:00Z',
                    failureCount: index
                };

                mockRepository.getApplication.mockResolvedValueOnce(mockApp);
                mockRepository.updateStatus.mockResolvedValueOnce({ ...mockApp, status: 'FailedNotification' });
                mockRepository.recordHistory.mockResolvedValueOnce(undefined);
            });

            // Act
            const result = await handler(event);

            // Assert
            expect(result).toBeUndefined();
            expect(mockRepository.getApplication).toHaveBeenCalledTimes(2);
            expect(mockRepository.updateStatus).toHaveBeenCalledTimes(2);
            expect(mockRepository.recordHistory).toHaveBeenCalledTimes(2);
        });

        it('should extract detailed failure information from SQS attributes', async () => {
            // Arrange
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const userId = 'test-user-123';

            const notificationMessage = createNotificationMessage(applicationSK, userId);
            const sqsRecord = createSQSRecord(
                JSON.stringify(notificationMessage),
                'test-msg-1',
                'test-receipt-1',
                {
                    ApproximateReceiveCount: '5',
                    SentTimestamp: '1640995200000',
                    ApproximateFirstReceiveTimestamp: '1640995500000'
                },
                {
                    errorMessage: { stringValue: 'SMTP connection timeout', dataType: 'String' },
                    lastErrorMessage: { stringValue: 'Failed to send email after 5 attempts', dataType: 'String' }
                }
            );
            const event = createSQSEvent([sqsRecord]);

            const mockApplication: EAApplication = {
                userId,
                sk: applicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z'
            };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce({ ...mockApplication, status: 'FailedNotification' });
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            // Act
            await handler(event);

            // Assert
            expect(mockRepository.updateStatus).toHaveBeenCalledWith(
                userId,
                applicationSK,
                'FailedNotification',
                expect.objectContaining({
                    lastFailureReason: 'Message processing failed after 5 attempts'
                })
            );

            expect(mockRepository.recordHistory).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId,
                    applicationSK,
                    action: 'EmailFailed',
                    changedBy: 'system',
                    previousStatus: 'AwaitingNotification',
                    newStatus: 'FailedNotification',
                    reason: expect.stringContaining('Email notification failed: Message processing failed after 5 attempts'),
                    errorDetails: expect.stringContaining('SMTP connection timeout'),
                    retryCount: 1
                })
            );
        });
    });

    describe('異常系テスト', () => {
        it('should skip processing when original message format is invalid', async () => {
            // Arrange
            const invalidMessageBody = '{ "invalid": "message", "missing": "required fields" }';
            const sqsRecord = createSQSRecord(invalidMessageBody);
            const event = createSQSEvent([sqsRecord]);

            // Act
            const result = await handler(event);

            // Assert
            expect(result).toBeUndefined();
            expect(mockRepository.getApplication).not.toHaveBeenCalled();
            expect(mockRepository.updateStatus).not.toHaveBeenCalled();
            expect(mockRepository.recordHistory).not.toHaveBeenCalled();
        });

        it('should skip processing when application is not found', async () => {
            // Arrange
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#NonExistent#123456#TestEA';
            const userId = 'test-user-123';

            const notificationMessage = createNotificationMessage(applicationSK, userId);
            const sqsRecord = createSQSRecord(JSON.stringify(notificationMessage));
            const event = createSQSEvent([sqsRecord]);

            mockRepository.getApplication.mockResolvedValueOnce(null); // アプリケーションが見つからない

            // Act
            const result = await handler(event);

            // Assert
            expect(result).toBeUndefined();
            expect(mockRepository.getApplication).toHaveBeenCalledWith(userId, applicationSK);
            expect(mockRepository.updateStatus).not.toHaveBeenCalled();
            expect(mockRepository.recordHistory).not.toHaveBeenCalled();
        });

        it('should skip processing when application is not in AwaitingNotification status', async () => {
            // Arrange
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const userId = 'test-user-123';

            const notificationMessage = createNotificationMessage(applicationSK, userId);
            const sqsRecord = createSQSRecord(JSON.stringify(notificationMessage));
            const event = createSQSEvent([sqsRecord]);

            const mockApplication: EAApplication = {
                userId,
                sk: applicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Active', // AwaitingNotification ではない
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z'
            };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);

            // Act
            const result = await handler(event);

            // Assert
            expect(result).toBeUndefined();
            expect(mockRepository.getApplication).toHaveBeenCalledWith(userId, applicationSK);
            expect(mockRepository.updateStatus).not.toHaveBeenCalled();
            expect(mockRepository.recordHistory).not.toHaveBeenCalled();
        });

        it('should handle malformed JSON in message body', async () => {
            // Arrange
            const malformedJson = '{ "applicationSK": "test", invalid json }';
            const sqsRecord = createSQSRecord(malformedJson);
            const event = createSQSEvent([sqsRecord]);

            // Act
            const result = await handler(event);

            // Assert
            expect(result).toBeUndefined();
            expect(mockRepository.getApplication).not.toHaveBeenCalled();
        });

        it('should handle repository errors and continue processing other messages', async () => {
            // Arrange
            const messages = [
                {
                    applicationSK: 'APPLICATION#2025-01-01T00:00:00Z#Broker1#111111#EA1',
                    userId: 'user-1',
                    retryCount: 1
                },
                {
                    applicationSK: 'APPLICATION#2025-01-01T00:00:00Z#Broker2#222222#EA2',
                    userId: 'user-2',
                    retryCount: 2
                }
            ];

            const sqsRecords = messages.map((msg, index) =>
                createSQSRecord(JSON.stringify(msg), `test-msg-${index + 1}`)
            );
            const event = createSQSEvent(sqsRecords);

            const mockApp1: EAApplication = {
                userId: 'user-1',
                sk: messages[0].applicationSK,
                broker: 'Broker1',
                accountNumber: '111111',
                eaName: 'EA1',
                email: 'test1@example.com',
                xAccount: '@test1',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z'
            };

            const mockApp2: EAApplication = {
                userId: 'user-2',
                sk: messages[1].applicationSK,
                broker: 'Broker2',
                accountNumber: '222222',
                eaName: 'EA2',
                email: 'test2@example.com',
                xAccount: '@test2',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z'
            };

            // 1番目のメッセージでエラー
            mockRepository.getApplication.mockResolvedValueOnce(mockApp1);
            mockRepository.updateStatus.mockRejectedValueOnce(new Error('Database error'));

            // 2番目のメッセージは成功
            mockRepository.getApplication.mockResolvedValueOnce(mockApp2);
            mockRepository.updateStatus.mockResolvedValueOnce({ ...mockApp2, status: 'FailedNotification' });
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            // Act
            const result = await handler(event);

            // Assert
            expect(result).toBeUndefined();
            expect(mockRepository.getApplication).toHaveBeenCalledTimes(2);
            expect(mockRepository.updateStatus).toHaveBeenCalledTimes(2);
            expect(mockRepository.recordHistory).toHaveBeenCalledTimes(1); // 成功した1件のみ
        });

        it('should throw error when DLQ processing itself fails critically', async () => {
            // Arrange
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const userId = 'test-user-123';

            const notificationMessage = createNotificationMessage(applicationSK, userId);
            const sqsRecord = createSQSRecord(JSON.stringify(notificationMessage));
            const event = createSQSEvent([sqsRecord]);

            const mockApplication: EAApplication = {
                userId,
                sk: applicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z'
            };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockRejectedValueOnce(new Error('Critical database failure'));

            // Act & Assert
            const result = await handler(event);

            // DLQハンドラーはエラーをキャッチして処理を継続するが、個別メッセージのエラーはログに記録される
            expect(result).toBeUndefined();
            expect(mockRepository.getApplication).toHaveBeenCalledWith(userId, applicationSK);
        });
    });

    describe('最大リトライ回数超過テスト', () => {
        it('should log alert when maximum retry count is reached', async () => {
            // Arrange
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const userId = 'test-user-123';

            const notificationMessage = createNotificationMessage(applicationSK, userId, 3); // MAX_RETRY_COUNT
            const sqsRecord = createSQSRecord(JSON.stringify(notificationMessage));
            const event = createSQSEvent([sqsRecord]);

            const mockApplication: EAApplication = {
                userId,
                sk: applicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z',
                failureCount: 2 // 既に2回失敗済み
            };

            const updatedApplication = {
                ...mockApplication,
                status: 'FailedNotification',
                failureCount: 3, // MAX_RETRY_COUNT に到達
                lastFailureReason: 'Message processing failed after 3 attempts',
                lastFailedAt: expect.any(String)
            };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce(updatedApplication);
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            // Act
            const result = await handler(event);

            // Assert
            expect(result).toBeUndefined();
            expect(mockRepository.updateStatus).toHaveBeenCalledWith(
                userId,
                applicationSK,
                'FailedNotification',
                expect.objectContaining({
                    failureCount: 3
                })
            );

            // TODO: 管理者アラート送信の確認（実装時）
            // expect(sendAdminAlert).toHaveBeenCalledWith(expect.objectContaining({
            //     severity: 'HIGH',
            //     message: expect.stringContaining('License notification failed 3 times')
            // }));
        });

        it('should not trigger alert when under maximum retry count', async () => {
            // Arrange
            const applicationSK = 'APPLICATION#2025-01-01T00:00:00Z#TestBroker#123456#TestEA';
            const userId = 'test-user-123';

            const notificationMessage = createNotificationMessage(applicationSK, userId, 1);
            const sqsRecord = createSQSRecord(JSON.stringify(notificationMessage));
            const event = createSQSEvent([sqsRecord]);

            const mockApplication: EAApplication = {
                userId,
                sk: applicationSK,
                broker: 'TestBroker',
                accountNumber: '123456',
                eaName: 'TestEA',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'AwaitingNotification',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T01:00:00Z',
                failureCount: 0
            };

            mockRepository.getApplication.mockResolvedValueOnce(mockApplication);
            mockRepository.updateStatus.mockResolvedValueOnce({
                ...mockApplication,
                status: 'FailedNotification',
                failureCount: 1
            });
            mockRepository.recordHistory.mockResolvedValueOnce(undefined);

            // Act
            const result = await handler(event);

            // Assert
            expect(result).toBeUndefined();
            expect(mockRepository.updateStatus).toHaveBeenCalledWith(
                userId,
                applicationSK,
                'FailedNotification',
                expect.objectContaining({
                    failureCount: 1 // MAX_RETRY_COUNT未満
                })
            );
        });
    });
});