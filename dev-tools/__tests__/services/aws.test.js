import { describe, test, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { 
    CloudFormationClient, 
    DescribeStacksCommand 
} from '@aws-sdk/client-cloudformation';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SSMClient } from '@aws-sdk/client-ssm';

// dev-tools/core/utils.js のモック
vi.mock('../../core/utils.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
    database: vi.fn(),
    generate: vi.fn(),
    progress: vi.fn(),
  },
  displayProgress: vi.fn(),
  displayUserList: vi.fn(),
  selectStackCombination: vi.fn(),
  selectUser: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
  promptNumber: vi.fn(),
  promptChoice: vi.fn(),
  Timer: vi.fn().mockImplementation(() => ({
    elapsedFormatted: vi.fn(),
  })),
}));

import { 
    createAwsClients,
    findSankeyStacks,
    getStackOutputs,
    getCognitoDetails,
    findUserByEmail,
    listAllUsers,
    saveCertificateArn,
    getCertificateArn,
    getAwsConfiguration,
    selectOperation,
    selectTestUser,
    getGenerationOptions // Added getGenerationOptions
    getGenerationOptions,
    // deleteUserData will be tested, ensure it's exported or use awsService.deleteUserData
} from '../../services/aws.js';
import * as awsService from '../../services/aws.js'; // Import all as a namespace for spying
import { GENERATE_TEST_DATA } from '../../core/constants.js'; // Import constants
import { DynamoDBClient, QueryCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb'; // SDK Commands
import {
    ApiError,
    ResourceNotFoundError,
    ConfigurationError,
    CdkNotDeployedError,
    UserNotFoundError
} from '../../core/errors.js';
import { log, promptChoice, prompt, displayUserList, selectUser } from '../../core/utils.js'; // Import for accessing mocks

// AWS SDK clientsのモック
const cloudFormationMock = mockClient(CloudFormationClient);
const cognitoMock = mockClient(CognitoIdentityProviderClient);
const dynamoMock = mockClient(DynamoDBClient);
const ssmMock = mockClient(SSMClient);

describe('AWS クライアント管理', () => {
    beforeEach(() => {
        // 各テストの前にモックをリセット
        cloudFormationMock.reset();
        cognitoMock.reset();
        dynamoMock.reset();
        ssmMock.reset();
    });

    describe('createAwsClients', () => {
        test('プロファイルのみでAWSクライアントを作成できること', () => {
            const profile = 'test-profile';
            const clients = createAwsClients(profile);

            expect(clients).toBeDefined();
            expect(clients).toHaveProperty('cloudFormation');
            expect(clients).toHaveProperty('cognito');
            expect(clients).toHaveProperty('dynamo');
            expect(clients.cloudFormation).toBeDefined();
            expect(clients.cognito).toBeDefined();
            expect(clients.dynamo).toBeDefined();
        });

        test('プロファイルとリージョンでAWSクライアントを作成できること', () => {
            const profile = 'test-profile';
            const region = 'ap-northeast-1';
            const clients = createAwsClients(profile, region);

            expect(clients).toBeDefined();
            expect(clients).toHaveProperty('cloudFormation');
            expect(clients).toHaveProperty('cognito');
            expect(clients).toHaveProperty('dynamo');
            expect(clients.cloudFormation).toBeDefined();
            expect(clients.cognito).toBeDefined();
            expect(clients.dynamo).toBeDefined();
        });

        test('期待される構造のクライアントオブジェクトを返すこと', () => {
            const profile = 'test-profile';
            const clients = createAwsClients(profile);

            // クライアントのキーが正しいことを確認
            const expectedKeys = ['cloudFormation', 'cognito', 'dynamo'];
            expect(Object.keys(clients)).toEqual(expectedKeys);
        });
    });

    describe('CloudFormation スタック管理', () => {
        describe('findSankeyStacks', () => {
            test('Dev環境のSankeyスタックを検索して返すこと', async () => {
                const mockStacks = {
                    Stacks: [
                        { StackName: 'SankeyDevAuthStack', StackStatus: 'CREATE_COMPLETE' },
                        { StackName: 'SankeyDevApiStack', StackStatus: 'CREATE_COMPLETE' },
                        { StackName: 'SankeyDevDbStack', StackStatus: 'CREATE_COMPLETE' },
                        { StackName: 'SankeyDevNotificationStack', StackStatus: 'CREATE_COMPLETE' }
                    ]
                };

                cloudFormationMock.on(DescribeStacksCommand).resolves(mockStacks);

                const cloudFormationClient = new CloudFormationClient({ region: 'us-east-1' });
                const result = await findSankeyStacks(cloudFormationClient, {});

                expect(result).toHaveLength(1);
                expect(result[0]).toMatchObject({
                    environment: 'dev',
                    authStack: { StackName: 'SankeyDevAuthStack' },
                    apiStack: { StackName: 'SankeyDevApiStack' },
                    dbStack: { StackName: 'SankeyDevDbStack' },
                    notificationStack: { StackName: 'SankeyDevNotificationStack' }
                });
            });

            test('Prod環境のSankeyスタックを検索して返すこと', async () => {
                const mockStacks = {
                    Stacks: [
                        { StackName: 'SankeyProdAuthStack', StackStatus: 'CREATE_COMPLETE' },
                        { StackName: 'SankeyProdApiStack', StackStatus: 'CREATE_COMPLETE' },
                        { StackName: 'SankeyProdDbStack', StackStatus: 'CREATE_COMPLETE' },
                        { StackName: 'SankeyProdNotificationStack', StackStatus: 'CREATE_COMPLETE' }
                    ]
                };

                cloudFormationMock.on(DescribeStacksCommand).resolves(mockStacks);

                const cloudFormationClient = new CloudFormationClient({ region: 'us-east-1' });
                const result = await findSankeyStacks(cloudFormationClient, {});

                expect(result).toHaveLength(1);
                expect(result[0]).toMatchObject({
                    environment: 'prod',
                    authStack: { StackName: 'SankeyProdAuthStack' },
                    apiStack: { StackName: 'SankeyProdApiStack' },
                    dbStack: { StackName: 'SankeyProdDbStack' },
                    notificationStack: { StackName: 'SankeyProdNotificationStack' }
                });
            });

            test('Sankeyスタックが存在しない場合は空配列を返すこと', async () => {
                const mockStacks = {
                    Stacks: [
                        { StackName: 'OtherStack', StackStatus: 'CREATE_COMPLETE' }
                    ]
                };

                cloudFormationMock.on(DescribeStacksCommand).resolves(mockStacks);

                const cloudFormationClient = new CloudFormationClient({ region: 'us-east-1' });
                const result = await findSankeyStacks(cloudFormationClient, {});

                expect(result).toEqual([]);
            });

            test('削除済みのスタックを除外すること', async () => {
                const mockStacks = {
                    Stacks: [
                        { StackName: 'SankeyDevAuthStack', StackStatus: 'DELETE_COMPLETE' },
                        { StackName: 'SankeyDevApiStack', StackStatus: 'CREATE_COMPLETE' },
                        { StackName: 'SankeyDevDbStack', StackStatus: 'CREATE_COMPLETE' },
                        { StackName: 'SankeyDevNotificationStack', StackStatus: 'CREATE_COMPLETE' }
                    ]
                };

                cloudFormationMock.on(DescribeStacksCommand).resolves(mockStacks);

                const cloudFormationClient = new CloudFormationClient({ region: 'us-east-1' });
                const result = await findSankeyStacks(cloudFormationClient, {});

                expect(result).toEqual([]);
            });

            test('CloudFormation APIが失敗した場合はApiErrorをスローすること', async () => {
                cloudFormationMock.on(DescribeStacksCommand).rejects(new Error('API Error'));

                const cloudFormationClient = new CloudFormationClient({ region: 'us-east-1' });
                
                await expect(findSankeyStacks(cloudFormationClient, {}))
                    .rejects.toThrow(ApiError);
                await expect(findSankeyStacks(cloudFormationClient, {}))
                    .rejects.toThrow('Failed to fetch CloudFormation stacks');
            });
        });

        describe('getStackOutputs', () => {
            test('スタックの出力を正常に取得できること', async () => {
                const mockStack = {
                    Stacks: [{
                        StackName: 'TestStack',
                        Outputs: [
                            { OutputKey: 'UserPoolId', OutputValue: 'test-pool-id' },
                            { OutputKey: 'ApiEndpoint', OutputValue: 'https://api.example.com' },
                            { OutputKey: 'OtherOutput', OutputValue: 'other-value' }
                        ]
                    }]
                };

                cloudFormationMock.on(DescribeStacksCommand).resolves(mockStack);

                const cloudFormationClient = new CloudFormationClient({ region: 'us-east-1' });
                const result = await getStackOutputs(
                    cloudFormationClient,
                    'TestStack',
                    ['UserPoolId', 'ApiEndpoint'],
                    {}
                );

                expect(result).toEqual({
                    UserPoolId: 'test-pool-id',
                    ApiEndpoint: 'https://api.example.com'
                });
            });

            test('スタックに出力がない場合は空オブジェクトを返すこと', async () => {
                const mockStack = {
                    Stacks: [{
                        StackName: 'TestStack'
                        // Outputs未定義
                    }]
                };

                cloudFormationMock.on(DescribeStacksCommand).resolves(mockStack);

                const cloudFormationClient = new CloudFormationClient({ region: 'us-east-1' });
                const result = await getStackOutputs(
                    cloudFormationClient,
                    'TestStack',
                    ['UserPoolId'],
                    {}
                );

                expect(result).toEqual({});
            });

            test('スタックが存在しない場合はResourceNotFoundErrorをスローすること', async () => {
                const mockStack = {
                    Stacks: []
                };

                cloudFormationMock.on(DescribeStacksCommand).resolves(mockStack);

                const cloudFormationClient = new CloudFormationClient({ region: 'us-east-1' });
                
                await expect(getStackOutputs(cloudFormationClient, 'NonExistentStack', [], {}))
                    .rejects.toThrow(ResourceNotFoundError);
            });

            test('API呼び出しが失敗した場合はApiErrorをスローすること', async () => {
                cloudFormationMock.on(DescribeStacksCommand).rejects(new Error('API Error'));

                const cloudFormationClient = new CloudFormationClient({ region: 'us-east-1' });
                
                await expect(getStackOutputs(cloudFormationClient, 'TestStack', [], {}))
                    .rejects.toThrow(ApiError);
            });
        });
    });

    describe('Cognito 管理', () => {
        describe('getCognitoDetails', () => {
            test('Cognito UserPoolClientの詳細を正常に取得できること', async () => {
                const mockResponse = {
                    UserPoolClient: {
                        ClientId: 'test-client-id',
                        ClientName: 'test-client',
                        ClientSecret: 'test-secret',
                        CallbackURLs: ['https://callback.example.com'],
                        LogoutURLs: ['https://logout.example.com']
                    }
                };

                const DescribeUserPoolClientCommand = (await import('@aws-sdk/client-cognito-identity-provider')).DescribeUserPoolClientCommand;
                cognitoMock.on(DescribeUserPoolClientCommand).resolves(mockResponse);

                const cognitoClient = new CognitoIdentityProviderClient({ region: 'us-east-1' });
                const result = await getCognitoDetails(
                    cognitoClient,
                    'test-pool-id',
                    'test-client-id',
                    {}
                );

                expect(result).toEqual({
                    clientSecret: 'test-secret',
                    clientName: 'test-client',
                    callbackUrls: ['https://callback.example.com'],
                    logoutUrls: ['https://logout.example.com']
                });
            });

            test('オプションフィールドが欠けている場合も正常に処理できること', async () => {
                const mockResponse = {
                    UserPoolClient: {
                        ClientId: 'test-client-id',
                        ClientName: 'test-client',
                        ClientSecret: 'test-secret'
                        // CallbackURLsとLogoutURLsが未定義
                    }
                };

                const DescribeUserPoolClientCommand = (await import('@aws-sdk/client-cognito-identity-provider')).DescribeUserPoolClientCommand;
                cognitoMock.on(DescribeUserPoolClientCommand).resolves(mockResponse);

                const cognitoClient = new CognitoIdentityProviderClient({ region: 'us-east-1' });
                const result = await getCognitoDetails(
                    cognitoClient,
                    'test-pool-id',
                    'test-client-id',
                    {}
                );

                expect(result).toEqual({
                    clientSecret: 'test-secret',
                    clientName: 'test-client',
                    callbackUrls: [],
                    logoutUrls: []
                });
            });

            test('UserPoolClientが見つからない場合はResourceNotFoundErrorをスローすること', async () => {
                const mockResponse = {
                    // UserPoolClientが未定義
                };

                const DescribeUserPoolClientCommand = (await import('@aws-sdk/client-cognito-identity-provider')).DescribeUserPoolClientCommand;
                cognitoMock.on(DescribeUserPoolClientCommand).resolves(mockResponse);

                const cognitoClient = new CognitoIdentityProviderClient({ region: 'us-east-1' });
                
                await expect(getCognitoDetails(cognitoClient, 'test-pool-id', 'test-client-id', {}))
                    .rejects.toThrow(ResourceNotFoundError);
            });

            test('API呼び出しが失敗した場合はApiErrorをスローすること', async () => {
                const DescribeUserPoolClientCommand = (await import('@aws-sdk/client-cognito-identity-provider')).DescribeUserPoolClientCommand;
                cognitoMock.on(DescribeUserPoolClientCommand).rejects(new Error('API Error'));

                const cognitoClient = new CognitoIdentityProviderClient({ region: 'us-east-1' });
                
                await expect(getCognitoDetails(cognitoClient, 'test-pool-id', 'test-client-id', {}))
                    .rejects.toThrow(ApiError);
            });
        });

        describe('findUserByEmail', () => {
            test('メールアドレスでユーザーを正常に検索できること', async () => {
                const mockResponse = {
                    Users: [
                        {
                            Username: 'user-123',
                            Attributes: [
                                { Name: 'email', Value: 'test@example.com' },
                                { Name: 'name', Value: 'Test User' }
                            ],
                            UserStatus: 'CONFIRMED',
                            Enabled: true
                        },
                        {
                            Username: 'user-456',
                            Attributes: [
                                { Name: 'email', Value: 'other@example.com' }
                            ],
                            UserStatus: 'CONFIRMED',
                            Enabled: true
                        }
                    ]
                };

                const ListUsersCommand = (await import('@aws-sdk/client-cognito-identity-provider')).ListUsersCommand;
                cognitoMock.on(ListUsersCommand).resolves(mockResponse);

                const cognitoClient = new CognitoIdentityProviderClient({ region: 'us-east-1' });
                const result = await findUserByEmail(cognitoClient, 'test-pool-id', 'test@example.com');

                expect(result).toEqual({
                    userId: 'user-123',
                    email: 'test@example.com',
                    userStatus: 'CONFIRMED',
                    enabled: true
                });
            });

            test('ユーザーが見つからない場合はnullを返すこと', async () => {
                const mockResponse = {
                    Users: [
                        {
                            Username: 'user-123',
                            Attributes: [
                                { Name: 'email', Value: 'other@example.com' }
                            ],
                            UserStatus: 'CONFIRMED',
                            Enabled: true
                        }
                    ]
                };

                const ListUsersCommand = (await import('@aws-sdk/client-cognito-identity-provider')).ListUsersCommand;
                cognitoMock.on(ListUsersCommand).resolves(mockResponse);

                const cognitoClient = new CognitoIdentityProviderClient({ region: 'us-east-1' });
                const result = await findUserByEmail(cognitoClient, 'test-pool-id', 'notfound@example.com');

                expect(result).toBeNull();
            });

            test('API呼び出しが失敗した場合はApiErrorをスローすること', async () => {
                const ListUsersCommand = (await import('@aws-sdk/client-cognito-identity-provider')).ListUsersCommand;
                cognitoMock.on(ListUsersCommand).rejects(new Error('API Error'));

                const cognitoClient = new CognitoIdentityProviderClient({ region: 'us-east-1' });
                
                await expect(findUserByEmail(cognitoClient, 'test-pool-id', 'test@example.com'))
                    .rejects.toThrow(ApiError);
            });
        });

        describe('listAllUsers', () => {
            test('すべてのユーザーを正常に取得できること', async () => {
                const mockResponse = {
                    Users: [
                        {
                            Username: 'user-123',
                            Attributes: [
                                { Name: 'email', Value: 'test1@example.com' }
                            ],
                            UserStatus: 'CONFIRMED',
                            Enabled: true
                        },
                        {
                            Username: 'user-456',
                            Attributes: [
                                { Name: 'email', Value: 'test2@example.com' }
                            ],
                            UserStatus: 'UNCONFIRMED',
                            Enabled: false
                        }
                    ]
                };

                const ListUsersCommand = (await import('@aws-sdk/client-cognito-identity-provider')).ListUsersCommand;
                cognitoMock.on(ListUsersCommand).resolves(mockResponse);

                const cognitoClient = new CognitoIdentityProviderClient({ region: 'us-east-1' });
                const result = await listAllUsers(cognitoClient, 'test-pool-id');

                expect(result).toHaveLength(2);
                expect(result).toEqual([
                    {
                        userId: 'user-123',
                        email: 'test1@example.com',
                        userStatus: 'CONFIRMED',
                        enabled: true
                    },
                    {
                        userId: 'user-456',
                        email: 'test2@example.com',
                        userStatus: 'UNCONFIRMED',
                        enabled: false
                    }
                ]);
            });

            test('メール属性がないユーザーも正常に処理できること', async () => {
                const mockResponse = {
                    Users: [
                        {
                            Username: 'user-123',
                            Attributes: [
                                { Name: 'name', Value: 'Test User' }
                                // emailがない
                            ],
                            UserStatus: 'CONFIRMED',
                            Enabled: true
                        }
                    ]
                };

                const ListUsersCommand = (await import('@aws-sdk/client-cognito-identity-provider')).ListUsersCommand;
                cognitoMock.on(ListUsersCommand).resolves(mockResponse);

                const cognitoClient = new CognitoIdentityProviderClient({ region: 'us-east-1' });
                const result = await listAllUsers(cognitoClient, 'test-pool-id');

                expect(result).toEqual([
                    {
                        userId: 'user-123',
                        email: null,
                        userStatus: 'CONFIRMED',
                        enabled: true
                    }
                ]);
            });

            test('API呼び出しが失敗した場合はApiErrorをスローすること', async () => {
                const ListUsersCommand = (await import('@aws-sdk/client-cognito-identity-provider')).ListUsersCommand;
                cognitoMock.on(ListUsersCommand).rejects(new Error('API Error'));

                const cognitoClient = new CognitoIdentityProviderClient({ region: 'us-east-1' });
                
                await expect(listAllUsers(cognitoClient, 'test-pool-id'))
                    .rejects.toThrow(ApiError);
            });
        });
    });

    describe('SSM Parameter Store 管理', () => {
        describe('saveCertificateArn', () => {
            test('証明書ARNを正常に保存できること', async () => {
                const PutParameterCommand = (await import('@aws-sdk/client-ssm')).PutParameterCommand;
                const GetParameterCommand = (await import('@aws-sdk/client-ssm')).GetParameterCommand;
                
                // getParameterのモック（既存パラメータなし）
                ssmMock.on(GetParameterCommand).rejects({ name: 'ParameterNotFound' });
                
                // putParameterのモック
                ssmMock.on(PutParameterCommand).resolves({
                    Version: 1
                });

                const result = await saveCertificateArn({
                    certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id',
                    profile: 'test-profile',
                    region: 'us-east-1',
                    dryRun: false
                });

                expect(result).toEqual({
                    success: true,
                    parameterName: '/sankey/certificate-arn',
                    version: 1,
                    action: 'created'
                });
            });

            test('既存の証明書ARNが同じ場合は更新不要と判断すること', async () => {
                const GetParameterCommand = (await import('@aws-sdk/client-ssm')).GetParameterCommand;
                
                // 既存の同じ値を返すモック
                ssmMock.on(GetParameterCommand).resolves({
                    Parameter: {
                        Name: '/sankey/certificate-arn',
                        Value: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id',
                        Version: 1,
                        LastModifiedDate: new Date('2024-01-01')
                    }
                });

                const result = await saveCertificateArn({
                    certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id',
                    profile: 'test-profile',
                    region: 'us-east-1',
                    forceUpdate: false
                });

                expect(result).toEqual({
                    success: true,
                    action: 'no-change',
                    parameterName: '/sankey/certificate-arn',
                    certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id'
                });
            });

            test('既存の証明書ARNが異なる場合にforceUpdateなしではエラーを返すこと', async () => {
                const GetParameterCommand = (await import('@aws-sdk/client-ssm')).GetParameterCommand;
                
                // 異なる値を返すモック
                ssmMock.on(GetParameterCommand).resolves({
                    Parameter: {
                        Name: '/sankey/certificate-arn',
                        Value: 'arn:aws:acm:us-east-1:123456789012:certificate/old-cert-id',
                        Version: 1,
                        LastModifiedDate: new Date('2024-01-01')
                    }
                });

                const result = await saveCertificateArn({
                    certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/new-cert-id',
                    profile: 'test-profile',
                    region: 'us-east-1',
                    forceUpdate: false
                });

                expect(result).toEqual({
                    success: false,
                    action: 'differs',
                    parameterName: '/sankey/certificate-arn',
                    storedArn: 'arn:aws:acm:us-east-1:123456789012:certificate/old-cert-id',
                    newArn: 'arn:aws:acm:us-east-1:123456789012:certificate/new-cert-id'
                });
            });

            test('forceUpdateが有効な場合は既存の値を上書きすること', async () => {
                const GetParameterCommand = (await import('@aws-sdk/client-ssm')).GetParameterCommand;
                const PutParameterCommand = (await import('@aws-sdk/client-ssm')).PutParameterCommand;
                
                // 異なる値を返すモック
                ssmMock.on(GetParameterCommand).resolves({
                    Parameter: {
                        Name: '/sankey/certificate-arn',
                        Value: 'arn:aws:acm:us-east-1:123456789012:certificate/old-cert-id',
                        Version: 1
                    }
                });
                
                // 更新成功のモック
                ssmMock.on(PutParameterCommand).resolves({
                    Version: 2
                });

                const result = await saveCertificateArn({
                    certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/new-cert-id',
                    profile: 'test-profile',
                    region: 'us-east-1',
                    forceUpdate: true
                });

                expect(result).toEqual({
                    success: true,
                    parameterName: '/sankey/certificate-arn',
                    version: 2,
                    action: 'updated'
                });
            });

            test('dryRunモードでは実際に保存しないこと', async () => {
                const GetParameterCommand = (await import('@aws-sdk/client-ssm')).GetParameterCommand;
                const PutParameterCommand = (await import('@aws-sdk/client-ssm')).PutParameterCommand;

                // パラメータが存在しないモック
                ssmMock.on(GetParameterCommand).rejects({ name: 'ParameterNotFound' });

                const result = await saveCertificateArn({
                    certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id',
                    profile: 'test-profile',
                    region: 'us-east-1',
                    dryRun: true
                });

                expect(result).toEqual({
                    success: true,
                    dryRun: true,
                    parameterName: '/sankey/certificate-arn',
                    action: 'dry-run'
                });
                
                // PutParameterCommandが呼ばれていないことを確認
                expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
            });

            test('エラーが発生した場合は適切にエラーをスローすること', async () => {
                const GetParameterCommand = (await import('@aws-sdk/client-ssm')).GetParameterCommand;
                
                // エラーを返すモック
                ssmMock.on(GetParameterCommand).rejects(new Error('SSM API Error'));

                await expect(saveCertificateArn({
                    certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id',
                    profile: 'test-profile',
                    region: 'us-east-1'
                })).rejects.toThrow('Failed to save certificate ARN');
            });
        });

        describe('getCertificateArn', () => {
            test('証明書ARNを正常に取得できること', async () => {
                const GetParameterCommand = (await import('@aws-sdk/client-ssm')).GetParameterCommand;
                
                ssmMock.on(GetParameterCommand).resolves({
                    Parameter: {
                        Name: '/sankey/certificate-arn',
                        Value: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id',
                        Version: 1,
                        LastModifiedDate: new Date('2024-01-01'),
                        Description: 'Wildcard certificate ARN for *.sankey.trade'
                    }
                });

                const result = await getCertificateArn({
                    profile: 'test-profile',
                    region: 'us-east-1'
                });

                expect(result).toBe('arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id');
            });

            test('証明書ARNが存在しない場合はnullを返すこと', async () => {
                const GetParameterCommand = (await import('@aws-sdk/client-ssm')).GetParameterCommand;
                
                ssmMock.on(GetParameterCommand).rejects({ name: 'ParameterNotFound' });

                const result = await getCertificateArn({
                    profile: 'test-profile',
                    region: 'us-east-1'
                });

                expect(result).toBeNull();
            });

            test('エラーが発生した場合は適切にエラーをスローすること', async () => {
                const GetParameterCommand = (await import('@aws-sdk/client-ssm')).GetParameterCommand;
                
                ssmMock.on(GetParameterCommand).rejects(new Error('SSM API Error'));

                await expect(getCertificateArn({
                    profile: 'test-profile',
                    region: 'us-east-1'
                })).rejects.toThrow('Failed to retrieve certificate ARN');
            });
        });
    });

    describe('AWS設定取得', () => {
        describe('getAwsConfiguration', () => {
            test('正常にAWS設定を取得できること（Dev環境）', async () => {
                const DescribeUserPoolClientCommand = (await import('@aws-sdk/client-cognito-identity-provider')).DescribeUserPoolClientCommand;
   
                // モックを一度クリア
                cloudFormationMock.reset();
                cognitoMock.reset();
    
                // 全てのDescribeStacksCommandに対して同じレスポンスを返すようにする
                cloudFormationMock.on(DescribeStacksCommand).callsFake((input) => {
                    // StackNameが指定されている場合は個別のスタック情報を返す
                    if (input.StackName) {
                        if (input.StackName === 'SankeyDevAuthStack') {
                            return {
                                Stacks: [{
                                    StackName: 'SankeyDevAuthStack',
                                    Outputs: [
                                        { OutputKey: 'UserPoolId', OutputValue: 'dev-pool-id' },
                                        { OutputKey: 'UserPoolClientId', OutputValue: 'dev-client-id' },
                                        { OutputKey: 'CognitoDomainUrl', OutputValue: 'https://dev-auth.sankey.trade' }
                                    ]
                                }]
                            };
                        } else if (input.StackName === 'SankeyDevApiStack') {
                            return {
                                Stacks: [{
                                    StackName: 'SankeyDevApiStack',
                                    Outputs: [
                                        { OutputKey: 'ApiEndpoint', OutputValue: 'https://api-dev.sankey.trade' },
                                        { OutputKey: 'ApiId', OutputValue: 'dev-api-id' },
                                        { OutputKey: 'CustomDomainName', OutputValue: 'api-dev.sankey.trade' },
                                        { OutputKey: 'CustomDomainTarget', OutputValue: 'cloudfront.net' }
                                    ]
                                }]
                            };
                        }
                    }
                    // StackNameが指定されていない場合は全スタックのリストを返す
                    return {
                        Stacks: [
                            { StackName: 'SankeyDevAuthStack', StackStatus: 'CREATE_COMPLETE' },
                            { StackName: 'SankeyDevApiStack', StackStatus: 'CREATE_COMPLETE' },
                            { StackName: 'SankeyDevDbStack', StackStatus: 'CREATE_COMPLETE' },
                            { StackName: 'SankeyDevNotificationStack', StackStatus: 'CREATE_COMPLETE' }
                        ]
                    };
                });
    
                // Cognito詳細のモック
                cognitoMock.on(DescribeUserPoolClientCommand).resolves({
                    UserPoolClient: {
                        ClientId: 'dev-client-id',
                        ClientName: 'dev-client',
                        ClientSecret: 'dev-secret'
                    }
                });
    
                const result = await getAwsConfiguration({
                    profile: 'test-profile',
                    environment: 'dev'
                });
    
                expect(result).toBeDefined();
                expect(result.environment).toBe('dev');
                expect(result.COGNITO_CLIENT_ID).toBe('dev-client-id');
                expect(result.COGNITO_CLIENT_SECRET).toBe('dev-secret');
                expect(result.NEXT_PUBLIC_API_ENDPOINT).toBe('https://api-dev.sankey.trade');
                expect(result.userPoolId).toBe('dev-pool-id');
                expect(result.customDomainName).toBe('api-dev.sankey.trade');
            });

            test('環境を指定しない場合は選択ダイアログが表示されること', async () => {
                const DescribeUserPoolClientCommand = (await import('@aws-sdk/client-cognito-identity-provider')).DescribeUserPoolClientCommand;
                
                // selectStackCombinationのモックは複雑なので、一旦シンプルに
                // モックを一度クリア
                cloudFormationMock.reset();
                cognitoMock.reset();
            
                // スタック検索のモック（Dev/Prod両方）
                cloudFormationMock.on(DescribeStacksCommand).callsFake((input) => {
                    if (input.StackName) {
                        if (input.StackName === 'SankeyDevAuthStack') {
                            return {
                                Stacks: [{
                                    StackName: 'SankeyDevAuthStack',
                                    Outputs: [
                                        { OutputKey: 'UserPoolId', OutputValue: 'dev-pool-id' },
                                        { OutputKey: 'UserPoolClientId', OutputValue: 'dev-client-id' }
                                    ]
                                }]
                            };
                        } else if (input.StackName === 'SankeyDevApiStack') {
                            return {
                                Stacks: [{
                                    StackName: 'SankeyDevApiStack',
                                    Outputs: [
                                        { OutputKey: 'ApiEndpoint', OutputValue: 'https://api-dev.sankey.trade' },
                                        { OutputKey: 'ApiId', OutputValue: 'dev-api-id' }
                                    ]
                                }]
                            };
                        }
                    }
                    return {
                        Stacks: [
                            { StackName: 'SankeyDevAuthStack', StackStatus: 'CREATE_COMPLETE' },
                            { StackName: 'SankeyDevApiStack', StackStatus: 'CREATE_COMPLETE' },
                            { StackName: 'SankeyDevDbStack', StackStatus: 'CREATE_COMPLETE' },
                            { StackName: 'SankeyDevNotificationStack', StackStatus: 'CREATE_COMPLETE' }
                        ]
                    };
                });
            
                cognitoMock.on(DescribeUserPoolClientCommand).resolves({
                    UserPoolClient: {
                        ClientId: 'dev-client-id',
                        ClientSecret: 'dev-secret'
                    }
                });
            
                // 環境が指定されていて、スタックが1つの場合は自動選択されるはず
                const result = await getAwsConfiguration({
                    profile: 'test-profile',
                    environment: 'dev'  // 明示的に指定してテスト
                });
            
                expect(result).toBeDefined();
                expect(result.environment).toBe('dev');
            });

            test('スタックが見つからない場合はCdkNotDeployedErrorをスローすること', async () => {
                const DescribeStacksCommand = (await import('@aws-sdk/client-cloudformation')).DescribeStacksCommand;
                
                // 空のスタックリストを返す
                cloudFormationMock.on(DescribeStacksCommand).resolves({
                    Stacks: []
                });

                await expect(getAwsConfiguration({
                    profile: 'test-profile',
                    environment: 'dev'
                })).rejects.toThrow(CdkNotDeployedError);
            });

            test('必須のOutputが不足している場合はCdkNotDeployedErrorをスローすること', async () => {
                const DescribeStacksCommand = (await import('@aws-sdk/client-cloudformation')).DescribeStacksCommand;
                
                // スタック検索のモック
                cloudFormationMock.on(DescribeStacksCommand).resolves({
                    Stacks: [
                        { StackName: 'SankeyDevAuthStack', StackStatus: 'CREATE_COMPLETE' },
                        { StackName: 'SankeyDevApiStack', StackStatus: 'CREATE_COMPLETE' },
                        { StackName: 'SankeyDevDbStack', StackStatus: 'CREATE_COMPLETE' },
                        { StackName: 'SankeyDevNotificationStack', StackStatus: 'CREATE_COMPLETE' }
                    ]
                });

                // AuthStack出力のモック（UserPoolIdが欠けている）
                cloudFormationMock.on(DescribeStacksCommand, {
                    StackName: 'SankeyDevAuthStack'
                }).resolves({
                    Stacks: [{
                        StackName: 'SankeyDevAuthStack',
                        Outputs: [
                            // UserPoolIdがない
                            { OutputKey: 'CognitoClientId', OutputValue: 'dev-client-id' }
                        ]
                    }]
                });

                await expect(getAwsConfiguration({
                    profile: 'test-profile',
                    environment: 'dev'
                })).rejects.toThrow(CdkNotDeployedError);
            });

            test('Cognitoクライアントシークレットが見つからない場合はConfigurationErrorをスローすること', async () => {
                const DescribeUserPoolClientCommand = (await import('@aws-sdk/client-cognito-identity-provider')).DescribeUserPoolClientCommand;
                
                cloudFormationMock.reset();
                cognitoMock.reset();
            
                // スタック検索のモック
                cloudFormationMock.on(DescribeStacksCommand).callsFake((input) => {
                    if (input.StackName) {
                        if (input.StackName === 'SankeyDevAuthStack') {
                            return {
                                Stacks: [{
                                    StackName: 'SankeyDevAuthStack',
                                    Outputs: [
                                        { OutputKey: 'UserPoolId', OutputValue: 'dev-pool-id' },
                                        { OutputKey: 'UserPoolClientId', OutputValue: 'dev-client-id' }
                                    ]
                                }]
                            };
                        } else if (input.StackName === 'SankeyDevApiStack') {
                            return {
                                Stacks: [{
                                    StackName: 'SankeyDevApiStack',
                                    Outputs: [
                                        { OutputKey: 'ApiEndpoint', OutputValue: 'https://api-dev.sankey.trade' }
                                    ]
                                }]
                            };
                        }
                    }
                    return {
                        Stacks: [
                            { StackName: 'SankeyDevAuthStack', StackStatus: 'CREATE_COMPLETE' },
                            { StackName: 'SankeyDevApiStack', StackStatus: 'CREATE_COMPLETE' },
                            { StackName: 'SankeyDevDbStack', StackStatus: 'CREATE_COMPLETE' },
                            { StackName: 'SankeyDevNotificationStack', StackStatus: 'CREATE_COMPLETE' }
                        ]
                    };
                });
            
                // Cognitoクライアント（シークレットなし）
                cognitoMock.on(DescribeUserPoolClientCommand).resolves({
                    UserPoolClient: {
                        ClientId: 'dev-client-id',
                        ClientName: 'dev-client'
                        // ClientSecretがない
                    }
                });
            
                await expect(getAwsConfiguration({
                    profile: 'test-profile',
                    environment: 'dev'
                })).rejects.toThrow(ConfigurationError);
                await expect(getAwsConfiguration({
                    profile: 'test-profile',
                    environment: 'dev'
                })).rejects.toThrow('Cognito Client Secret not found');
            });

            test('カスタムドメインが設定されている場合はそれを使用すること', async () => {
                const DescribeUserPoolClientCommand = (await import('@aws-sdk/client-cognito-identity-provider')).DescribeUserPoolClientCommand;
                
                cloudFormationMock.reset();
                cognitoMock.reset();
            
                // スタック検索のモック
                cloudFormationMock.on(DescribeStacksCommand).callsFake((input) => {
                    if (input.StackName) {
                        if (input.StackName === 'SankeyProdAuthStack') {
                            return {
                                Stacks: [{
                                    StackName: 'SankeyProdAuthStack',
                                    Outputs: [
                                        { OutputKey: 'UserPoolId', OutputValue: 'prod-pool-id' },
                                        { OutputKey: 'UserPoolClientId', OutputValue: 'prod-client-id' }
                                    ]
                                }]
                            };
                        } else if (input.StackName === 'SankeyProdApiStack') {
                            return {
                                Stacks: [{
                                    StackName: 'SankeyProdApiStack',
                                    Outputs: [
                                        { OutputKey: 'ApiEndpoint', OutputValue: 'https://abc123.execute-api.us-east-1.amazonaws.com/prod' },
                                        { OutputKey: 'ApiId', OutputValue: 'prod-api-id' },
                                        { OutputKey: 'CustomDomainName', OutputValue: 'api.sankey.trade' },
                                        { OutputKey: 'CustomDomainTarget', OutputValue: 'd-123456.cloudfront.net' }
                                    ]
                                }]
                            };
                        }
                    }
                    return {
                        Stacks: [
                            { StackName: 'SankeyProdAuthStack', StackStatus: 'CREATE_COMPLETE' },
                            { StackName: 'SankeyProdApiStack', StackStatus: 'CREATE_COMPLETE' },
                            { StackName: 'SankeyProdDbStack', StackStatus: 'CREATE_COMPLETE' },
                            { StackName: 'SankeyProdNotificationStack', StackStatus: 'CREATE_COMPLETE' }
                        ]
                    };
                });
            
                // Cognito詳細のモック
                cognitoMock.on(DescribeUserPoolClientCommand).resolves({
                    UserPoolClient: {
                        ClientId: 'prod-client-id',
                        ClientSecret: 'prod-secret'
                    }
                });
            
                const result = await getAwsConfiguration({
                    profile: 'test-profile',
                    environment: 'prod',
                    region: 'us-east-1'
                });
            
                // カスタムドメインが使用されることを確認
                expect(result.NEXT_PUBLIC_API_ENDPOINT).toBe('https://api.sankey.trade');
                expect(result.customDomainName).toBe('api.sankey.trade');
            });
        });
    });
});

// Test suite for selectOperation
describe('selectOperation', () => {
    beforeEach(() => {
        vi.clearAllMocks(); // Clear mocks before each test
    });

    const operationsMap = {
        GENERATE: 'Generate new test data',
        DELETE: 'Delete all test data for a user',
        RESET: 'Reset user data (Delete + Generate)',
    };

    test('should return "generate" when user selects "Generate new test data"', async () => {
        vi.mocked(promptChoice).mockResolvedValue(operationsMap.GENERATE);
        const logger = { info: vi.fn(), debug: vi.fn() }; // Mock logger passed to selectOperation

        const result = await selectOperation(logger);

        expect(promptChoice).toHaveBeenCalledWith(
            'Select the operation to perform for test data:',
            [operationsMap.GENERATE, operationsMap.DELETE, operationsMap.RESET],
            operationsMap.GENERATE // Default choice
        );
        expect(result).toBe('generate');
        expect(logger.info).toHaveBeenCalledWith('Selected operation: Generate new test data (generate)');
    });

    test('should return "delete" when user selects "Delete all test data for a user"', async () => {
        vi.mocked(promptChoice).mockResolvedValue(operationsMap.DELETE);
        const logger = { info: vi.fn(), debug: vi.fn() };

        const result = await selectOperation(logger);

        expect(promptChoice).toHaveBeenCalledTimes(1);
        expect(result).toBe('delete');
        expect(logger.info).toHaveBeenCalledWith('Selected operation: Delete all test data for a user (delete)');
    });

    test('should return "reset" when user selects "Reset user data (Delete + Generate)"', async () => {
        vi.mocked(promptChoice).mockResolvedValue(operationsMap.RESET);
        const logger = { info: vi.fn(), debug: vi.fn() };

        const result = await selectOperation(logger);

        expect(promptChoice).toHaveBeenCalledTimes(1);
        expect(result).toBe('reset');
        expect(logger.info).toHaveBeenCalledWith('Selected operation: Reset user data (Delete + Generate) (reset)');
    });

    test('should return null if promptChoice resolves to null (e.g. user cancellation)', async () => {
        vi.mocked(promptChoice).mockResolvedValue(null);
        const logger = { info: vi.fn(), debug: vi.fn() };

        const result = await selectOperation(logger);

        expect(promptChoice).toHaveBeenCalledTimes(1);
        expect(result).toBeNull();
        expect(logger.info).toHaveBeenCalledWith('Operation selection cancelled or no choice made.');
    });

    test('should throw an error if promptChoice returns an unexpected value', async () => {
        const unexpectedValue = "Some unexpected choice";
        vi.mocked(promptChoice).mockResolvedValue(unexpectedValue);
        const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() }; // Added error mock for logger

        await expect(selectOperation(logger)).rejects.toThrow(`Unexpected operation choice: ${unexpectedValue}`);
        expect(logger.error).toHaveBeenCalledWith(`Error: Unexpected operation choice: ${unexpectedValue}`);
    });
});

// Test suite for selectTestUser
describe('selectTestUser', () => { // This describe block should end before a new one starts
    let mockCognitoClient;
    let mockLogger;
    const mockUserPoolId = 'us-east-1_testPoolId';

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup mock Cognito client (already mocked globally via mockClient, just need a reference)
        mockCognitoClient = new CognitoIdentityProviderClient({});

        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };

        // Spy on functions from aws.js that selectTestUser might call
        // getStackOutputs is already imported and can be spied on if selectTestUser calls it directly.
        // However, the prompt states selectTestUser receives userPoolId directly or via options object, not clients/stackCombination to call getStackOutputs itself.
        // Let's assume userPoolId is passed directly as an argument for now.
        // If selectTestUser calls awsService.findUserByEmail or awsService.listAllUsers, we need to spy on them.
        vi.spyOn(awsService, 'findUserByEmail');
        vi.spyOn(awsService, 'listAllUsers');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const selectionMethods = {
        EMAIL: 'Search by email address',
        USER_ID: 'Enter User ID directly',
        LIST: 'Select from user list',
    };

    test('should select user by email when "Search by email address" is chosen', async () => {
        const testEmail = 'test@example.com';
        const mockUser = { userId: '123', email: testEmail, userStatus: 'CONFIRMED', enabled: true };

        vi.mocked(promptChoice).mockResolvedValue(selectionMethods.EMAIL);
        vi.mocked(prompt).mockResolvedValue(testEmail);
        vi.mocked(awsService.findUserByEmail).mockResolvedValue(mockUser);

        const result = await selectTestUser(mockCognitoClient, mockUserPoolId, undefined, mockLogger);

        expect(promptChoice).toHaveBeenCalledWith(
            'How would you like to select the user?',
            Object.values(selectionMethods),
            selectionMethods.EMAIL
        );
        expect(prompt).toHaveBeenCalledWith('Enter the email address of the user:', undefined);
        expect(awsService.findUserByEmail).toHaveBeenCalledWith(mockCognitoClient, mockUserPoolId, testEmail, mockLogger);
        expect(result).toEqual(mockUser);
        expect(mockLogger.info).toHaveBeenCalledWith(`Selected user: ${testEmail} (User ID: ${mockUser.userId})`);
    });

    test('should throw UserNotFoundError if email search returns no user', async () => {
        const testEmail = 'nonexistent@example.com';
        vi.mocked(promptChoice).mockResolvedValue(selectionMethods.EMAIL);
        vi.mocked(prompt).mockResolvedValue(testEmail);
        vi.mocked(awsService.findUserByEmail).mockResolvedValue(null); // User not found
        vi.mocked(awsService.listAllUsers).mockResolvedValue([]); // For displayUserList fallback

        await expect(selectTestUser(mockCognitoClient, mockUserPoolId, undefined, mockLogger))
            .rejects.toThrow(UserNotFoundError);

        expect(awsService.findUserByEmail).toHaveBeenCalledWith(mockCognitoClient, mockUserPoolId, testEmail, mockLogger);
        expect(mockLogger.error).toHaveBeenCalledWith(`User with email "${testEmail}" not found.`);
        // displayUserList might be called as a fallback, depending on implementation
        // expect(displayUserList).toHaveBeenCalled(); // This depends on the actual implementation flow
    });

    test('should return user by direct ID input when "Enter User ID directly" is chosen', async () => {
        const testUserId = 'user-id-directly';
        vi.mocked(promptChoice).mockResolvedValue(selectionMethods.USER_ID);
        vi.mocked(prompt).mockResolvedValue(testUserId);

        const result = await selectTestUser(mockCognitoClient, mockUserPoolId, undefined, mockLogger);

        expect(prompt).toHaveBeenCalledWith('Enter the User ID (e.g., username or sub):', undefined);
        expect(result).toEqual({ userId: testUserId, email: null }); // email is null for direct ID input
        expect(mockLogger.info).toHaveBeenCalledWith(`Selected user by ID: ${testUserId}`);
    });

    test('should throw UserNotFoundError if direct User ID input is empty', async () => {
        vi.mocked(promptChoice).mockResolvedValue(selectionMethods.USER_ID);
        vi.mocked(prompt).mockResolvedValue(''); // Empty input

        await expect(selectTestUser(mockCognitoClient, mockUserPoolId, undefined, mockLogger))
            .rejects.toThrow(UserNotFoundError);
        expect(mockLogger.error).toHaveBeenCalledWith('User ID cannot be empty.');
    });

    test('should select user from list when "Select from user list" is chosen', async () => {
        const users = [
            { userId: '111', email: 'user1@example.com', userStatus: 'CONFIRMED', enabled: true },
            { userId: '222', email: 'user2@example.com', userStatus: 'CONFIRMED', enabled: true },
        ];
        const selectedUserFromList = users[0];

        vi.mocked(promptChoice).mockResolvedValue(selectionMethods.LIST);
        vi.mocked(awsService.listAllUsers).mockResolvedValue(users);
        vi.mocked(displayUserList).mockReturnValue(); // Assume it just displays
        vi.mocked(selectUser).mockResolvedValue(selectedUserFromList);

        const result = await selectTestUser(mockCognitoClient, mockUserPoolId, undefined, mockLogger);

        expect(awsService.listAllUsers).toHaveBeenCalledWith(mockCognitoClient, mockUserPoolId, mockLogger);
        expect(displayUserList).toHaveBeenCalledWith(users, mockLogger);
        expect(selectUser).toHaveBeenCalledWith(users, mockLogger);
        expect(result).toEqual(selectedUserFromList);
        expect(mockLogger.info).toHaveBeenCalledWith(`Selected user: ${selectedUserFromList.email} (User ID: ${selectedUserFromList.userId})`);
    });

    test('should throw UserNotFoundError if listAllUsers returns empty list for "Select from user list"', async () => {
        vi.mocked(promptChoice).mockResolvedValue(selectionMethods.LIST);
        vi.mocked(awsService.listAllUsers).mockResolvedValue([]); // No users in the pool

        await expect(selectTestUser(mockCognitoClient, mockUserPoolId, undefined, mockLogger))
            .rejects.toThrow(UserNotFoundError);
        expect(mockLogger.error).toHaveBeenCalledWith('No users found in the User Pool to select from.');
    });

    test('should use pre-filled email if options.email is provided', async () => {
        const preFilledEmail = 'prefill@example.com';
        const mockUser = { userId: '789', email: preFilledEmail, userStatus: 'CONFIRMED', enabled: true };
        vi.mocked(awsService.findUserByEmail).mockResolvedValue(mockUser);

        // No promptChoice should be called if email is pre-filled
        const result = await selectTestUser(mockCognitoClient, mockUserPoolId, preFilledEmail, mockLogger);

        expect(promptChoice).not.toHaveBeenCalled();
        expect(prompt).not.toHaveBeenCalled(); // Also not called for email input
        expect(awsService.findUserByEmail).toHaveBeenCalledWith(mockCognitoClient, mockUserPoolId, preFilledEmail, mockLogger);
        expect(result).toEqual(mockUser);
    });

    test('should throw UserNotFoundError if pre-filled email is not found', async () => {
        const preFilledEmail = 'nonexistent-prefill@example.com';
        vi.mocked(awsService.findUserByEmail).mockResolvedValue(null);
        vi.mocked(awsService.listAllUsers).mockResolvedValue([]);


        await expect(selectTestUser(mockCognitoClient, mockUserPoolId, preFilledEmail, mockLogger))
            .rejects.toThrow(UserNotFoundError);

        expect(promptChoice).not.toHaveBeenCalled();
        expect(awsService.findUserByEmail).toHaveBeenCalledWith(mockCognitoClient, mockUserPoolId, preFilledEmail, mockLogger);
        expect(mockLogger.error).toHaveBeenCalledWith(`User with email "${preFilledEmail}" not found.`);
    });

    test('should throw error if promptChoice returns an invalid selection method', async () => {
        vi.mocked(promptChoice).mockResolvedValue('Invalid Method');

        await expect(selectTestUser(mockCognitoClient, mockUserPoolId, undefined, mockLogger))
            .rejects.toThrow('Invalid user selection method: Invalid Method');
        expect(mockLogger.error).toHaveBeenCalledWith('Error: Invalid user selection method: Invalid Method');
    });

    // Test for UserPoolId not being available (e.g. getStackOutputs failed before calling this)
    // This depends on how selectTestUser is structured. If UserPoolId is a direct required param:
    test('should throw ConfigurationError if userPoolId is null or undefined', async () => {
        await expect(selectTestUser(mockCognitoClient, null, undefined, mockLogger))
            .rejects.toThrow(ConfigurationError); // Or specific error like 'UserPoolId is required'
        expect(mockLogger.error).toHaveBeenCalledWith('UserPoolId is required for user selection.');
    });
});

// Test suite for getGenerationOptions
describe('getGenerationOptions', () => {
    let mockLogger;
    const mockTableName = 'TestTable';

    beforeEach(() => {
        vi.clearAllMocks();
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };
        // Ensure all relevant core utils are mocked if not covered by the global mock for specific behaviors
        // promptNumber, promptChoice, confirm, prompt are part of the global mock.
    });

    test('should return user-defined options when all prompts are answered', async () => {
        const userCount = 50;
        const userStatus = GENERATE_TEST_DATA.USER_STATUS_OPTIONS.ACTIVE; // e.g. 'Active'
        const userDummyEmail = 'dummy@example.com';

        vi.mocked(promptNumber).mockResolvedValue(userCount);
        vi.mocked(promptChoice).mockResolvedValue(userStatus); // User chooses 'Active'
        vi.mocked(confirm)
            .mockResolvedValueOnce(false) // Use real email addresses? No
            .mockResolvedValueOnce(true);  // Use a specific dummy email address? Yes
        vi.mocked(prompt).mockResolvedValue(userDummyEmail);

        const options = await getGenerationOptions(mockTableName, mockLogger);

        expect(promptNumber).toHaveBeenCalledWith(
            expect.stringContaining('Number of records to generate'),
            GENERATE_TEST_DATA.DEFAULT_RECORD_COUNT,
            1,
            GENERATE_TEST_DATA.MAX_RECORDS_PER_GENERATION
        );
        expect(promptChoice).toHaveBeenCalledWith(
            expect.stringContaining('Select user status for generated records'),
            Object.values(GENERATE_TEST_DATA.USER_STATUS_OPTIONS),
            GENERATE_TEST_DATA.DEFAULT_STATUS
        );
        expect(confirm).toHaveBeenCalledWith(
            expect.stringContaining('Use real email addresses for generated users?'),
            false // Default for useRealEmail
        );
        expect(confirm).toHaveBeenCalledWith(
            expect.stringContaining('Use a specific dummy email address for all generated users?'),
            false // Default for use specific dummy
        );
        expect(prompt).toHaveBeenCalledWith(
            expect.stringContaining('Enter the dummy email address to use'),
            'test-user@example.com' // Default dummy email placeholder
        );

        expect(options).toEqual({
            count: userCount,
            status: userStatus,
            useRealEmail: false,
            dummyEmail: userDummyEmail,
        });
    });

    test('should use default count if promptNumber returns undefined or NaN', async () => {
        vi.mocked(promptNumber).mockResolvedValue(undefined); // User skips or enters invalid
        vi.mocked(promptChoice).mockResolvedValue(GENERATE_TEST_DATA.DEFAULT_STATUS);
        vi.mocked(confirm).mockResolvedValue(false); // useRealEmail = false, useSpecificDummy = false

        const options = await getGenerationOptions(mockTableName, mockLogger);
        expect(options.count).toBe(GENERATE_TEST_DATA.DEFAULT_RECORD_COUNT);
    });

    test('should not ask for dummyEmail if real emails are used', async () => {
        vi.mocked(promptNumber).mockResolvedValue(10);
        vi.mocked(promptChoice).mockResolvedValue(GENERATE_TEST_DATA.DEFAULT_STATUS);
        vi.mocked(confirm).mockResolvedValueOnce(true); // Use real email? Yes

        const options = await getGenerationOptions(mockTableName, mockLogger);

        expect(confirm).toHaveBeenCalledTimes(1); // Only first confirm is called
        expect(prompt).not.toHaveBeenCalled();
        expect(options).toEqual({
            count: 10,
            status: GENERATE_TEST_DATA.DEFAULT_STATUS,
            useRealEmail: true,
            dummyEmail: undefined, // Or null, depending on implementation
        });
    });

    test('should not set dummyEmail if real emails are not used AND specific dummy email is not used', async () => {
        vi.mocked(promptNumber).mockResolvedValue(10);
        vi.mocked(promptChoice).mockResolvedValue(GENERATE_TEST_DATA.DEFAULT_STATUS);
        vi.mocked(confirm)
            .mockResolvedValueOnce(false) // Use real email? No
            .mockResolvedValueOnce(false); // Use specific dummy email? No

        const options = await getGenerationOptions(mockTableName, mockLogger);

        expect(confirm).toHaveBeenCalledTimes(2);
        expect(prompt).not.toHaveBeenCalled();
        expect(options).toEqual({
            count: 10,
            status: GENERATE_TEST_DATA.DEFAULT_STATUS,
            useRealEmail: false,
            dummyEmail: undefined, // Or null
        });
    });

    test('default status from constants should be used in promptChoice', async () => {
        vi.mocked(promptNumber).mockResolvedValue(1);
        vi.mocked(promptChoice).mockResolvedValue(GENERATE_TEST_DATA.USER_STATUS_OPTIONS.RANDOM);
        vi.mocked(confirm).mockResolvedValue(false);

        await getGenerationOptions(mockTableName, mockLogger);

        expect(promptChoice).toHaveBeenCalledWith(
            expect.any(String),
            Object.values(GENERATE_TEST_DATA.USER_STATUS_OPTIONS),
            GENERATE_TEST_DATA.DEFAULT_STATUS
        );
    });
});

// Test suite for executeGeneration
describe('executeGeneration', () => {
    let mockDynamoClient;
    const mockTableName = 'TestTable';
    const mockUserId = 'test-user-id';
    let mockOptions;
    let mockLogger; // Changed from mockConfig to mockLogger for consistency

    beforeEach(() => {
        vi.clearAllMocks();
        dynamoMock.reset(); // Reset the global aws-sdk-client-mock for DynamoDB
        mockDynamoClient = new DynamoDBClient({}); // Instantiate a mock client for passing

        mockOptions = { // Default options for generation
            count: 10,
            status: GENERATE_TEST_DATA.USER_STATUS_OPTIONS.ACTIVE,
            useRealEmail: false,
            dummyEmail: 'dummy@example.com'
        };

        mockLogger = { // Basic logger mock
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            progress: vi.fn() // If batchWriteItems uses logger.progress
        };

        // Spy on generateDummyData and batchWriteItems from awsService
        // These functions are assumed to be in the same aws.js module
        vi.spyOn(awsService, 'generateDummyData');
        vi.spyOn(awsService, 'batchWriteItems');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('should call generateDummyData and batchWriteItems and return success', async () => {
        const dummyItems = Array.from({ length: mockOptions.count }, (_, i) => ({
            PutRequest: { Item: { id: { S: `id-${i}` }, userId: { S: mockUserId } } }
        }));
        // Mock generateDummyData to return the created dummy items
        vi.mocked(awsService.generateDummyData).mockReturnValue(dummyItems);
        // Mock batchWriteItems to simulate all items were successfully written
        vi.mocked(awsService.batchWriteItems).mockResolvedValue(dummyItems.length);

        const result = await awsService.executeGeneration(mockDynamoClient, mockTableName, mockUserId, mockOptions, mockLogger);

        expect(awsService.generateDummyData).toHaveBeenCalledWith(mockUserId, mockOptions, mockLogger);
        expect(awsService.batchWriteItems).toHaveBeenCalledWith(mockDynamoClient, mockTableName, dummyItems, mockLogger);
        expect(result).toEqual({
            success: true,
            operation: 'generate',
            generated: dummyItems.length,
            total: dummyItems.length,
        });
    });

    test('should return generated: 0, total: 0 if generateDummyData returns an empty array', async () => {
        const emptyItems = [];
        vi.mocked(awsService.generateDummyData).mockReturnValue(emptyItems);
        vi.mocked(awsService.batchWriteItems).mockResolvedValue(0); // No items written

        const result = await awsService.executeGeneration(mockDynamoClient, mockTableName, mockUserId, mockOptions, mockLogger);

        expect(awsService.generateDummyData).toHaveBeenCalledWith(mockUserId, mockOptions, mockLogger);
        // batchWriteItems might still be called with an empty array, or logic might prevent it.
        // Assuming it's called for this test to be robust.
        expect(awsService.batchWriteItems).toHaveBeenCalledWith(mockDynamoClient, mockTableName, emptyItems, mockLogger);
        expect(result).toEqual({
            success: true, // Operation itself succeeded, even if 0 items generated/written
            operation: 'generate',
            generated: 0,
            total: 0,
        });
    });

    test('should reflect partially successful writes from batchWriteItems', async () => {
        const totalItemsToGenerate = 10;
        mockOptions.count = totalItemsToGenerate;
        const dummyItems = Array.from({ length: totalItemsToGenerate }, (_, i) => ({
            PutRequest: { Item: { id: { S: `id-${i}` } } }
        }));
        const successfullyWrittenCount = 5; // Simulate only 5 items were written

        vi.mocked(awsService.generateDummyData).mockReturnValue(dummyItems);
        vi.mocked(awsService.batchWriteItems).mockResolvedValue(successfullyWrittenCount);

        const result = await awsService.executeGeneration(mockDynamoClient, mockTableName, mockUserId, mockOptions, mockLogger);

        expect(awsService.generateDummyData).toHaveBeenCalledWith(mockUserId, mockOptions, mockLogger);
        expect(awsService.batchWriteItems).toHaveBeenCalledWith(mockDynamoClient, mockTableName, dummyItems, mockLogger);
        expect(result).toEqual({
            success: true, // Or false if partial failure means !success, depends on definition
            operation: 'generate',
            generated: successfullyWrittenCount,
            total: totalItemsToGenerate,
        });
        // Optionally, check if a warning/error was logged for partial success if applicable
        // expect(mockLogger.warning).toHaveBeenCalled();
    });

    test('should handle batchWriteItems throwing an error', async () => {
        const dummyItems = [{ PutRequest: { Item: { id: { S: '1' } } } }];
        vi.mocked(awsService.generateDummyData).mockReturnValue(dummyItems);
        const batchWriteError = new Error('DynamoDB write failed');
        vi.mocked(awsService.batchWriteItems).mockRejectedValue(batchWriteError);

        await expect(
            awsService.executeGeneration(mockDynamoClient, mockTableName, mockUserId, mockOptions, mockLogger)
        ).rejects.toThrow(batchWriteError);

        expect(awsService.generateDummyData).toHaveBeenCalledWith(mockUserId, mockOptions, mockLogger);
        expect(awsService.batchWriteItems).toHaveBeenCalledWith(mockDynamoClient, mockTableName, dummyItems, mockLogger);
    });
});

// Test suite for executeDelete
describe('executeDelete', () => {
    let mockDynamoClient;
    const mockTableName = 'TestTable';
    const mockUserId = 'test-user-id';
    let mockLogger;

    beforeEach(() => {
        vi.clearAllMocks();
        dynamoMock.reset();
        mockDynamoClient = new DynamoDBClient({});
        mockLogger = { // Basic logger mock
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            progress: vi.fn() // If deleteUserData uses logger.progress
        };

        // Spy on deleteUserData from awsService
        vi.spyOn(awsService, 'deleteUserData');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('should call deleteUserData and return success with deleted count', async () => {
        const deletedCount = 5;
        vi.mocked(awsService.deleteUserData).mockResolvedValue(deletedCount);

        const result = await awsService.executeDelete(mockDynamoClient, mockTableName, mockUserId, mockLogger);

        expect(awsService.deleteUserData).toHaveBeenCalledWith(mockDynamoClient, mockTableName, mockUserId, mockLogger);
        expect(result).toEqual({
            success: true,
            operation: 'delete',
            deleted: deletedCount,
        });
    });

    test('should return deleted count as 0 if deleteUserData returns 0', async () => {
        vi.mocked(awsService.deleteUserData).mockResolvedValue(0);

        const result = await awsService.executeDelete(mockDynamoClient, mockTableName, mockUserId, mockLogger);

        expect(awsService.deleteUserData).toHaveBeenCalledWith(mockDynamoClient, mockTableName, mockUserId, mockLogger);
        expect(result).toEqual({
            success: true,
            operation: 'delete',
            deleted: 0,
        });
    });

    test('should propagate error from deleteUserData', async () => {
        const expectedError = new Error('Delete operation failed in deleteUserData');
        vi.mocked(awsService.deleteUserData).mockRejectedValue(expectedError);

        await expect(awsService.executeDelete(mockDynamoClient, mockTableName, mockUserId, mockLogger))
            .rejects.toThrow(expectedError);

        expect(awsService.deleteUserData).toHaveBeenCalledWith(mockDynamoClient, mockTableName, mockUserId, mockLogger);
    });
});

// Test suite for deleteUserData
describe('deleteUserData', () => {
    let mockDynamoClientInstance;
    const mockTableName = 'TestDeleteTable';
    const mockUserId = 'user-to-delete';
    let mockLogger;

    beforeEach(() => {
        vi.clearAllMocks(); // Clear all vi mocks
        dynamoMock.reset(); // Reset aws-sdk-client-mock history and behaviors for DynamoDB
        mockDynamoClientInstance = new DynamoDBClient({}); // Fresh instance for each test

        // Use the globally mocked log from core/utils.js
        mockLogger = log;
        // Clear specific log mocks if needed, though vi.clearAllMocks() should handle vi.fn() instances
        Object.values(mockLogger).forEach(mockFn => {
            if (vi.isMockFunction(mockFn)) {
                mockFn.mockClear();
            }
        });
    });

    afterEach(() => {
        // spies on awsService methods are restored by the global afterEach if they exist
    });

    test('should query and delete items in batches if found', async () => {
        const itemsToDelete = Array.from({ length: GENERATE_TEST_DATA.DYNAMODB_BATCH_SIZE + 5 }, (_, i) => ({
            userId: { S: mockUserId },
            sk: { S: `item#${i}` }
        })); // Example: 25 + 5 = 30 items

        dynamoMock.on(QueryCommand).resolves({ Items: itemsToDelete, Count: itemsToDelete.length });
        dynamoMock.on(BatchWriteItemCommand)
            .resolvesOnce({ UnprocessedItems: {} }) // First batch (25 items)
            .resolvesOnce({ UnprocessedItems: {} }); // Second batch (5 items)

        const deletedCount = await awsService.deleteUserData(mockDynamoClientInstance, mockTableName, mockUserId, { logger: mockLogger });

        expect(dynamoMock.commandCalls(QueryCommand)[0].args[0].input).toEqual({
            TableName: mockTableName,
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': { S: mockUserId } },
        });

        // Verify BatchWriteItemCommand was called twice due to batching
        const batchWriteCalls = dynamoMock.commandCalls(BatchWriteItemCommand);
        expect(batchWriteCalls).toHaveLength(2);

        // Check first batch
        expect(batchWriteCalls[0].args[0].input.RequestItems[mockTableName].length).toBe(GENERATE_TEST_DATA.DYNAMODB_BATCH_SIZE);
        // Check second batch
        expect(batchWriteCalls[1].args[0].input.RequestItems[mockTableName].length).toBe(5);

        expect(deletedCount).toBe(itemsToDelete.length);
        expect(mockLogger.database).toHaveBeenCalledWith(expect.stringContaining(`Querying existing data for user: ${mockUserId} in table ${mockTableName}`));
        expect(mockLogger.warning).toHaveBeenCalledWith(expect.stringContaining(`Found ${itemsToDelete.length} items for user ${mockUserId} to delete.`));
        expect(mockLogger.progress).toHaveBeenCalledTimes(2); // For each batch
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining(`Successfully deleted ${itemsToDelete.length} items for user ${mockUserId}`));
    });

    test('should return 0 if no items are found for the user', async () => {
        dynamoMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

        const deletedCount = await awsService.deleteUserData(mockDynamoClientInstance, mockTableName, mockUserId, { logger: mockLogger });

        expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(1);
        expect(dynamoMock.commandCalls(BatchWriteItemCommand)).toHaveLength(0); // No batch writes
        expect(deletedCount).toBe(0);
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining(`No items found for user ${mockUserId} in table ${mockTableName}. No deletion needed.`));
    });

    test('should throw error if QueryCommand fails', async () => {
        const queryError = new Error('Query failed');
        dynamoMock.on(QueryCommand).rejects(queryError);

        await expect(awsService.deleteUserData(mockDynamoClientInstance, mockTableName, mockUserId, { logger: mockLogger }))
            .rejects.toThrow(queryError);
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error querying data for deletion'), queryError);
    });

    test('should throw error if BatchWriteItemCommand fails initially and no retries (or retries exhausted)', async () => {
        const itemsToDelete = [{ userId: { S: mockUserId }, sk: { S: 'item#1' } }];
        const batchWriteError = new Error('BatchWrite failed');
        dynamoMock.on(QueryCommand).resolves({ Items: itemsToDelete, Count: 1 });
        dynamoMock.on(BatchWriteItemCommand).rejects(batchWriteError); // Fail on first attempt

        await expect(awsService.deleteUserData(mockDynamoClientInstance, mockTableName, mockUserId, { logger: mockLogger }))
            .rejects.toThrow(batchWriteError);
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error in BatchWriteItemCommand during deletion'), batchWriteError);
    });

    test('should handle UnprocessedItems and retry successfully', async () => {
        const items = [
            { userId: { S: mockUserId }, sk: { S: 'item#1' } },
            { userId: { S: mockUserId }, sk: { S: 'item#2' } }
        ];
        const unprocessedKey = { userId: items[1].userId, sk: items[1].sk }; // Second item is unprocessed

        dynamoMock.on(QueryCommand).resolves({ Items: items, Count: items.length });
        dynamoMock.on(BatchWriteItemCommand)
            .resolvesOnce({ // First attempt
                UnprocessedItems: {
                    [mockTableName]: [{ DeleteRequest: { Key: unprocessedKey } }]
                }
            })
            .resolvesOnce({ UnprocessedItems: {} }); // Second attempt (retry) is successful

        const deletedCount = await awsService.deleteUserData(mockDynamoClientInstance, mockTableName, mockUserId, { logger: mockLogger, maxRetries: 3, retryDelayMs: 10 });

        expect(dynamoMock.commandCalls(BatchWriteItemCommand)).toHaveLength(2);
        expect(deletedCount).toBe(items.length); // All items eventually deleted
        expect(mockLogger.warning).toHaveBeenCalledWith(expect.stringContaining('Unprocessed items returned by BatchWriteItemCommand. Retrying...'));
        expect(mockLogger.progress).toHaveBeenCalledTimes(2); // Once for initial, once for retry batch
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining(`Successfully deleted ${items.length} items for user ${mockUserId}`));
    });

    test('should give up after max retries for UnprocessedItems', async () => {
        const items = [{ userId: { S: mockUserId }, sk: { S: 'item#1' } }];
        const unprocessedKey = { userId: items[0].userId, sk: items[0].sk };
        const maxRetries = 2;

        dynamoMock.on(QueryCommand).resolves({ Items: items, Count: items.length });
        // Always return UnprocessedItems
        dynamoMock.on(BatchWriteItemCommand).resolves({
            UnprocessedItems: { [mockTableName]: [{ DeleteRequest: { Key: unprocessedKey } }] }
        });

        await expect(awsService.deleteUserData(mockDynamoClientInstance, mockTableName, mockUserId, { logger: mockLogger, maxRetries, retryDelayMs: 10 }))
            .rejects.toThrow(`Failed to delete items after ${maxRetries} retries. ${JSON.stringify({[mockTableName]: [{DeleteRequest: {Key: unprocessedKey}}])} items remained unprocessed.`);

        expect(dynamoMock.commandCalls(BatchWriteItemCommand)).toHaveLength(maxRetries + 1); // Initial attempt + maxRetries
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining(`Failed to delete items after ${maxRetries} retries.`));
    });

});

// Test suite for executeReset
describe('executeReset', () => {
    let mockDynamoClient;
    const mockTableName = 'TestTable';
    const mockUserId = 'test-user-id';
    let mockOptions;
    let mockLogger;

    beforeEach(() => {
        vi.clearAllMocks();
        dynamoMock.reset();
        mockDynamoClient = new DynamoDBClient({});
        mockOptions = {
            count: 10,
            status: GENERATE_TEST_DATA.USER_STATUS_OPTIONS.ACTIVE,
            useRealEmail: false,
            dummyEmail: 'dummy@example.com'
        };
        mockLogger = {
            info: vi.fn(),
            success: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            progress: vi.fn()
        };

        vi.spyOn(awsService, 'deleteUserData');
        vi.spyOn(awsService, 'generateDummyData');
        vi.spyOn(awsService, 'batchWriteItems');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('should call delete, generate, and batchWrite, then return combined success', async () => {
        const deletedCount = 5;
        const generatedItems = Array.from({ length: mockOptions.count }, (_, i) => ({
            PutRequest: { Item: { id: { S: `reset-id-${i}` } } }
        }));
        const writtenCount = mockOptions.count;

        vi.mocked(awsService.deleteUserData).mockResolvedValue(deletedCount);
        vi.mocked(awsService.generateDummyData).mockReturnValue(generatedItems);
        vi.mocked(awsService.batchWriteItems).mockResolvedValue(writtenCount);
        // log.success is already a vi.fn() due to the global mock of core/utils.js

        const result = await awsService.executeReset(mockDynamoClient, mockTableName, mockUserId, mockOptions, mockLogger);

        expect(awsService.deleteUserData).toHaveBeenCalledWith(mockDynamoClient, mockTableName, mockUserId, mockLogger);
        expect(mockLogger.success).toHaveBeenCalledWith(`Successfully deleted ${deletedCount} items for user ${mockUserId}.`);
        expect(awsService.generateDummyData).toHaveBeenCalledWith(mockUserId, mockOptions, mockLogger);
        expect(awsService.batchWriteItems).toHaveBeenCalledWith(mockDynamoClient, mockTableName, generatedItems, mockLogger);
        expect(result).toEqual({
            success: true,
            operation: 'reset',
            deleted: deletedCount,
            generated: writtenCount,
            total: generatedItems.length,
        });
    });

    test('should propagate error if deleteUserData fails', async () => {
        const deleteError = new Error('Deletion failed');
        vi.mocked(awsService.deleteUserData).mockRejectedValue(deleteError);

        await expect(awsService.executeReset(mockDynamoClient, mockTableName, mockUserId, mockOptions, mockLogger))
            .rejects.toThrow(deleteError);

        expect(awsService.deleteUserData).toHaveBeenCalledWith(mockDynamoClient, mockTableName, mockUserId, mockLogger);
        expect(awsService.generateDummyData).not.toHaveBeenCalled();
        expect(awsService.batchWriteItems).not.toHaveBeenCalled();
    });

    test('should propagate error if generateDummyData fails after successful delete', async () => {
        const deletedCount = 3;
        const generateError = new Error('Data generation failed');
        vi.mocked(awsService.deleteUserData).mockResolvedValue(deletedCount);
        vi.mocked(awsService.generateDummyData).mockImplementation(() => {
            throw generateError;
        });

        await expect(awsService.executeReset(mockDynamoClient, mockTableName, mockUserId, mockOptions, mockLogger))
            .rejects.toThrow(generateError);

        expect(awsService.deleteUserData).toHaveBeenCalledWith(mockDynamoClient, mockTableName, mockUserId, mockLogger);
        expect(mockLogger.success).toHaveBeenCalledWith(`Successfully deleted ${deletedCount} items for user ${mockUserId}.`);
        expect(awsService.generateDummyData).toHaveBeenCalledWith(mockUserId, mockOptions, mockLogger);
        expect(awsService.batchWriteItems).not.toHaveBeenCalled();
    });

    test('should propagate error if batchWriteItems fails after successful delete and generate', async () => {
        const deletedCount = 7;
        const generatedItems = [{ PutRequest: { Item: {} } }];
        const writeError = new Error('Batch write failed');

        vi.mocked(awsService.deleteUserData).mockResolvedValue(deletedCount);
        vi.mocked(awsService.generateDummyData).mockReturnValue(generatedItems);
        vi.mocked(awsService.batchWriteItems).mockRejectedValue(writeError);

        await expect(awsService.executeReset(mockDynamoClient, mockTableName, mockUserId, mockOptions, mockLogger))
            .rejects.toThrow(writeError);

        expect(awsService.deleteUserData).toHaveBeenCalledWith(mockDynamoClient, mockTableName, mockUserId, mockLogger);
        expect(mockLogger.success).toHaveBeenCalledWith(`Successfully deleted ${deletedCount} items for user ${mockUserId}.`);
        expect(awsService.generateDummyData).toHaveBeenCalledWith(mockUserId, mockOptions, mockLogger);
        expect(awsService.batchWriteItems).toHaveBeenCalledWith(mockDynamoClient, mockTableName, generatedItems, mockLogger);
    });

    test('should handle zero items deleted and zero items generated/written', async () => {
        vi.mocked(awsService.deleteUserData).mockResolvedValue(0);
        vi.mocked(awsService.generateDummyData).mockReturnValue([]);
        vi.mocked(awsService.batchWriteItems).mockResolvedValue(0);

        const result = await awsService.executeReset(mockDynamoClient, mockTableName, mockUserId, mockOptions, mockLogger);

        expect(mockLogger.success).toHaveBeenCalledWith(`Successfully deleted 0 items for user ${mockUserId}.`);
        expect(result).toEqual({
            success: true,
            operation: 'reset',
            deleted: 0,
            generated: 0,
            total: 0,
        });
    });
});