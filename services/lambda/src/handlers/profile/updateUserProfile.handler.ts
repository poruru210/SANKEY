import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { createProductionContainer } from '../../di/container';
import { UpdateUserProfileHandlerDependencies } from '../../di/types';
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

// UserProfile取得
async function getUserProfile(
    userId: string,
    dependencies: UpdateUserProfileHandlerDependencies
): Promise<UserProfile | null> {
    try {
        const command = new GetCommand({
            TableName: process.env.USER_PROFILE_TABLE_NAME!,
            Key: { userId }
        });

        const result = await dependencies.docClient.send(command);
        return result.Item as UserProfile || null;
    } catch (error) {
        dependencies.logger.error('Failed to get user profile', { error, userId });
        throw error;
    }
}

// UserProfile更新
async function updateUserProfile(
    userId: string,
    updates: UpdateProfileRequest,
    currentProfile: UserProfile,
    dependencies: UpdateUserProfileHandlerDependencies
): Promise<UserProfile> {
    try {
        const timestamp = new Date().toISOString();

        // 更新するフィールドを構築
        const updateExpressions: string[] = [];
        const expressionAttributeNames: Record<string, string> = {};
        const expressionAttributeValues: Record<string, any> = {};

        // setupPhase の更新
        if (updates.setupPhase) {
            updateExpressions.push('#setupPhase = :setupPhase');
            expressionAttributeNames['#setupPhase'] = 'setupPhase';
            expressionAttributeValues[':setupPhase'] = updates.setupPhase;
        }

        // notificationEnabled の更新
        if (typeof updates.notificationEnabled === 'boolean') {
            updateExpressions.push('#notificationEnabled = :notificationEnabled');
            expressionAttributeNames['#notificationEnabled'] = 'notificationEnabled';
            expressionAttributeValues[':notificationEnabled'] = updates.notificationEnabled;
        }

        // updatedAt は常に更新
        updateExpressions.push('#updatedAt = :updatedAt');
        expressionAttributeNames['#updatedAt'] = 'updatedAt';
        expressionAttributeValues[':updatedAt'] = timestamp;

        const command = new UpdateCommand({
            TableName: process.env.USER_PROFILE_TABLE_NAME!,
            Key: { userId },
            UpdateExpression: `SET ${updateExpressions.join(', ')}`,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        });

        const result = await dependencies.docClient.send(command);
        return result.Attributes as UserProfile;
    } catch (error) {
        dependencies.logger.error('Failed to update user profile', { error, userId, updates });
        throw error;
    }
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
    if (!(requestBody.notificationEnabled === undefined) && typeof requestBody.notificationEnabled !== 'boolean') {
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
        const currentProfile = await getUserProfile(userId, dependencies);
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
        const updatedProfile = await updateUserProfile(userId, requestBody, currentProfile, dependencies);

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
    docClient: container.resolve('docClient'),
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