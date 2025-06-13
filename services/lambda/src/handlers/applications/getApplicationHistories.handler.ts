import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { createProductionContainer } from '../../di/container';
import { GetApplicationHistoriesHandlerDependencies } from '../../di/types';
import {
    createSuccessResponse,
    createUnauthorizedResponse,
    createValidationErrorResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';

// ハンドラー作成関数
export const createHandler = (dependencies: GetApplicationHistoriesHandlerDependencies) => async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    dependencies.logger.info('Get application histories request received');

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
        const result = await dependencies.eaApplicationRepository.getApplicationHistories(userId, decodedApplicationId);

        dependencies.logger.info('Application histories retrieved successfully', {
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
        dependencies.logger.error('Error retrieving application histories', { error });

        return createInternalErrorResponse(
            'Failed to retrieve application histories',
            error instanceof Error ? error : new Error(String(error))
        );
    }
};

// Production configuration
const container = createProductionContainer();
const dependencies: GetApplicationHistoriesHandlerDependencies = {
    eaApplicationRepository: container.resolve('eaApplicationRepository'),
    logger: container.resolve('logger'),
    tracer: container.resolve('tracer')
};

const baseHandler = createHandler(dependencies);

// middy + Powertools middleware 適用
export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'GET,OPTIONS',
    }))
    .use(injectLambdaContext(dependencies.logger, { clearState: true }))
    .use(captureLambdaHandler(dependencies.tracer));