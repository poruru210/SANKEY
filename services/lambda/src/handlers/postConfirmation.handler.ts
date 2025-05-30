import { PostConfirmationTriggerHandler } from 'aws-lambda';
import { SSMClient, PutParameterCommand, GetParameterCommand } from '@aws-sdk/client-ssm';
import { APIGatewayClient, CreateApiKeyCommand, CreateUsagePlanKeyCommand } from '@aws-sdk/client-api-gateway';
import { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } from '@aws-sdk/client-cognito-identity-provider';
import { webcrypto } from 'crypto';

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';

const logger = new Logger();
const tracer = new Tracer();

const ssmClient = tracer.captureAWSv3Client(new SSMClient({}));
const apiGatewayClient = tracer.captureAWSv3Client(new APIGatewayClient({}));
const cognitoClient = tracer.captureAWSv3Client(new CognitoIdentityProviderClient({}));

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
    const ssmParameterName = `/license-service/users/${userId}/master-key`;

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

    // 2. API Key 作成
    const apiKeyName = `license-key-${userId}-${Date.now()}`;
    const apiKeyResponse = await apiGatewayClient.send(
        new CreateApiKeyCommand({
          name: apiKeyName,
          description: `API Key for ${email}`,
          enabled: true,
          tags: {
            userId,
            email,
            tier: 'free',
          },
        })
    );

    if (!apiKeyResponse.id) {
      throw new Error('Failed to create API Key - no ID returned');
    }

    const apiKeyId = apiKeyResponse.id;
    const apiKeyValue = apiKeyResponse.value;
    logger.info('Created API Key', { apiKeyName, apiKeyId });

    // 3. Free Usage Plan に割り当て
    const freePlanIdParam = await ssmClient.send(
        new GetParameterCommand({ Name: '/license-service/usage-plans/free' })
    );

    const freePlanId = freePlanIdParam.Parameter?.Value;
    if (!freePlanId) {
      throw new Error('Free Usage Plan ID not found in SSM');
    }

    await apiGatewayClient.send(
        new CreateUsagePlanKeyCommand({
          usagePlanId: freePlanId,
          keyId: apiKeyId,
          keyType: 'API_KEY',
        })
    );
    logger.info('Assigned API Key to Free Usage Plan', { apiKeyId, freePlanId });

    // 4. Cognito カスタム属性へ反映
    await cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: userId,
          UserAttributes: [
            { Name: 'custom:apiKey', Value: apiKeyValue },
            { Name: 'custom:apiKeyId', Value: apiKeyId }, 
          ],
        })
    );
    logger.info('Updated Cognito user with API key', { userId });

    return event;
  } catch (error) {
    logger.error('Unhandled error in post confirmation handler', { error });
    throw error;
  }
};

export const handler = middy(baseHandler)
    .use(injectLambdaContext(logger))
    .use(captureLambdaHandler(tracer));
