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
import {
    createSuccessResponse,
    createUnauthorizedResponse,
    createNotFoundResponse,
    createValidationErrorResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';

const logger = new Logger({ serviceName: 'cancel-application' });
const tracer = new Tracer({ serviceName: 'cancel-application' });

// DI対応: Repository とクライアントを初期化
const ddbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repository = new EAApplicationRepository(docClient);

// メインハンドラ
const baseHandler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    logger.info('Cancel approval request received');

    try {
        // パスパラメータからidを取得
        const applicationId = event.pathParameters?.id;
        if (!applicationId) {
            return createValidationErrorResponse(
                'Missing application ID parameter',
                { parameter: 'id', received: applicationId }
            );
        }

        // デコード
        const decodedApplicationId = decodeURIComponent(applicationId);

        // ユーザーIDを認証情報から取得
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return createUnauthorizedResponse('User authentication required');
        }

        logger.info('Processing cancel request', {
            applicationId: decodedApplicationId,
            userId,
        });

        // アプリケーション ID を SK 形式に変換（既存システムとの互換性）
        let fullApplicationKey = decodedApplicationId;
        if (!decodedApplicationId.startsWith('APPLICATION#')) {
            fullApplicationKey = `APPLICATION#${decodedApplicationId}`;
        }

        // リポジトリを使用してアプリケーション取得
        const application = await repository.getApplication(userId, fullApplicationKey);
        if (!application) {
            logger.error('Application not found', { userId, applicationId: fullApplicationKey });
            return createNotFoundResponse('Application not found');
        }

        // ステータス確認（取り消し可能かチェック）
        if (application.status !== 'AwaitingNotification') {
            return createValidationErrorResponse(
                'Application cannot be cancelled',
                {
                    currentStatus: application.status,
                    allowedStatus: 'AwaitingNotification',
                    applicationId: fullApplicationKey
                }
            );
        }

        // 5分以内かチェック（追加の安全措置）
        const approvedAt = new Date(application.updatedAt);
        const now = new Date();
        const timeDiff = now.getTime() - approvedAt.getTime();
        const fiveMinutesInMs = 5 * 60 * 1000;

        if (timeDiff > fiveMinutesInMs) {
            return createValidationErrorResponse(
                'Cancellation period expired',
                {
                    message: 'Applications can only be cancelled within 5 minutes of approval.',
                    approvedAt: application.updatedAt,
                    timeElapsed: `${Math.round(timeDiff / 1000)} seconds`
                }
            );
        }

        // リポジトリを使用してアプリケーション取り消し実行
        const cancellationReason = `Cancelled by user within ${Math.round(timeDiff / 1000)} seconds of approval`;
        const cancelledAt = new Date().toISOString();
        await repository.cancelApplication(
            userId,
            fullApplicationKey,
            cancellationReason
        );

        logger.info('Application cancelled successfully', {
            applicationId: fullApplicationKey,
            userId,
            eaName: application.eaName,
            accountNumber: application.accountNumber,
            timeDiff: `${Math.round(timeDiff / 1000)} seconds`
        });

        // 統一レスポンス形式で返却
        return createSuccessResponse(
            'Application approval cancelled successfully',
            {
                id: decodedApplicationId,
                eaName: application.eaName,
                accountNumber: application.accountNumber,
                cancelledAt: cancelledAt,
                status: 'Cancelled',
                reason: cancellationReason
            }
        );

    } catch (error) {
        logger.error('Error cancelling application approval', { error });

        return createInternalErrorResponse(
            'Failed to cancel application approval',
            error instanceof Error ? error : new Error(String(error))
        );
    }
};

// middy + Powertools middleware 適用
export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'POST,OPTIONS',
    }))
    .use(injectLambdaContext(logger, { clearState: true }))
    .use(captureLambdaHandler(tracer));