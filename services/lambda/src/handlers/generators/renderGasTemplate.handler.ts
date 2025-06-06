import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as Mustache from 'mustache';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import * as fs from 'fs';
import * as path from 'path';

import middy from '@middy/core';
import httpCors from '@middy/http-cors';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

const logger = new Logger({ serviceName: 'render-gas-template', logLevel: 'DEBUG' });
const tracer = new Tracer({ serviceName: 'render-gas-template' });
const ssmClient = tracer.captureAWSv3Client(new SSMClient({}));

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

     const masterKeyParameterName = `/license-service/users/${userId}/master-key`;
     let masterKey;
     try {
       const command = new GetParameterCommand({ Name: masterKeyParameterName, WithDecryption: true });
       const ssmResponse = await ssmClient.send(command);
       masterKey = ssmResponse.Parameter?.Value;
       if (!masterKey) {
         logger.error('Master key not found in SSM', { parameterName: masterKeyParameterName });
         return {
           statusCode: 404,
           body: JSON.stringify({ message: 'Configuration error: Master key not found for user.' }),
         };
       }
       logger.info('Successfully fetched master key from SSM.');
     } catch (error) {
       logger.error('Error fetching master key from SSM', { parameterName: masterKeyParameterName, error });
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
     logger.error('Unexpected error in baseHandler', { error });
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
