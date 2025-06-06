import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { EAApplicationRepository } from '../../repositories/eaApplicationRepository';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EAApplication } from '../../models/eaApplication';
import {
    createSuccessResponse,
    createUnauthorizedResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';

// Powertools 初期化（サービス名を更新）
const logger = new Logger({ serviceName: 'get-applications' });
const tracer = new Tracer({ serviceName: 'get-applications' });

// DI対応: Repository を初期化
const ddbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repository = new EAApplicationRepository(docClient);

// レスポンス用の型定義
interface ApplicationListResponse {
    pending: ApplicationSummary[];
    awaitingNotification: ApplicationSummary[];
    active: ApplicationSummary[];
    history: ApplicationSummary[];
    count: {
        pending: number;
        awaitingNotification: number;
        active: number;
        history: number;
        total: number;
    };
}

interface ApplicationSummary {
    id: string;
    accountNumber: string;
    eaName: string;
    broker: string;
    email: string;
    xAccount: string;
    status: EAApplication['status'];
    appliedAt: string;
    updatedAt: string;
    notificationScheduledAt?: string;
    expiryDate?: string;
    licenseKey?: string;
}

// アプリケーションデータをサマリー形式に変換
function toApplicationSummary(app: EAApplication): ApplicationSummary {
    return {
        id: app.sk,
        accountNumber: app.accountNumber,
        eaName: app.eaName,
        broker: app.broker,
        email: app.email,
        xAccount: app.xAccount,
        status: app.status,
        appliedAt: app.appliedAt,
        updatedAt: app.updatedAt,
        notificationScheduledAt: app.notificationScheduledAt,
        expiryDate: app.expiryDate,
        licenseKey: app.licenseKey,
    };
}

// ベースハンドラ
const baseHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = event.requestContext.authorizer?.claims?.sub;

        if (!userId) {
            logger.error('No user ID found in authorizer claims');
            return createUnauthorizedResponse('User ID not found in authorization context');
        }

        logger.info('Fetching applications for user', { userId });

        // 統一データアクセス層を使用して全申請を取得
        const applications = await repository.getAllApplications(userId);

        logger.info('Applications retrieved', {
            userId,
            totalCount: applications.length,
            statuses: applications.reduce((acc, app) => {
                acc[app.status] = (acc[app.status] || 0) + 1;
                return acc;
            }, {} as Record<string, number>)
        });

        // ステータス別にグループ化
        const pending = applications
            .filter(app => app.status === 'Pending')
            .map(toApplicationSummary);

        const awaitingNotification = applications
            .filter(app => app.status === 'AwaitingNotification')
            .map(toApplicationSummary);

        const active = applications
            .filter(app => app.status === 'Active')
            .map(toApplicationSummary);

        const history = applications
            .filter(app => ['Cancelled', 'Expired', 'Revoked', 'Rejected'].includes(app.status))
            .map(toApplicationSummary);

        const response: ApplicationListResponse = {
            pending,
            awaitingNotification,
            active,
            history,
            count: {
                pending: pending.length,
                awaitingNotification: awaitingNotification.length,
                active: active.length,
                history: history.length,
                total: applications.length,
            },
        };

        logger.info('Response prepared', {
            userId,
            counts: response.count
        });

        // 統一レスポンス形式を使用
        return createSuccessResponse('Applications retrieved successfully', response);
    } catch (err) {
        logger.error('Error getting applications', err as Error);
        return createInternalErrorResponse('Failed to retrieve applications', err as Error);
    }
};

export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers:
            'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'GET,OPTIONS',
    }))
    .use(injectLambdaContext(logger))
    .use(captureLambdaHandler(tracer));