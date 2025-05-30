import { handler } from '../../src/handlers/createUser.handler';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest'; // Enables custom matchers
import {
    CognitoIdentityProviderClient,
    AdminCreateUserCommand,
    AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognitoMock = mockClient(CognitoIdentityProviderClient);

describe('Create User Handler', () => {
    beforeEach(() => {
        cognitoMock.reset();
    });

    const baseEvent = {
        requestContext: {
            authorizer: {
                claims: {
                    'cognito:groups': ['admin'],
                },
            },
        },
        body: JSON.stringify({
            email: 'test@example.com',
            accountId: 'account-123',
            temporaryPassword: 'TempPass123!',
        }),
    };

    it('201: Created user successfully', async () => {
        cognitoMock.on(AdminCreateUserCommand).resolves({
            User: { Username: 'created-user-id' },
        });
        cognitoMock.on(AdminSetUserPasswordCommand).resolves({});

        const event = baseEvent as unknown as APIGatewayProxyEvent;

        const result = (await handler(event, {} as any, () => {})) as APIGatewayProxyResult;

        expect(result.statusCode).toBe(201);

        const body = JSON.parse(result.body);
        expect(body.userId).toBe('created-user-id');
        expect(body.email).toBe('test@example.com');
        expect(body.accountId).toBe('account-123');
        expect(body.status).toBe('FORCE_CHANGE_PASSWORD');

        expect(cognitoMock).toHaveReceivedCommand(AdminCreateUserCommand);
        expect(cognitoMock).toHaveReceivedCommand(AdminSetUserPasswordCommand);
    });

    it('403: Forbidden - Admin access required', async () => {
        const event = {
            requestContext: {
                authorizer: {
                    claims: {
                        'cognito:groups': ['user'], // no admin group
                    },
                },
            },
            body: JSON.stringify({
                email: 'test@example.com',
                accountId: 'account-123',
            }),
        } as unknown as APIGatewayProxyEvent;

        const result = (await handler(event, {} as any, () => {})) as APIGatewayProxyResult;
        expect(result.statusCode).toBe(403);

        const body = JSON.parse(result.body);
        expect(body.error).toBe('Forbidden');
        expect(body.message).toBe('Admin access required');
    });

    it('400: Bad Request - Missing required parameters', async () => {
        const event = {
            requestContext: {
                authorizer: {
                    claims: {
                        'cognito:groups': ['admin'],
                    },
                },
            },
            body: JSON.stringify({
                email: '', // empty string
                accountId: '',
            }),
        } as unknown as APIGatewayProxyEvent;

        const result = (await handler(event, {} as any, () => {})) as APIGatewayProxyResult;
        expect(result.statusCode).toBe(400);

        const body = JSON.parse(result.body);
        expect(body.error).toBe('Missing required parameters');
        expect(body.message).toBe('email and accountId are required');
    });

    it('409: Conflict - User already exists', async () => {
        cognitoMock.on(AdminCreateUserCommand).rejects(
            Object.assign(new Error('User exists'), { name: 'UsernameExistsException' })
        );

        const event = baseEvent as unknown as APIGatewayProxyEvent;

        const result = (await handler(event, {} as any, () => {})) as APIGatewayProxyResult;
        expect(result.statusCode).toBe(409);

        const body = JSON.parse(result.body);
        expect(body.error).toBe('User already exists');
        expect(body.message).toBe('A user with this email already exists');
    });

    it('500: Internal Server Error - Unexpected error', async () => {
        cognitoMock.on(AdminCreateUserCommand).rejects(new Error('Unknown error'));

        const event = baseEvent as unknown as APIGatewayProxyEvent;

        const result = (await handler(event, {} as any, () => {})) as APIGatewayProxyResult;
        expect(result.statusCode).toBe(500);

        const body = JSON.parse(result.body);
        expect(body.error).toBe('Internal server error');
        expect(body.message).toBe('Failed to create user');
    });
});
