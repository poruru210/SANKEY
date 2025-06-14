import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { createProductionContainer } from '../../di/container';
import { UpdateUserProfileHandlerDependencies } from '../../di/dependencies';
import {
    createSuccessResponse,
    createValidationErrorResponse,
    createUnauthorizedResponse,
    createNotFoundResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';
import { UserProfile, SetupPhase, isValidSetupPhase, canProgressToPhase } from '../../models/userProfile';

// 更新リクエスト形式
interface UpdateProfileRequest {
    setupPhase?: SetupPhase;
    notificationEnabled?: boolean;
}

// バリデーション関数
function validateUpdateRequest(requestBody: UpdateProfileRequest, currentProfile: UserProfile): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // setupPhase のバリデーション
    if (requestBody.setupPhase !== undefined) {
        if (!isValidSetupPhase(requestBody.setupPhase)) {
            errors.push('setupPhase must be one of: SETUP, TEST, PRODUCTION');
        } else if (!canProgressToPhase(currentProfile.setupPhase, requestBody.setupPhase)) {
            errors.push(`Cannot progress from ${currentProfile.setupPhase} to ${requestBody.setupPhase}. Must follow order: SETUP -> TEST -> PRODUCTION`);
        }
    }

    // notificationEnabled のバリデーション
    if (requestBody.notificationEnabled !== undefined && typeof requestBody.notificationEnabled !== 'boolean') {
        errors.push('notificationEnabled must be a boolean');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

// ハンドラー作成関数
export const createHandler = (dependencies: UpdateUserProfileHandlerDependencies) => async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {

    dependencies.logger.info('Update user profile request received');

    try {
        // 認証情報から userId を取得
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return createUnauthorizedResponse();
        }

        // リクエストボディの解析
        if (!event.body) {
            return createValidationErrorResponse('Request body is required');
        }

        let requestBody: UpdateProfileRequest;
        try {
            requestBody = JSON.parse(event.body);
        } catch (e) {
            dependencies.logger.error('Failed to parse request body', { error: e, body: event.body });
            return createValidationErrorResponse('Invalid JSON in request body');
        }

        dependencies.logger.info('Processing update user profile request', {
            userId,
            updateFields: Object.keys(requestBody)
        });

        // 現在のプロファイルを取得
        const currentProfile = await dependencies.userProfileRepository.getUserProfile(userId);
        if (!currentProfile) {
            return createNotFoundResponse('User profile not found');
        }

        // バリデーション
        const validation = validateUpdateRequest(requestBody, currentProfile);
        if (!validation.isValid) {
            return createValidationErrorResponse(
                'Validation failed',
                { errors: validation.errors }
            );
        }

        // プロファイル更新
        const updatedProfile = await dependencies.userProfileRepository.updateUserProfile(
            userId,
            requestBody
        );

        dependencies.logger.info('User profile updated successfully', {
            userId,
            updatedFields: Object.keys(requestBody),
            setupPhase: updatedProfile.setupPhase
        });

        return createSuccessResponse('Profile updated successfully', updatedProfile);

    } catch (error) {
        dependencies.logger.error('Error updating user profile', { error });
        return createInternalErrorResponse('Failed to update user profile', error as Error);
    }
};

// Production configuration
const container = createProductionContainer();
const dependencies: UpdateUserProfileHandlerDependencies = {
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
        methods: 'PUT,OPTIONS',
    }))
    .use(injectLambdaContext(dependencies.logger, { clearState: true }))
    .use(captureLambdaHandler(dependencies.tracer));