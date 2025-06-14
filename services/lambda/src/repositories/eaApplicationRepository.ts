// src/repositories/eaApplicationRepository.ts
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    QueryCommand,
    UpdateCommand,
    DeleteCommand,
    UpdateCommandInput
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
    calculateTTLWithConfig
} from '../models/eaApplication';
import { EAApplicationRepositoryDependencies } from '../di/dependencies';

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
    private readonly docClient: DynamoDBDocumentClient;
    private readonly tableName: string;
    private readonly logger: Logger;

    constructor(dependencies: EAApplicationRepositoryDependencies) {
        this.docClient = dependencies.docClient;
        this.tableName = dependencies.tableName;
        this.logger = dependencies.logger;
    }

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

        const result = await this.docClient.send(command);
        return result.Item as EAApplication || null;
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

        const result = await this.docClient.send(command);
        return result.Items as EAApplication[] || [];
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

        const result = await this.docClient.send(command);
        return result.Items as EAApplication[] || [];
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

        const result = await this.docClient.send(command);
        return result.Items?.[0] as EAApplication || null;
    }

    async updateStatus(
        userId: string,
        sk: string,
        newStatus: ApplicationStatus,
        additionalUpdates?: Partial<EAApplication>
    ): Promise<EAApplication | null> {
        this.logger.info('Attempting to update application status in repository', { userId, sk, newStatus });
        const now = new Date().toISOString();

        const currentApp = await this.getApplication(userId, sk);
        if (!currentApp) {
            this.logger.warn('Application not found for status update', { userId, sk });
            throw new Error(`Application not found: userId=${userId}, sk=${sk}`);
        }

        if (!isValidStatusTransition(currentApp.status, newStatus)) {
            this.logger.warn('Invalid status transition attempt', { userId, sk, currentStatus: currentApp.status, newStatus });
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

            this.logger.info('Setting TTL for terminal status', {
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

            this.logger.info('Removing TTL for non-terminal status', { userId, sk, newStatus });
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
            const { Attributes } = await this.docClient.send(new UpdateCommand(updateParams));
            this.logger.info('Successfully updated application status', { userId, sk, newStatus });
            return Attributes as EAApplication | null;
        } catch (error) {
            this.logger.error('Failed to update application status', { userId, sk, newStatus, error });
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
    }): Promise<void> {
        const { userId, applicationSK, action, changedBy, previousStatus, newStatus, reason } = params;
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
        };

        // 新しいステータスが終了ステータスの場合、履歴にもTTLを設定
        if (newStatus && isTerminalStatus(newStatus)) {
            historyItem.ttl = calculateTTLWithConfig(now);
            this.logger.info('Setting TTL for history record', {
                userId,
                historySkValue,
                newStatus,
                ttl: historyItem.ttl,
                ttlMonths: process.env.TTL_MONTHS || '6 (default)'
            });
        }

        try {
            await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: historyItem,
            }));
            this.logger.info('Successfully recorded history event', { action, userId, historySkValue });
        } catch (error) {
            this.logger.error('Failed to record history event', { error, action, userId });
            throw error;
        }
    }

    // 履歴レコードのTTL設定メソッド
    async setHistoryTTL(
        userId: string,
        applicationSK: string,
        ttlTimestamp: number
    ): Promise<void> {
        this.logger.info('Setting TTL for history records', { userId, applicationSK, ttlTimestamp });

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

            return this.docClient.send(new UpdateCommand(updateParams));
        });

        try {
            await Promise.all(updatePromises);
            this.logger.info('Successfully set TTL for all history records', {
                userId,
                applicationSK,
                count: histories.length
            });
        } catch (error) {
            this.logger.error('Failed to set TTL for history records', { userId, applicationSK, error });
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
    ): Promise<EAApplication> {  // 🔧 戻り値をEAApplicationに変更
        this.logger.info('Activating application with license', { userId, sk, issuedAt });

        const currentApp = await this.getApplication(userId, sk);
        if (!currentApp) {
            throw new Error(`Application not found: userId=${userId}, sk=${sk}`);
        }

        // 🔧 updateStatusの戻り値を使用
        const updatedApp = await this.updateStatus(userId, sk, 'Active', {
            licenseKey,
        });

        if (!updatedApp) {
            throw new Error('Failed to update application status');
        }

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

        return updatedApp;  // 🔧 更新後のアプリケーションを返す
    }

    async cancelApplication(
        userId: string,
        sk: string,
        reason: string
    ): Promise<void> {
        this.logger.info('Cancelling application', { userId, sk, reason });

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
        this.logger.info('Getting application histories', { userId, applicationSk });

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
            const result = await this.docClient.send(command);
            const histories = result.Items as EAApplicationHistory[] || [];

            this.logger.info('Successfully retrieved application histories', {
                userId,
                applicationSk,
                historyPrefix,
                count: histories.length
            });

            return histories;
        } catch (error) {
            this.logger.error('Failed to get application histories', { userId, applicationSk, error });
            throw error;
        }
    }

    async deleteApplication(userId: string, sk: string): Promise<void> {
        const command = new DeleteCommand({
            TableName: this.tableName,
            Key: { userId, sk },
        });

        await this.docClient.send(command);
    }

    async updateApprovalInfo(
        userId: string,
        sk: string,
        approvalInfo: ApprovalInfo
    ): Promise<void> {
        this.logger.info('Updating approval info', { userId, sk, approvalInfo });

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
        this.logger.info('Expiring application', { userId, sk });

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

        await this.docClient.send(new UpdateCommand({
            TableName: this.tableName,
            Key: { userId, sk },
            UpdateExpression: 'SET #ttl = :ttl',
            ExpressionAttributeNames: { '#ttl': 'ttl' },
            ExpressionAttributeValues: { ':ttl': adjustedTTL }
        }));

        this.logger.info('TTL adjusted', {
            userId,
            sk,
            requestedMonths: months,
            adjustedTTL,
            adjustedDate: new Date(adjustedTTL * 1000).toISOString()
        });
    }
}