import { PostConfirmationTriggerEvent } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';

import { createProductionContainer } from '../di/container';
import { PostConfirmationHandlerDependencies } from '../di/types';
import { createDefaultUserProfile } from '../models/userProfile';

async function createInitialUserProfile(
    dependencies: PostConfirmationHandlerDependencies,
    userId: string,
    email: string
): Promise<void> {
  const USER_PROFILE_TABLE_NAME = process.env.USER_PROFILE_TABLE_NAME;

  if (!USER_PROFILE_TABLE_NAME) {
    dependencies.logger.debug('USER_PROFILE_TABLE_NAME not configured, skipping UserProfile creation');
    return;
  }

  try {
    const initialProfile = createDefaultUserProfile(userId);

    const command = new PutCommand({
      TableName: USER_PROFILE_TABLE_NAME,
      Item: initialProfile,
      ConditionExpression: 'attribute_not_exists(userId)'
    });

    await dependencies.docClient.send(command);

    dependencies.logger.info('UserProfile created successfully', {
      userId,
      email,
      setupPhase: initialProfile.setupPhase
    });

  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      dependencies.logger.info('UserProfile already exists, skipping creation', { userId, email });
      return;
    }

    dependencies.logger.error('Failed to create UserProfile', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      email
    });
  }
}

export const createHandler = (dependencies: PostConfirmationHandlerDependencies) => async (
    event: PostConfirmationTriggerEvent
): Promise<PostConfirmationTriggerEvent> => {
  dependencies.logger.info('Post confirmation event received', { event });

  try {
    const userId = event.request.userAttributes.sub;
    const userPoolId = event.userPoolId;
    const email = event.request.userAttributes.email;

    dependencies.logger.info('Setting up developer account', { userId, email });

    // Master key setup
    await dependencies.masterKeyService.ensureMasterKeyExists(userId, email);
    dependencies.logger.info('Master key setup completed successfully', { userId, email });

    // JWT secret setup
    await dependencies.jwtKeyService.ensureJwtSecretExists(userId, email);
    dependencies.logger.info('JWT secret setup completed successfully', { userId, email });

    // UserProfile creation
    await createInitialUserProfile(dependencies, userId, email);

    dependencies.logger.info('User setup completed successfully', {
      userId,
      email,
      createdKeys: ['master-key', 'jwt-secret'],
      createdResources: ['user-profile']
    });

    return event;
  } catch (error) {
    dependencies.logger.error('Unhandled error in post confirmation handler', { error });
    throw error;
  }
};

// Production configuration
const container = createProductionContainer();
const dependencies: PostConfirmationHandlerDependencies = {
  masterKeyService: container.resolve('masterKeyService'),
  jwtKeyService: container.resolve('jwtKeyService'),
  docClient: container.resolve('docClient'),
  logger: container.resolve('logger'),
  tracer: container.resolve('tracer')
};

const baseHandler = createHandler(dependencies);

export const handler = middy(baseHandler)
    .use(injectLambdaContext(dependencies.logger))
    .use(captureLambdaHandler(dependencies.tracer));