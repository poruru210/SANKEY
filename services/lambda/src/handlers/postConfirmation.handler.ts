import { PostConfirmationTriggerHandler } from 'aws-lambda';
import { SSMClient } from '@aws-sdk/client-ssm';

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';

import { MasterKeyService } from '../services/masterKeyService';

const logger = new Logger();
const tracer = new Tracer();

const ssmClient = tracer.captureAWSv3Client(new SSMClient({}));

const baseHandler: PostConfirmationTriggerHandler = async (event) => {
  logger.info('Post confirmation event received', { event });

  try {
    const userId = event.request.userAttributes.sub;
    const userPoolId = event.userPoolId;
    const email = event.request.userAttributes.email;

    logger.info('Setting up developer account', { userId, email });

    const masterKeyService = new MasterKeyService({
      ssmClient: tracer.captureAWSv3Client(ssmClient),
      logger
    });

    // 統一されたメソッドでマスターキー作成
    await masterKeyService.ensureMasterKeyExists(userId, email);

    logger.info('Master key setup completed successfully', { userId, email });
    return event;
  } catch (error) {
    logger.error('Unhandled error in post confirmation handler', { error });
    throw error;
  }
};

export const handler = middy(baseHandler)
    .use(injectLambdaContext(logger))
    .use(captureLambdaHandler(tracer));