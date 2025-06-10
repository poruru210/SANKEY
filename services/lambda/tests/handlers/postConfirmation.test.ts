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
  const testEnvironment = 'test';
  const originalEnv = process.env;

  beforeEach(() => {
    ssmMock.reset();
    // 環境変数を設定（正しいパス用）
    process.env = {
      ...originalEnv,
      ENVIRONMENT: testEnvironment,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('✅ creates a master key if SSM parameter is not found', async () => {
    const correctPath = `/sankey/${testEnvironment}/users/user-123/master-key`;

    ssmMock.on(GetParameterCommand, {
      Name: correctPath
    }).rejects({ name: 'ParameterNotFound' });

    ssmMock.on(PutParameterCommand, {
      Name: correctPath
    }).resolves({});

    const result = await (handler as unknown as PostConfirmationTriggerHandler)(
        mockEvent as any,
        {} as any,
        vi.fn()
    );

    expect(result).toEqual(mockEvent);

    const getCalls = ssmMock.commandCalls(GetParameterCommand);
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0].args[0].input.Name).toBe(correctPath);

    const putCalls = ssmMock.commandCalls(PutParameterCommand);
    expect(putCalls).toHaveLength(1);

    const putInput = putCalls[0].args[0].input;
    expect(putInput).toMatchObject({
      Name: correctPath,
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
    const correctPath = `/sankey/${testEnvironment}/users/user-123/master-key`;

    ssmMock.on(GetParameterCommand, {
      Name: correctPath
    }).resolves({
      Parameter: {
        Name: correctPath,
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

  it('✅ works with different environments', async () => {
    // 異なる環境での動作確認
    process.env.ENVIRONMENT = 'staging';
    const stagingPath = `/sankey/staging/users/user-123/master-key`;

    ssmMock.on(GetParameterCommand, {
      Name: stagingPath
    }).rejects({ name: 'ParameterNotFound' });

    ssmMock.on(PutParameterCommand, {
      Name: stagingPath
    }).resolves({});

    // モジュールを再インポート
    vi.resetModules();
    const { handler: stagingHandler } = await import('@lambda/handlers/postConfirmation.handler');

    const result = await (stagingHandler as unknown as PostConfirmationTriggerHandler)(
        mockEvent as any,
        {} as any,
        vi.fn()
    );

    expect(result).toEqual(mockEvent);

    const getCalls = ssmMock.commandCalls(GetParameterCommand);
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0].args[0].input.Name).toBe(stagingPath);

    const putCalls = ssmMock.commandCalls(PutParameterCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input.Name).toBe(stagingPath);
  });

  it('✅ works with SSM_USER_PREFIX environment variable', async () => {
    // SSM_USER_PREFIX での動作確認
    process.env = {
      ...originalEnv,
      SSM_USER_PREFIX: '/sankey/custom/users'
    };
    delete process.env.ENVIRONMENT;

    const customPath = `/sankey/custom/users/user-123/master-key`;

    ssmMock.on(GetParameterCommand, {
      Name: customPath
    }).rejects({ name: 'ParameterNotFound' });

    ssmMock.on(PutParameterCommand, {
      Name: customPath
    }).resolves({});

    // モジュールを再インポート
    vi.resetModules();
    const { handler: customHandler } = await import('@lambda/handlers/postConfirmation.handler');

    const result = await (customHandler as unknown as PostConfirmationTriggerHandler)(
        mockEvent as any,
        {} as any,
        vi.fn()
    );

    expect(result).toEqual(mockEvent);

    const getCalls = ssmMock.commandCalls(GetParameterCommand);
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0].args[0].input.Name).toBe(customPath);

    const putCalls = ssmMock.commandCalls(PutParameterCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input.Name).toBe(customPath);
  });

  it('❌ throws error on unexpected SSM error', async () => {
    const correctPath = `/sankey/${testEnvironment}/users/user-123/master-key`;

    ssmMock.on(GetParameterCommand, {
      Name: correctPath
    }).rejects(new Error('SSM failure'));

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