// services/lambda/src/handlers/applications/getFailureStatus.handler.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { EAApplicationRepository } from '../../repositories/eaApplicationRepository';
import { MAX_RETRY_COUNT } from '../../models/eaApplication';
import {
    createSuccessResponse,
    createUnauthorizedResponse,
    createInternalErrorResponse,
    createForbiddenResponse
} from '../../utils/apiResponse';

const logger = new Logger({ serviceName: 'get-failure-status' });
const tracer = new Tracer({ serviceName: 'get-failure-status' });

// DI対応: Repository を初期化
const ddbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repository = new EAApplicationRepository(docClient);

// メインハンドラ
const baseHandler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    logger.info('Get failure status request received');

    try {
        // 認証情報からuserIdを取得
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return createUnauthorizedResponse('User authentication required');
        }

        const userRole = event.requestContext.authorizer?.claims?.role || 'developer';

        // クエリパラメータから詳細レベルを取得
        const queryParams = event.queryStringParameters || {};
        const includeDetails = queryParams.details === 'true';
        const includeAll = queryParams.all === 'true'; // 管理者用：全ユーザーの情報

        logger.info('Processing failure status request', {
            userId,
            userRole,
            includeDetails,
            includeAll
        });

        // 権限チェック：管理者以外は自分の情報のみ
        if (includeAll && userRole !== 'admin') {
            return createForbiddenResponse('Admin privileges required to view all users data');
        }

        try {
            let result;

            if (includeAll && userRole === 'admin') {
                // 管理者：全ユーザーの失敗レポート
                result = await repository.generateFailureReport();

                logger.info('Generated admin failure report', {
                    totalFailed: result.summary.totalFailed,
                    retryable: result.summary.retryable
                });

            } else if (includeDetails) {
                // 詳細レポート（個人用）
                result = await repository.generateFailureReport(userId);

                logger.info('Generated detailed failure report', {
                    userId,
                    totalFailed: result.summary.totalFailed,
                    retryable: result.summary.retryable
                });

            } else {
                // 基本統計情報のみ
                const [failureStats, failedApps, retryableApps] = await Promise.all([
                    repository.getFailureStatistics(userId),
                    repository.getFailedNotificationApplications(userId),
                    repository.getRetryableFailedNotifications(userId)
                ]);

                result = {
                    summary: {
                        ...failureStats,
                        maxRetryCount: MAX_RETRY_COUNT
                    },
                    applications: failedApps.map(app => ({
                        id: app.sk,
                        eaName: app.eaName,
                        email: app.email,
                        failureCount: app.failureCount || 0,
                        lastFailedAt: app.lastFailedAt,
                        isRetryable: (app.failureCount || 0) < MAX_RETRY_COUNT,
                        status: app.status
                    }))
                };

                logger.info('Generated basic failure status', {
                    userId,
                    totalFailures: failureStats.totalFailures,
                    retryableFailures: failureStats.retryableFailures
                });
            }

            return createSuccessResponse('Failure status retrieved successfully', result);

        } catch (error) {
            logger.error('Error retrieving failure status', { userId, error });
            return createInternalErrorResponse('Failed to retrieve failure status', error as Error);
        }

    } catch (error) {
        logger.error('Error in main handler', { error });
        return createInternalErrorResponse('Failed to process request', error as Error);
    }
};

// middy + Powertools middleware 適用
export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'GET,OPTIONS',
    }))
    .use(injectLambdaContext(logger, { clearState: true }))
    .use(captureLambdaHandler(tracer));