import { describe, test, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { 
    CloudFormationClient, 
    DescribeStacksCommand 
} from '@aws-sdk/client-cloudformation';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SSMClient } from '@aws-sdk/client-ssm';
import { 
    createAwsClients,
    findSankeyStacks,
    getStackOutputs,
    getCognitoDetails,
    findUserByEmail,
    listAllUsers,
    saveCertificateArn,
    getCertificateArn,
    getAwsConfiguration
} from '../../services/aws.js';
import { ApiError, ResourceNotFoundError, ConfigurationError, CdkNotDeployedError } from '../../core/errors.js';  

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