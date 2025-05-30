import { APIGatewayProxyHandler } from 'aws-lambda';
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger();
const cognitoClient = new CognitoIdentityProviderClient({});

interface CreateUserRequest {
  email: string;
  accountId: string;
  temporaryPassword?: string;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  logger.info('Create user request', { event });

  try {
    // 管理者権限の確認（Cognitoグループなどで実装可能）
    const claims = event.requestContext.authorizer?.claims;
    if (!claims || !isAdmin(claims)) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Forbidden',
          message: 'Admin access required',
        }),
      };
    }

    const requestBody: CreateUserRequest = JSON.parse(event.body!);
    const { email, accountId, temporaryPassword } = requestBody;

    // 入力検証
    if (!email || !accountId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Missing required parameters',
          message: 'email and accountId are required',
        }),
      };
    }

    // ユーザー作成
    const createUserResponse = await cognitoClient.send(new AdminCreateUserCommand({
      UserPoolId: process.env.USER_POOL_ID!,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:accountId', Value: accountId },
      ],
      TemporaryPassword: temporaryPassword || generateTemporaryPassword(),
      MessageAction: 'SUPPRESS', // 招待メールを送らない（API経由で管理）
    }));

    const userId = createUserResponse.User?.Username!;

    // 永続的なパスワードを設定（オプション）
    if (temporaryPassword) {
      await cognitoClient.send(new AdminSetUserPasswordCommand({
        UserPoolId: process.env.USER_POOL_ID!,
        Username: userId,
        Password: temporaryPassword,
        Permanent: false, // 初回ログイン時に変更を要求
      }));
    }

    logger.info('User created successfully', {
      userId,
      email,
      accountId,
    });

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        userId,
        email,
        accountId,
        status: 'FORCE_CHANGE_PASSWORD',
        message: 'User created successfully. Password must be changed on first login.',
      }),
    };
  } catch (error) {
    logger.error('Error creating user', { error });

    // エラーハンドリング
    if (error instanceof Error) {
      if (error.name === 'UsernameExistsException') {
        return {
          statusCode: 409,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            error: 'User already exists',
            message: 'A user with this email already exists',
          }),
        };
      }
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to create user',
      }),
    };
  }
};

function isAdmin(claims: any): boolean {
  // Cognitoグループベースの確認
  const groups = claims['cognito:groups'];
  return groups && groups.includes('admin');
}

function generateTemporaryPassword(): string {
  // セキュアなランダムパスワード生成
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}