import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { createProductionContainer } from '../../di/container';
import { GetUserProfileHandlerDependencies } from '../../di/dependencies';
import {
    createSuccessResponse,
    createUnauthorizedResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';
import { createDefaultUserProfile } from '../../models/userProfile';

// ハンドラー作成関数
export const createHandler = (dependencies: GetUserProfileHandlerDependencies) => async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

    dependencies.logger.info('Get user profile request received');

    try {
        // 認証情報から userId を取得
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return createUnauthorizedResponse();
        }

        dependencies.logger.info('Processing get user profile request', { userId });

        // UserProfile取得
        let userProfile = await dependencies.userProfileRepository.getUserProfile(userId);

        // プロファイルが存在しない場合は初期作成
        if (!userProfile) {
            dependencies.logger.info('User profile not found, creating default profile', { userId });
            const defaultProfile = createDefaultUserProfile(userId);

            try {
                await dependencies.userProfileRepository.createUserProfile(defaultProfile);
                userProfile = defaultProfile;
            } catch (error) {
                // 既に存在する場合（競合状態）は再取得
                if (error instanceof Error && error.message === 'User profile already exists') {
                    dependencies.logger.info('User profile already exists, retrieving existing profile', { userId });
                    userProfile = await dependencies.userProfileRepository.getUserProfile(userId);
                    if (!userProfile) {
                        throw new Error('Failed to retrieve user profile after creation conflict');
                    }
                } else {
                    throw error;
                }
            }
        }

        dependencies.logger.info('User profile retrieved successfully', {
            userId,
            setupPhase: userProfile.setupPhase
        });

        return createSuccessResponse('Profile retrieved successfully', userProfile);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        dependencies.logger.error('Error getting user profile', { error: errorMessage });
        return createInternalErrorResponse('Failed to get user profile', error as Error);
    }
};

// Production configuration
const container = createProductionContainer();
const dependencies: GetUserProfileHandlerDependencies = {
    userProfileRepository: container.resolve('userProfileRepository'),
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