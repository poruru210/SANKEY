// services/lambda/src/repositories/eaApplicationRepository.ts
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    QueryCommand,
    UpdateCommand,
    DeleteCommand,
    UpdateCommandInput,
    QueryCommandOutput,
    GetCommandOutput,
    UpdateCommandOutput,
    PutCommandOutput,
    DeleteCommandOutput
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import {
    EAApplication,
    EAApplicationHistory,
    ApplicationStatus,
    HistoryAction,
    generateApplicationSK,
    isValidStatusTransition,
    getStatusTimestampField,
    generateHistorySK,
    getHistoryQueryPrefix,
    isTerminalStatus,
    calculateTTLWithConfig,
    MAX_RETRY_COUNT
} from '../models/eaApplication';

const logger = new Logger();

// 承認情報の型定義
interface ApprovalInfo {
    eaName: string;
    accountId: string;
    email: string;
    broker: string;
    expiryDate: string;
    notificationScheduledAt: string;
}

export class EAApplicationRepository {
    constructor(
        private docClient: DynamoDBDocumentClient,
        private tableName: string = process.env.TABLE_NAME || 'ea-applications-licenseservicedbstack'
    ) {}

    async createApplication(application: Omit<EAApplication, 'sk' | 'status' | 'updatedAt'>): Promise<EAApplication> {
        const now = new Date().toISOString();
        const sk = generateApplicationSK(
            application.appliedAt || now,
            application.broker,
            application.accountNumber,
            application.eaName
        );

        const item: EAApplication = {
            ...application,
            sk,
            status: 'Pending',
            appliedAt: application.appliedAt || now,
            updatedAt: now,
        };

        // 重複チェック：同じbroker + accountNumber + eaNameの組み合わせで Active/AwaitingNotification がないか
        const existingActive = await this.getActiveApplicationByBrokerAccount(
            application.broker,
            application.accountNumber,
            application.eaName
        );

        if (existingActive) {
            throw new Error(`Active application already exists for ${application.broker} account ${application.accountNumber} with EA ${application.eaName}`);
        }

        const command = new PutCommand({
            TableName: this.tableName,
            Item: item,
            ConditionExpression: 'attribute_not_exists(userId) AND attribute_not_exists(sk)',
        });

        await this.docClient.send(command);
        return item;
    }

    async getApplication(userId: string, sk: string): Promise<EAApplication | null> {
        const command = new GetCommand({
            TableName: this.tableName,
            Key: { userId, sk },
        });

        const result: GetCommandOutput = await this.docClient.send(command);
        return (result.Item as EAApplication) || null;
    }

    async getApplicationsByStatus(userId: string, status: EAApplication['status']): Promise<EAApplication[]> {
        const command = new QueryCommand({
            TableName: this.tableName,
            IndexName: 'StatusIndex',
            KeyConditionExpression: 'userId = :userId AND #status = :status',
            ExpressionAttributeNames: {
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':userId': userId,
                ':status': status,
            },
        });

        const result: QueryCommandOutput = await this.docClient.send(command);
        return (result.Items as EAApplication[]) || [];
    }

    async getAllApplications(userId: string): Promise<EAApplication[]> {
        const command = new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: 'userId = :userId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: {
                ':userId': userId,
                ':prefix': 'APPLICATION#',
            },
            ScanIndexForward: false, // 新しい順
        });

        const result: QueryCommandOutput = await this.docClient.send(command);
        return (result.Items as EAApplication[]) || [];
    }

    async getActiveApplicationByBrokerAccount(
        broker: string,
        accountNumber: string,
        eaName: string
    ): Promise<EAApplication | null> {
        const command = new QueryCommand({
            TableName: this.tableName,
            IndexName: 'BrokerAccountIndex',
            KeyConditionExpression: 'broker = :broker AND accountNumber = :accountNumber',
            FilterExpression: 'eaName = :eaName AND (#status = :active OR #status = :awaiting)',
            ExpressionAttributeNames: {
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':broker': broker,
                ':accountNumber': accountNumber,
                ':eaName': eaName,
                ':active': 'Active',
                ':awaiting': 'AwaitingNotification',
            },
        });

        const result: QueryCommandOutput = await this.docClient.send(command);
        return (result.Items?.[0] as EAApplication) || null;
    }

    async updateStatus(
        userId: string,
        sk: string,
        newStatus: ApplicationStatus,
        additionalUpdates?: Partial<EAApplication>
    ): Promise<EAApplication | null> {
        logger.info('Attempting to update application status in repository', { userId, sk, newStatus });
        const now = new Date().toISOString();

        const currentApp = await this.getApplication(userId, sk);
        if (!currentApp) {
            logger.warn('Application not found for status update', { userId, sk });
            throw new Error(`Application not found: userId=${userId}, sk=${sk}`);
        }

        if (!isValidStatusTransition(currentApp.status, newStatus)) {
            logger.warn('Invalid status transition attempt', { userId, sk, currentStatus: currentApp.status, newStatus });
            throw new Error(`Invalid status transition: ${currentApp.status} -> ${newStatus}`);
        }

        const updateParams: UpdateCommandInput = {
            TableName: this.tableName,
            Key: { userId, sk },
            UpdateExpression: 'SET #status = :newStatus, #updatedAt = :now',
            ExpressionAttributeNames: {
                '#status': 'status',
                '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
                ':newStatus': newStatus,
                ':now': now,
            },
            ReturnValues: 'ALL_NEW',
            ConditionExpression: 'attribute_exists(sk)',
        };

        // TTL設定の処理
        if (isTerminalStatus(newStatus)) {
            // 終了ステータスの場合、設定された期間後のTTLを設定
            const ttlValue = calculateTTLWithConfig(now);
            updateParams.UpdateExpression += ', #ttl = :ttl';
            updateParams.ExpressionAttributeNames!['#ttl'] = 'ttl';
            updateParams.ExpressionAttributeValues![':ttl'] = ttlValue;

            logger.info('Setting TTL for terminal status', {
                userId,
                sk,
                newStatus,
                ttlValue,
                ttlDate: new Date(ttlValue * 1000).toISOString(),
                ttlMonths: process.env.TTL_MONTHS || '6 (default)'
            });
        } else if (isTerminalStatus(currentApp.status) && !isTerminalStatus(newStatus)) {
            // 終了ステータスから非終了ステータスに変更する場合、TTLを削除
            updateParams.UpdateExpression += ' REMOVE #ttl';
            updateParams.ExpressionAttributeNames!['#ttl'] = 'ttl';

            logger.info('Removing TTL for non-terminal status', { userId, sk, newStatus });
        }

        // Handle additional updates
        if (additionalUpdates) {
            Object.entries(additionalUpdates).forEach(([key, value]) => {
                if (key !== 'status' && key !== 'updatedAt' && key !== 'ttl' && value !== undefined) {
                    const attrNameKey = `#${key}`;
                    const attrValueKey = `:${key}`;
                    updateParams.UpdateExpression += `, ${attrNameKey} = ${attrValueKey}`;
                    updateParams.ExpressionAttributeNames![attrNameKey] = key;
                    updateParams.ExpressionAttributeValues![attrValueKey] = value;
                }
            });
        }

        try {
            const result: UpdateCommandOutput = await this.docClient.send(new UpdateCommand(updateParams));
            logger.info('Successfully updated application status', { userId, sk, newStatus });
            return (result.Attributes as EAApplication) || null;
        } catch (error) {
            logger.error('Failed to update application status', { userId, sk, newStatus, error });
            throw error;
        }
    }

    async recordHistory(params: {
        userId: string;
        applicationSK: string;
        action: HistoryAction;
        changedBy: string;
        previousStatus?: ApplicationStatus;
        newStatus?: ApplicationStatus;
        reason?: string;
        errorDetails?: string;
        retryCount?: number;
    }): Promise<void> {
        const { userId, applicationSK, action, changedBy, previousStatus, newStatus, reason, errorDetails, retryCount } = params;
        const now = new Date().toISOString();

        // 修正: 新しいgenerateHistorySK関数を使用（applicationSK全体 + timestamp）
        const historySkValue = generateHistorySK(applicationSK, now);

        const historyItem: EAApplicationHistory = {
            userId,
            sk: historySkValue,
            action,
            changedBy,
            changedAt: now,
            ...(previousStatus && { previousStatus }),
            ...(newStatus && { newStatus }),
            ...(reason && { reason }),
            ...(errorDetails && { errorDetails }),
            ...(retryCount && { retryCount }),
        };

        // 新しいステータスが終了ステータスの場合、履歴にもTTLを設定
        if (newStatus && isTerminalStatus(newStatus)) {
            historyItem.ttl = calculateTTLWithConfig(now);
            logger.info('Setting TTL for history record', {
                userId,
                historySkValue,
                newStatus,
                ttl: historyItem.ttl,
                ttlMonths: process.env.TTL_MONTHS || '6 (default)'
            });
        }

        try {
            const result: PutCommandOutput = await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: historyItem,
            }));
            logger.info('Successfully recorded history event', { action, userId, historySkValue });
        } catch (error) {
            logger.error('Failed to record history event', { error, action, userId });
            throw error;
        }
    }

    // 履歴レコードのTTL設定メソッド
    async setHistoryTTL(
        userId: string,
        applicationSK: string,
        ttlTimestamp: number
    ): Promise<void> {
        logger.info('Setting TTL for history records', { userId, applicationSK, ttlTimestamp });

        // 履歴レコードを取得
        const histories = await this.getApplicationHistories(userId, applicationSK);

        // 各履歴レコードにTTLを設定
        const updatePromises = histories.map(history => {
            const updateParams: UpdateCommandInput = {
                TableName: this.tableName,
                Key: { userId, sk: history.sk },
                UpdateExpression: 'SET #ttl = :ttl',
                ExpressionAttributeNames: {
                    '#ttl': 'ttl',
                },
                ExpressionAttributeValues: {
                    ':ttl': ttlTimestamp,
                },
            };

            return this.docClient.send(new UpdateCommand(updateParams)) as Promise<UpdateCommandOutput>;
        });

        try {
            await Promise.all(updatePromises);
            logger.info('Successfully set TTL for all history records', {
                userId,
                applicationSK,
                count: histories.length
            });
        } catch (error) {
            logger.error('Failed to set TTL for history records', { userId, applicationSK, error });
            throw error;
        }
    }

    // TTL付きでステータス更新と履歴のTTLも同時に設定
    async updateStatusWithHistoryTTL(
        userId: string,
        sk: string,
        newStatus: ApplicationStatus,
        additionalUpdates?: Partial<EAApplication>
    ): Promise<EAApplication | null> {
        const updatedApp = await this.updateStatus(userId, sk, newStatus, additionalUpdates);

        // 終了ステータスの場合、履歴にもTTLを設定
        if (updatedApp && isTerminalStatus(newStatus)) {
            const ttlValue = calculateTTLWithConfig();
            await this.setHistoryTTL(userId, sk, ttlValue);
        }

        return updatedApp;
    }

    async activateApplicationWithLicense(
        userId: string,
        sk: string,
        licenseKey: string,
        issuedAt: string
    ): Promise<void> {
        logger.info('Activating application with license', { userId, sk, issuedAt });

        const currentApp = await this.getApplication(userId, sk);
        if (!currentApp) {
            throw new Error(`Application not found: userId=${userId}, sk=${sk}`);
        }

        await this.updateStatus(userId, sk, 'Active', {
            licenseKey,
        });

        // 履歴記録
        await this.recordHistory({
            userId,
            applicationSK: sk,
            action: 'Active' as HistoryAction,
            changedBy: 'system',
            previousStatus: 'AwaitingNotification',
            newStatus: 'Active',
            reason: 'License generated and email sent successfully',
        });
    }

    async cancelApplication(
        userId: string,
        sk: string,
        reason: string
    ): Promise<void> {
        logger.info('Cancelling application', { userId, sk, reason });

        const currentApp = await this.getApplication(userId, sk);
        if (!currentApp) {
            throw new Error(`Application not found: userId=${userId}, sk=${sk}`);
        }

        // ステータス確認
        if (currentApp.status !== 'AwaitingNotification') {
            throw new Error(`Cannot cancel application in ${currentApp.status} status`);
        }

        // TTL付きでステータス更新
        await this.updateStatusWithHistoryTTL(userId, sk, 'Cancelled');

        // 履歴記録
        await this.recordHistory({
            userId,
            applicationSK: sk,
            action: 'Cancelled' as HistoryAction,
            changedBy: userId,
            previousStatus: 'AwaitingNotification',
            newStatus: 'Cancelled',
            reason
        });
    }

    async getApplicationHistories(
        userId: string,
        applicationSk: string
    ): Promise<EAApplicationHistory[]> {
        logger.info('Getting application histories', { userId, applicationSk });

        const historyPrefix = getHistoryQueryPrefix(applicationSk);

        const command = new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: 'userId = :userId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: {
                ':userId': userId,
                ':prefix': historyPrefix,
            },
            ScanIndexForward: false,
        });

        try {
            const result: QueryCommandOutput = await this.docClient.send(command);
            const histories = (result.Items as EAApplicationHistory[]) || [];

            logger.info('Successfully retrieved application histories', {
                userId,
                applicationSk,
                historyPrefix,
                count: histories.length
            });

            return histories;
        } catch (error) {
            logger.error('Failed to get application histories', { userId, applicationSk, error });
            throw error;
        }
    }

    async deleteApplication(userId: string, sk: string): Promise<void> {
        const command = new DeleteCommand({
            TableName: this.tableName,
            Key: { userId, sk },
        });

        const result: DeleteCommandOutput = await this.docClient.send(command);
    }

    async updateApprovalInfo(
        userId: string,
        sk: string,
        approvalInfo: ApprovalInfo
    ): Promise<void> {
        logger.info('Updating approval info', { userId, sk, approvalInfo });

        await this.updateStatus(userId, sk, 'AwaitingNotification', {
            eaName: approvalInfo.eaName,
            email: approvalInfo.email,
            expiryDate: approvalInfo.expiryDate,
        });

        // 履歴記録
        await this.recordHistory({
            userId,
            applicationSK: sk,
            action: 'AwaitingNotification' as HistoryAction,
            changedBy: userId,
            previousStatus: 'Pending',
            newStatus: 'AwaitingNotification',
            reason: 'Application approved, waiting for license generation and email notification',
        });
    }

    // システムによる期限切れ処理（TTL付き）
    async expireApplication(userId: string, sk: string): Promise<void> {
        logger.info('Expiring application', { userId, sk });

        // TTL付きでステータス更新
        await this.updateStatusWithHistoryTTL(userId, sk, 'Expired');

        // 履歴記録
        await this.recordHistory({
            userId,
            applicationSK: sk,
            action: 'SystemExpired' as HistoryAction,
            changedBy: 'system',
            previousStatus: 'Active',
            newStatus: 'Expired',
            reason: 'License expired automatically'
        });
    }

    // 手動でTTL期間を指定して調整する場合
    async adjustTTL(userId: string, sk: string, months: number): Promise<void> {
        const customTTL = calculateTTLWithConfig(undefined);
        const adjustedDate = new Date(customTTL * 1000);
        // 現在の設定期間からの差分を計算
        const currentMonths = parseInt(process.env.TTL_MONTHS || '6', 10);
        adjustedDate.setMonth(adjustedDate.getMonth() + (months - currentMonths));

        const adjustedTTL = Math.floor(adjustedDate.getTime() / 1000);

        const result: UpdateCommandOutput = await this.docClient.send(new UpdateCommand({
            TableName: this.tableName,
            Key: { userId, sk },
            UpdateExpression: 'SET #ttl = :ttl',
            ExpressionAttributeNames: { '#ttl': 'ttl' },
            ExpressionAttributeValues: { ':ttl': adjustedTTL }
        }));

        logger.info('TTL adjusted', {
            userId,
            sk,
            requestedMonths: months,
            adjustedTTL,
            adjustedDate: new Date(adjustedTTL * 1000).toISOString()
        });
    }

    // =========== 失敗通知処理関連のメソッド（新規追加） ===========

    /**
     * 失敗した通知を再送用に AwaitingNotification ステータスに戻す
     */
    async retryFailedNotification(
        userId: string,
        sk: string,
        retryReason: string = 'Manual retry requested'
    ): Promise<EAApplication | null> {
        logger.info('Retrying failed notification', { userId, sk, retryReason });

        const currentApp = await this.getApplication(userId, sk);
        if (!currentApp) {
            throw new Error(`Application not found: userId=${userId}, sk=${sk}`);
        }

        // ステータス確認
        if (currentApp.status !== 'FailedNotification') {
            throw new Error(`Cannot retry notification for application in ${currentApp.status} status`);
        }

        // リトライ回数の確認
        const currentFailureCount = currentApp.failureCount || 0;
        if (currentFailureCount >= MAX_RETRY_COUNT) {
            logger.warn('Retry attempted for application that exceeded max retry count', {
                userId,
                sk,
                currentFailureCount,
                maxRetryCount: MAX_RETRY_COUNT
            });
            // ただし、手動リトライの場合は許可する場合もある
        }

        const now = new Date().toISOString();

        // 5分後の通知スケジュール時刻を設定
        const delaySeconds = parseInt(process.env.SQS_DELAY_SECONDS || '300', 10);
        const notificationScheduledAt = new Date(Date.now() + delaySeconds * 1000).toISOString();

        // ステータスを AwaitingNotification に戻す
        const updatedApp = await this.updateStatus(userId, sk, 'AwaitingNotification', {
            notificationScheduledAt,
            // 失敗情報は保持する（参考情報として）
            // lastFailureReason と lastFailedAt は残す
            // failureCount はリセットしない（累積として残す）
        });

        // 履歴記録
        await this.recordHistory({
            userId,
            applicationSK: sk,
            action: 'RetryNotification',
            changedBy: userId, // または 'admin', 'system' など実際の操作者
            previousStatus: 'FailedNotification',
            newStatus: 'AwaitingNotification',
            reason: retryReason,
            retryCount: currentFailureCount + 1
        });

        logger.info('Failed notification retry prepared', {
            userId,
            sk,
            notificationScheduledAt,
            previousFailureCount: currentFailureCount
        });

        return updatedApp;
    }

    /**
     * 失敗通知のステータスを持つアプリケーションを取得
     */
    async getFailedNotificationApplications(userId: string): Promise<EAApplication[]> {
        const command = new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: 'userId = :userId AND begins_with(sk, :prefix)',
            FilterExpression: '#status = :failedStatus',
            ExpressionAttributeNames: {
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':userId': userId,
                ':prefix': 'APPLICATION#',
                ':failedStatus': 'FailedNotification',
            },
            ScanIndexForward: false, // 新しい順
        });

        const result: QueryCommandOutput = await this.docClient.send(command);
        return (result.Items as EAApplication[]) || [];
    }

    /**
     * リトライ可能な失敗通知を取得（最大リトライ回数未満）
     */
    async getRetryableFailedNotifications(userId: string): Promise<EAApplication[]> {
        const failedApps = await this.getFailedNotificationApplications(userId);

        return failedApps.filter(app =>
            (app.failureCount || 0) < MAX_RETRY_COUNT
        );
    }

    /**
     * 全ユーザーの失敗通知を取得（管理者用）
     */
    async getAllFailedNotificationApplications(): Promise<EAApplication[]> {
        // GSI を使用して status ベースでクエリ
        // 注意: この実装には StatusIndex が必要
        const command = new QueryCommand({
            TableName: this.tableName,
            IndexName: 'StatusIndex', // ステータス用のGSI
            KeyConditionExpression: '#status = :failedStatus',
            ExpressionAttributeNames: {
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':failedStatus': 'FailedNotification',
            },
        });

        const result = await this.docClient.send(command);
        return result.Items as EAApplication[] || [];
    }

    /**
     * アプリケーションの失敗統計を取得
     */
    async getFailureStatistics(userId: string): Promise<{
        totalFailures: number;
        retryableFailures: number;
        maxRetryExceeded: number;
        recentFailures: number; // 24時間以内
    }> {
        const failedApps = await this.getFailedNotificationApplications(userId);
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const stats = {
            totalFailures: failedApps.length,
            retryableFailures: 0,
            maxRetryExceeded: 0,
            recentFailures: 0
        };

        failedApps.forEach(app => {
            const failureCount = app.failureCount || 0;

            if (failureCount < MAX_RETRY_COUNT) {
                stats.retryableFailures++;
            } else {
                stats.maxRetryExceeded++;
            }

            if (app.lastFailedAt) {
                const lastFailedDate = new Date(app.lastFailedAt);
                if (lastFailedDate > twentyFourHoursAgo) {
                    stats.recentFailures++;
                }
            }
        });

        return stats;
    }

    /**
     * 失敗したアプリケーションの詳細レポート生成
     */
    async generateFailureReport(userId?: string): Promise<{
        summary: {
            totalFailed: number;
            retryable: number;
            nonRetryable: number;
            avgFailureCount: number;
        };
        applications: Array<{
            userId: string;
            applicationSK: string;
            eaName: string;
            email: string;
            failureCount: number;
            lastFailureReason?: string;
            lastFailedAt?: string;
            isRetryable: boolean;
        }>;
    }> {
        let failedApps: EAApplication[];

        if (userId) {
            failedApps = await this.getFailedNotificationApplications(userId);
        } else {
            failedApps = await this.getAllFailedNotificationApplications();
        }

        const applications = failedApps.map(app => ({
            userId: app.userId,
            applicationSK: app.sk,
            eaName: app.eaName,
            email: app.email,
            failureCount: app.failureCount || 0,
            lastFailureReason: app.lastFailureReason,
            lastFailedAt: app.lastFailedAt,
            isRetryable: (app.failureCount || 0) < MAX_RETRY_COUNT
        }));

        const retryableCount = applications.filter(app => app.isRetryable).length;
        const totalFailureCount = applications.reduce((sum, app) => sum + app.failureCount, 0);

        return {
            summary: {
                totalFailed: applications.length,
                retryable: retryableCount,
                nonRetryable: applications.length - retryableCount,
                avgFailureCount: applications.length > 0 ? totalFailureCount / applications.length : 0
            },
            applications
        };
    }
}