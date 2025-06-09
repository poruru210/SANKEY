import { PostConfirmationTriggerHandler } from 'aws-lambda';
import { SSMClient, PutParameterCommand, GetParameterCommand } from '@aws-sdk/client-ssm';
import { webcrypto } from 'crypto';

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';

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

    // 1. マスターキーを生成してSSMへ保存
    const masterKey = webcrypto.getRandomValues(new Uint8Array(32));
    const masterKeyBase64 = Buffer.from(masterKey).toString('base64');

    // 環境変数からSSMパスプレフィックスを取得
    const userPrefix = process.env.SSM_USER_PREFIX!; // /sankey-dev/users
    const ssmParameterName = `${userPrefix}/${userId}/master-key`;

    try {
      await ssmClient.send(new GetParameterCommand({ Name: ssmParameterName }));
      logger.info(`SSM parameter already exists`, { ssmParameterName });
    } catch (error: any) {
      if (error.name === 'ParameterNotFound') {
        await ssmClient.send(
            new PutParameterCommand({
              Name: ssmParameterName,
              Value: masterKeyBase64,
              Type: 'String',
              Description: `Master key for user ${email}`,
              Tags: [
                { Key: 'userId', Value: userId },
                { Key: 'email', Value: email },
              ],
            })
        );
        logger.info('Created new SSM parameter', { ssmParameterName });
      } else {
        logger.error('Unexpected error fetching SSM parameter', { error });
        throw error;
      }
    }

    return event;
  } catch (error) {
    logger.error('Unhandled error in post confirmation handler', { error });
    throw error;
  }
};

export const handler = middy(baseHandler)
    .use(injectLambdaContext(logger))
    .use(captureLambdaHandler(tracer));