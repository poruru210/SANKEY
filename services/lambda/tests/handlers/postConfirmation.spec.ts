import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { handler } from '@lambda/handlers/postConfirmation.handler';
import type { PostConfirmationTriggerHandler } from 'aws-lambda';

const ssmMock = mockClient(SSMClient);

// 擬似イベント
const mockEvent = {
  userPoolId: 'us-east-1_test',
  region: 'us-east-1',
  userName: 'abc123',
  request: {
    userAttributes: {
      sub: 'user-123',
      email: 'test@example.com',
    },
  },
  response: {},
};

describe('postConfirmation.handler', () => {
  beforeEach(() => {
    ssmMock.reset();
  });

  it('✅ creates a master key if SSM parameter is not found', async () => {
    ssmMock.on(GetParameterCommand).rejects({ name: 'ParameterNotFound' });
    ssmMock.on(PutParameterCommand).resolves({});

    const result = await (handler as unknown as PostConfirmationTriggerHandler)(
        mockEvent as any,
        {} as any,
        vi.fn()
    );

    expect(result).toEqual(mockEvent);

    const getCalls = ssmMock.commandCalls(GetParameterCommand);
    expect(getCalls).toHaveLength(1);

    const putCalls = ssmMock.commandCalls(PutParameterCommand);
    expect(putCalls).toHaveLength(1);

    const putInput = putCalls[0].args[0].input;
    expect(putInput).toMatchObject({
      Name: `/license-service/users/user-123/master-key`,
      Type: 'String',
      Description: `Master key for user test@example.com`,
      Tags: [
        { Key: 'userId', Value: 'user-123' },
        { Key: 'email', Value: 'test@example.com' },
      ],
    });

    // マスターキーのBase64長を確認（32 byte → 44文字になる）
    expect(typeof putInput.Value).toBe('string');
    const decoded = Buffer.from(putInput.Value as string, 'base64');
    expect(decoded).toHaveLength(32);
  });

  it('✅ does not overwrite if parameter already exists', async () => {
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: {
        Name: '/license-service/users/user-123/master-key',
        Value: 'existing-key',
        Type: 'String',
      },
    });

    const result = await (handler as unknown as PostConfirmationTriggerHandler)(
        mockEvent as any,
        {} as any,
        vi.fn()
    );

    expect(result).toEqual(mockEvent);
    expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(1);
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
  });

  it('❌ throws error on unexpected SSM error', async () => {
    ssmMock.on(GetParameterCommand).rejects(new Error('SSM failure'));

    await expect(() =>
        (handler as unknown as PostConfirmationTriggerHandler)(
            mockEvent as any,
            {} as any,
            vi.fn()
        )
    ).rejects.toThrow('SSM failure');

    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
  });
});
