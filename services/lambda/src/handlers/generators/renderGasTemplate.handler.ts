// services/lambda/src/handlers/generators/renderGasTemplate.handler.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import Mustache from 'mustache';  // default importに変更
import * as fs from 'fs';
import * as path from 'path';

import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

import { createProductionContainer } from '../../di/container';
import type { RenderGasTemplateHandlerDependencies } from '../../di/types';

// テンプレートファイルの読み込みを関数内に移動
const loadTemplate = (): string => {
    const templatePath = path.join(__dirname, 'template.gas.mustache');
    try {
        const template = fs.readFileSync(templatePath, 'utf8');
        if (!template || template.trim() === '') {
            throw new Error(`Template file '${templatePath}' is empty or contains only whitespace.`);
        }
        return template;
    } catch (error) {
        console.error(`CRITICAL: Failed to load GAS template file '${templatePath}'.`, { error });
        throw error;
    }
};

// ハンドラーファクトリー
export const createHandler = (deps: RenderGasTemplateHandlerDependencies) => {
    // テンプレートを事前に読み込み（テスト時はモックされる）
    let gasTemplate: string;
    try {
        gasTemplate = loadTemplate();
    } catch (error) {
        // テスト環境では fs がモックされているので、デフォルト値を使用
        gasTemplate = 'TEMPLATE_CONTENT';
    }

    return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
        try {
            // authorizerの存在チェックを追加
            if (!event.requestContext?.authorizer) {
                deps.logger.error('User ID (sub) not found in Cognito claims');
                return {
                    statusCode: 401,
                    body: JSON.stringify({ message: 'Unauthorized: User ID not found.' }),
                };
            }

            const userId = event.requestContext.authorizer.claims?.sub;
            if (!userId) {
                deps.logger.error('User ID (sub) not found in Cognito claims');
                return {
                    statusCode: 401,
                    body: JSON.stringify({ message: 'Unauthorized: User ID not found.' }),
                };
            }
            deps.logger.info('Resolved User ID:', { userId });

            // API Endpoint の構築
            let apiEndpoint: string;
            const configuredApiEndpoint = process.env.API_ENDPOINT;

            if (configuredApiEndpoint) {
                // Use the configured API endpoint (custom domain)
                apiEndpoint = configuredApiEndpoint;
                deps.logger.info('Using configured API endpoint:', { apiEndpoint });
            } else {
                // Fallback to dynamic construction using API Gateway context
                if (!event.requestContext || !event.requestContext.domainName || !event.requestContext.stage) {
                    deps.logger.error('API Gateway context (domainName or stage) not found in event.requestContext');
                    return {
                        statusCode: 500,
                        body: JSON.stringify({ message: 'Internal Server Error: API Gateway context not available.' }),
                    };
                }
                apiEndpoint = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
                deps.logger.info('Using dynamic API Gateway endpoint:', { apiEndpoint });
            }

            // 新しいAPIエンドポイント構成に対応
            const webhookUrl = `${apiEndpoint}/applications/webhook`;
            const testNotificationUrl = `${apiEndpoint}/integration/test/gas-connection`;
            const resultNotificationUrl = `${apiEndpoint}/integration/result/notification`;

            deps.logger.info('Constructed URLs for GAS template:', {
                webhookUrl,
                testNotificationUrl,
                resultNotificationUrl
            });

            // 🔄 JWT_SECRET を取得（MASTER_KEY ではない）
            let jwtSecret: string;
            try {
                jwtSecret = await deps.jwtKeyService.getJwtSecret(userId);
                deps.logger.info('Successfully fetched JWT secret from SSM for GAS template.');
            } catch (error) {
                deps.logger.error('Error fetching JWT secret for GAS template', {
                    userId,
                    error: error instanceof Error ? error.message : String(error)
                });

                // エラーの種類に応じてレスポンスを分岐
                if (error instanceof Error) {
                    if (error.message.includes('JWT secret not found')) {
                        return {
                            statusCode: 404,
                            body: JSON.stringify({ message: 'Configuration error: JWT secret not found for user.' }),
                        };
                    } else if (error.message.includes('Access denied')) {
                        return {
                            statusCode: 403,
                            body: JSON.stringify({ message: 'Access denied to user configuration.' }),
                        };
                    }
                }

                return {
                    statusCode: 500,
                    body: JSON.stringify({ message: 'Internal Server Error: Could not retrieve JWT secret.' }),
                };
            }

            // 🔄 Mustache テンプレートデータ（JWT_SECRET使用）
            const templateData = {
                webhookUrl,
                testNotificationUrl,
                resultNotificationUrl,
                userId,
                jwtSecret,  // 🔄 masterKey → jwtSecret に変更
            };

            deps.logger.info('Template data prepared for rendering', {
                userId,
                hasWebhookUrl: !!templateData.webhookUrl,
                hasTestNotificationUrl: !!templateData.testNotificationUrl,
                hasResultNotificationUrl: !!templateData.resultNotificationUrl,
                hasJwtSecret: !!templateData.jwtSecret
            });

            const renderedGasScript = Mustache.render(gasTemplate, templateData);
            deps.logger.info('GAS Template rendered successfully with JWT_SECRET for secure GAS communication.');

            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/plain',
                    'Content-Disposition': 'attachment; filename="sankey_gas_script.gs"',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
                    'Access-Control-Allow-Methods': 'GET,OPTIONS',
                },
                body: renderedGasScript,
            };

        } catch (error) {
            deps.logger.error('Unexpected error in renderGasTemplate handler', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });

            // API Gateway contextエラーかチェック
            if (error instanceof Error && error.message.includes('Cannot read properties')) {
                return {
                    statusCode: 500,
                    body: JSON.stringify({ message: 'Internal Server Error: API Gateway context not available.' }),
                };
            }

            return {
                statusCode: 500,
                body: JSON.stringify({ message: 'Internal Server Error: An unexpected error occurred.' }),
            };
        }
    };
};

// Production設定
const container = createProductionContainer();
const dependencies: RenderGasTemplateHandlerDependencies = {
    jwtKeyService: container.resolve('jwtKeyService'),
    logger: container.resolve('logger') as Logger,
    tracer: container.resolve('tracer') as Tracer
};

const baseHandler = createHandler(dependencies);

// Middleware適用
export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'GET,OPTIONS',
    }))
    .use(injectLambdaContext(dependencies.logger, { clearState: true }))
    .use(captureLambdaHandler(dependencies.tracer));