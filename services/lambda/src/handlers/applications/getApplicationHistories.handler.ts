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
    createValidationErrorResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';

const logger = new Logger({ serviceName: 'get-application-histories' });
const tracer = new Tracer({ serviceName: 'get-application-histories' });

// DI対応: Repository とクライアントを初期化
const ddbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repository = new EAApplicationRepository(docClient);

// メインハンドラ
const baseHandler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    logger.info('Get application histories request received');

    try {
        // ユーザーIDを認証情報から取得
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return createUnauthorizedResponse('User authentication required');
        }

        // RESTful: パスパラメータから ID を取得
        const applicationId = event.pathParameters?.id;
        if (!applicationId) {
            return createValidationErrorResponse('Application ID is required');
        }

        // デコード
        const decodedApplicationId = decodeURIComponent(applicationId);

        // 全アプリケーション履歴を取得
        const result = await repository.getApplicationHistories(userId,decodedApplicationId);

        logger.info('Application histories retrieved successfully', {
            userId,
            total: result?.length
        });

        // 統一レスポンス形式で返却
        return createSuccessResponse(
            'Application histories retrieved successfully',
            {
                id: applicationId,
                histories: result
            }
        );

    } catch (error) {
        logger.error('Error retrieving application histories', { error });

        return createInternalErrorResponse(
            'Failed to retrieve application histories',
            error instanceof Error ? error : new Error(String(error))
        );
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