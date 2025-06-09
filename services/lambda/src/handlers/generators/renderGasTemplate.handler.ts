// services/lambda/src/handlers/generators/renderGasTemplate.handler.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as Mustache from 'mustache';
import * as fs from 'fs';
import * as path from 'path';

import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { SSMClient } from '@aws-sdk/client-ssm';

import { MasterKeyService } from '../../services/masterKeyService';

const logger = new Logger({ serviceName: 'render-gas-template', logLevel: 'DEBUG' });
const tracer = new Tracer({ serviceName: 'render-gas-template' });

// SSM Client with tracing
const ssmClient = tracer.captureAWSv3Client(new SSMClient({}));

// Master Key Service の初期化
const masterKeyService = new MasterKeyService({
    ssmClient,
    logger
});

// Load the template from file - robustly
const templatePath = path.join(__dirname, 'template.gas.mustache');
let gasTemplate: string;
try {
    gasTemplate = fs.readFileSync(templatePath, 'utf8');
    if (gasTemplate.trim() === '') {
        // Check if template is empty or only whitespace
        const err = new Error(`Template file '${templatePath}' is empty or contains only whitespace.`);
        logger.error("CRITICAL: Empty GAS template file.", { path: templatePath, error: err });
        throw err;
    }
} catch (error) {
    logger.error(`CRITICAL: Failed to load GAS template file '${templatePath}'. This Lambda will not function.`, { error });
    throw error; // Re-throw to fail Lambda initialization
}

const baseHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            logger.error('User ID (sub) not found in Cognito claims');
            return {
                statusCode: 401,
                body: JSON.stringify({ message: 'Unauthorized: User ID not found.' }),
            };
        }
        logger.info('Resolved User ID:', { userId });

        // Construct webhookUrl dynamically
        if (!event.requestContext || !event.requestContext.domainName || !event.requestContext.stage) {
            logger.error('API Gateway context (domainName or stage) not found in event.requestContext');
            return {
                statusCode: 500,
                body: JSON.stringify({ message: 'Internal Server Error: API Gateway context not available.' }),
            };
        }
        const webhookUrl = `https://${event.requestContext.domainName}/${event.requestContext.stage}/applications/webhook`;
        logger.info('Dynamically constructed Webhook URL:', { webhookUrl });

        // 共通サービスを使用してマスターキーを取得
        let masterKey: string;
        try {
            masterKey = await masterKeyService.getUserMasterKeyRaw(userId);
            logger.info('Successfully fetched master key from SSM using MasterKeyService.');
        } catch (error) {
            logger.error('Error fetching master key using MasterKeyService', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });

            // エラーの種類に応じてレスポンスを分岐
            if (error instanceof Error) {
                if (error.message.includes('Master key not found')) {
                    return {
                        statusCode: 404,
                        body: JSON.stringify({ message: 'Configuration error: Master key not found for user.' }),
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
                body: JSON.stringify({ message: 'Internal Server Error: Could not retrieve master key.' }),
            };
        }

        const templateData = {
            webhookUrl,
            userId,
            masterKey,
        };

        const renderedGasScript = Mustache.render(gasTemplate, templateData);
        logger.info('GAS Template rendered successfully.');

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/plain',
                'Content-Disposition': 'attachment; filename="generated_script.gs"',
            },
            body: renderedGasScript,
        };

    } catch (error) {
        logger.error('Unexpected error in baseHandler', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal Server Error: An unexpected error occurred.' }),
        };
    }
};

export const handler = middy(baseHandler)
    .use(httpCors({
        origin: '*',
        headers: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'GET,OPTIONS',
    }))
    .use(injectLambdaContext(logger, { clearState: true }))
    .use(captureLambdaHandler(tracer));