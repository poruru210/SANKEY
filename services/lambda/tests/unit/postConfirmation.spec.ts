import { handler } from '../../src/handlers/postConfirmation.handler';
import { PostConfirmationTriggerEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest'; // Enables custom matchers

import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';
import {
  APIGatewayClient,
  CreateApiKeyCommand,
  CreateUsagePlanCommand,
  CreateUsagePlanKeyCommand,
} from '@aws-sdk/client-api-gateway';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const ssmMock = mockClient(SSMClient);
const apiGatewayMock = mockClient(APIGatewayClient);
const cognitoMock = mockClient(CognitoIdentityProviderClient);

describe('Post Confirmation Handler', () => {
  beforeEach(() => {
    ssmMock.reset();
    apiGatewayMock.reset();
  });

  const validEvent: PostConfirmationTriggerEvent = {
    version: '1',
    region: 'us-east-1',
    userPoolId: 'test-pool-id',
    userName: 'test-user',
    callerContext: {
      awsSdkVersion: '3.x',
      clientId: 'test-client',
    },
    triggerSource: 'PostConfirmation_ConfirmSignUp',
    request: {
      userAttributes: {
        sub: 'test-user-id',
        email: 'test@example.com',
        'custom:accountId': 'account-123',
      },
    },
    response: {},
  };

  it('should store master key in SSM and create API Gateway resources successfully', async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    apiGatewayMock.on(CreateApiKeyCommand).resolves({ id: 'api-key-id' });
    apiGatewayMock.on(CreateUsagePlanCommand).resolves({ id: 'usage-plan-id' });
    apiGatewayMock.on(CreateUsagePlanKeyCommand).resolves({});
    cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});

    await handler(validEvent, {} as any, () => {});

    expect(ssmMock).toHaveReceivedCommandWith(
        PutParameterCommand,
        {
          Description: `Master key for user ${validEvent.request.userAttributes.email} (${validEvent.request.userAttributes['custom:accountId']})`,
          Name: `/license-service/users/${validEvent.request.userAttributes.sub}/master-key`,
          Tags: [
            { Key: 'userId', Value: validEvent.request.userAttributes.sub },
            { Key: 'accountId', Value: validEvent.request.userAttributes['custom:accountId'] },
            { Key: 'email', Value: validEvent.request.userAttributes.email },
          ],
          Type: 'SecureString',
          Value: expect.any(String),
        }
    );

    expect(apiGatewayMock).toHaveReceivedCommand(CreateApiKeyCommand);
    expect(apiGatewayMock).toHaveReceivedCommand(CreateUsagePlanCommand);
    expect(apiGatewayMock).toHaveReceivedCommand(CreateUsagePlanKeyCommand);
    expect(cognitoMock).toHaveReceivedCommand(AdminUpdateUserAttributesCommand);

  });

  it('should throw error when SSM PutParameterCommand fails', async () => {
    ssmMock.on(PutParameterCommand).rejects(new Error('SSM error'));
    apiGatewayMock.onAnyCommand().resolves({});

    await expect(handler(validEvent, {} as any, () => {})).rejects.toThrow('SSM error');
  });

  it('should throw error when CreateApiKeyCommand fails', async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    apiGatewayMock.on(CreateApiKeyCommand).rejects(new Error('API Gateway error'));

    await expect(handler(validEvent, {} as any, () => {})).rejects.toThrow('API Gateway error');
  });

  it('should throw error when required user attributes are missing', async () => {
    const invalidEvent = { ...validEvent, request: { userAttributes: {} } };

    await expect(handler(invalidEvent, {} as any, () => {})).rejects.toThrow();
  });
});
