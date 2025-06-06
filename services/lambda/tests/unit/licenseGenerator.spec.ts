import { handler } from '../../src/handlers/licenseGenerator.handler';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context, Callback } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import * as encryptionService from '../../src/services/encryption';

const ssmMock = mockClient(SSMClient);

jest.mock('../../src/services/encryption', () => ({
    encryptLicense: jest.fn(),
}));

const createEvent = (body: any, authorizerClaims?: any): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '/',
    requestContext: {
        accountId: '',
        apiId: '',
        authorizer: {
            claims: authorizerClaims || {},
        },
        protocol: '',
        httpMethod: '',
        identity: {} as any,
        path: '',
        stage: '',
        requestId: '',
        requestTimeEpoch: 0,
        resourceId: '',
        resourcePath: '',
    },
});

describe('licenseGenerator.handler', () => {
    beforeEach(() => {
        ssmMock.reset();
        jest.clearAllMocks();
        process.env.SSM_PREFIX = '/test/key';
    });

    it('should return 200 with valid license', async () => {
        const userId = 'user-123';
        const accountId = 'account-abc';
        const futureDate = new Date(Date.now() + 100000).toISOString();

        // 32バイト（256ビット）長のキーをBase64にエンコード
        const fixedTestKeyBase64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32バイトのバッファ(すべて0x01)
        ssmMock.on(GetParameterCommand).resolves({
            Parameter: { Value: fixedTestKeyBase64 },
        });

        (encryptionService.encryptLicense as jest.Mock).mockResolvedValue('encrypted-license');

        const event = createEvent({
            userId,
            accountId,
            body: JSON.stringify({ eaName: 'TestEA', expiry: futureDate }),
        });

        // handlerは3引数受け取るが、テストではcontext, callbackは空オブジェクトや関数で代用可
        const result = (await handler(event, {} as Context, () => {}) ) as APIGatewayProxyResult;

        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);
        expect(body.license).toBe('encrypted-license');
        expect(body.expiresAt).toBe(futureDate);
    });

    it('should return 400 if parameters are missing', async () => {
        const event = createEvent({
            userId: '',
            accountId: '',
            body: JSON.stringify({ eaName: '', expiry: '' }),
        });

        const result = (await handler(event, {} as Context, () => {})) as APIGatewayProxyResult;

        expect(result.statusCode).toBe(400);
        const body = JSON.parse(result.body);
        expect(body.error).toBe('Missing required parameters');
    });

    it('should return 400 if expiry is invalid', async () => {
        const userId = 'user-123';
        const accountId = 'account-abc';
        const event = createEvent({
            userId,
            accountId,
            body: JSON.stringify({ eaName: 'TestEA', expiry: 'invalid-date' }),
        });

        const result = (await handler(event, {} as Context, () => {})) as APIGatewayProxyResult;
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toBe('Invalid expiry date');
    });

    it('should return 500 if SSM fails', async () => {
        const userId = 'user-123';
        const accountId = 'account-abc';
        const futureDate = new Date(Date.now() + 100000).toISOString();

        ssmMock.on(GetParameterCommand).rejects(new Error('SSM failure'));

        const event = createEvent({
            userId,
            accountId,
            body: JSON.stringify({ eaName: 'TestEA', expiry: futureDate }),
        });

        const result = (await handler(event, {} as Context, () => {})) as APIGatewayProxyResult;

        expect(result.statusCode).toBe(500);
        expect(JSON.parse(result.body).error).toBe('Internal server error');
    });
});
