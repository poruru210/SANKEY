import httpErrorHandler from '@middy/http-error-handler';
import httpCors from '@middy/http-cors';
import eventNormalizer from '@middy/event-normalizer';

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

const logger = new Logger({ serviceName: 'license-service' });
const tracer = new Tracer({ serviceName: 'license-service' });

export const commonMiddleware = () => [
    httpErrorHandler(),
    httpCors({
        origin: '*',
        headers:
            'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
        methods: 'GET,POST,OPTIONS',
    }),
    eventNormalizer(),
    injectLambdaContext(logger),
    captureLambdaHandler(tracer),
] as const;

export { logger, tracer };
