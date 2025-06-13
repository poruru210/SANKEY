import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import httpCors from '@middy/http-cors';

import { createProductionContainer } from '../../di/container';
import { GetUserProfileHandlerDependencies } from '../../di/types';
import {
    createSuccessResponse,
    createUnauthorizedResponse,
    createInternalErrorResponse
} from '../../utils/apiResponse';
import { UserProfile, createDefaultUserProfile } from '../../models/userProfile';

// UserProfile取得
async function getUserProfile(
    userId: string,
    dependencies: GetUserProfileHandlerDependencies
): Promise<UserProfile | null> {
    try {
        const command = new GetCommand({
            TableName: process.env.USER_PROFILE_TABLE_NAME!,
            Key: { userId }
        });

        const result = await dependencies.docClient.send(command);
        return result.Item as UserProfile || null;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        dependencies.logger.error('Failed to get user profile', { error: errorMessage, userId });
        throw error;
    }
}

// 初期UserProfile作成
async function createInitialUserProfile(
    userId: string,
    dependencies: GetUserProfileHandlerDependencies
): Promise<UserProfile> {
    try {
        const defaultProfile = createDefaultUserProfile(userId);

        const command = new PutCommand({
            TableName: process.env.USER_PROFILE_TABLE_NAME!,
            Item: defaultProfile,
            ConditionExpression: 'attribute_not_exists(userId)'
        });

        await dependencies.docClient.send(command);

        dependencies.logger.info('Default user profile created', { userId });
        return defaultProfile;
    } catch (error) {
        // 既に存在する場合は再取得
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
            dependencies.logger.info('User profile already exists, retrieving existing profile', { userId });
            const existingProfile = await getUserProfile(userId, dependencies);
            if (existingProfile) {
                return existingProfile;
            }
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        dependencies.logger.error('Failed to create default user profile', { error: errorMessage, userId });
        throw error;
    }
}

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
        let userProfile = await getUserProfile(userId, dependencies);

        // プロファイルが存在しない場合は初期作成
        if (!userProfile) {
            dependencies.logger.info('User profile not found, creating default profile', { userId });
            userProfile = await createInitialUserProfile(userId, dependencies);
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
        methods: 'GET,OPTIONS',
    }))
    .use(injectLambdaContext(dependencies.logger, { clearState: true }))
    .use(captureLambdaHandler(dependencies.tracer));