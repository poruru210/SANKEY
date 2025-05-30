import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBDocumentClient, UpdateCommand, PutCommand, GetCommand, UpdateCommandInput } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import middy from '@middy/core';
import httpCors from '@middy/http-cors'; // ✅ 追加

const logger = new Logger();
const tracer = new Tracer();
const ddbClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);

type ApplicationStatus = 'Pending' | 'Active' | 'Expired' | 'Revoked' | 'Rejected';
type ActionType = 'approve' | 'reject' | 'deactivate';

interface EAApplication {
    userId: string;
    sk: string;
    accountNumber: string;
    eaName: string;
    broker: string;
    email: string;
    xAccount: string;
    status: ApplicationStatus;
    appliedAt: string;
    licenseKey?: string;
    expiresAt?: string;
}

interface EAApplicationHistory {
    userId: string;
    sk: string;
    action: string;
    changedBy: string;
    changedAt: string;
    previousStatus?: string;
    newStatus?: string;
}

interface UpdateRequest {
    action: ActionType;
    expiresAt?: string;
}

const baseHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        if (!event.body || !event.pathParameters?.key || !event.requestContext.authorizer?.claims?.sub) {
            return respond(400, 'Invalid request');
        }

        const userId = event.requestContext.authorizer.claims.sub;
        const applicationKey = event.pathParameters.key;
        const { action, expiresAt } = JSON.parse(event.body) as UpdateRequest;

        if (!isValidAction(action)) {
            return respond(400, 'Invalid action');
        }

        const currentApp = await getApplication(userId, applicationKey);
        if (!currentApp) {
            return respond(404, 'Application not found');
        }

        const { updateParams, newStatus } = buildUpdateParams({
            userId,
            applicationKey,
            action,
            expiresAt,
            currentStatus: currentApp.status
        });

        const { Attributes: updatedApp } = await docClient.send(new UpdateCommand(updateParams));

        await recordHistory({
            userId,
            applicationKey,
            action,
            changedBy: userId,
            previousStatus: currentApp.status,
            newStatus,
            appliedAt: currentApp.appliedAt,
            accountNumber: currentApp.accountNumber
        });

        return respond(200, 'Status updated', updatedApp);
    } catch (err) {
        logger.error('Error updating application', err as Error);
        return respond(500, 'Internal server error');
    }
};

export const handler = middy(baseHandler)
    .use(httpCors({
    origin: '*',
    headers:
        'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
    methods: 'POST,OPTIONS',
}));

function respond(statusCode: number, message: string, data?: any): APIGatewayProxyResult {
    return {
        statusCode,
        body: JSON.stringify({ message, ...(data && { data }) })
    };
}

function isValidAction(action: string): action is ActionType {
    return ['approve', 'reject', 'deactivate'].includes(action);
}

async function getApplication(userId: string, applicationKey: string): Promise<EAApplication | null> {
    try {
        const { Item } = await docClient.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: {
                userId,
                sk: `APPLICATION#${applicationKey}`
            }
        }));
        return Item as EAApplication | null;
    } catch (error) {
        logger.error('Failed to get application', { userId, applicationKey, error });
        throw error;
    }
}

function buildUpdateParams(params: {
    userId: string;
    applicationKey: string;
    action: ActionType;
    expiresAt?: string;
    currentStatus: ApplicationStatus;
}): { updateParams: UpdateCommandInput; newStatus: ApplicationStatus } {
    const { userId, applicationKey, action, expiresAt } = params;
    const now = new Date().toISOString();

    const updateParams: UpdateCommandInput = {
        TableName: process.env.TABLE_NAME,
        Key: { userId, sk: `APPLICATION#${applicationKey}` },
        UpdateExpression: 'SET #updatedAt = :now',
        ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: { ':now': now },
        ReturnValues: 'ALL_NEW'
    };

    let newStatus: ApplicationStatus;

    switch (action) {
        case 'approve':
            newStatus = 'Active';
            updateParams.UpdateExpression += ', #status = :status, #approvedAt = :now, #expiresAt = :expiresAt, #licenseKey = :licenseKey';
            Object.assign(updateParams.ExpressionAttributeNames!, {
                '#status': 'status',
                '#approvedAt': 'approvedAt',
                '#expiresAt': 'expiresAt',
                '#licenseKey': 'licenseKey'
            });
            Object.assign(updateParams.ExpressionAttributeValues!, {
                ':status': newStatus,
                ':expiresAt': expiresAt,
                ':licenseKey': generateLicenseKey()
            });
            break;

        case 'reject':
            newStatus = 'Rejected';
            updateParams.UpdateExpression += ', #status = :status';
            updateParams.ExpressionAttributeNames!['#status'] = 'status';
            updateParams.ExpressionAttributeValues![':status'] = newStatus;
            break;

        case 'deactivate':
            newStatus = 'Revoked';
            updateParams.UpdateExpression += ', #status = :status, #revokedAt = :now';
            Object.assign(updateParams.ExpressionAttributeNames!, {
                '#status': 'status',
                '#revokedAt': 'revokedAt'
            });
            Object.assign(updateParams.ExpressionAttributeValues!, {
                ':status': newStatus
            });
            break;

        default:
            throw new Error(`Unknown action: ${action}`);
    }

    return { updateParams, newStatus };
}

async function recordHistory(params: {
    userId: string;
    applicationKey: string;
    action: ActionType;
    changedBy: string;
    previousStatus: ApplicationStatus;
    newStatus: ApplicationStatus;
    appliedAt: string;
    accountNumber: string;
}): Promise<void> {
    const { userId, action, changedBy, previousStatus, newStatus, appliedAt, accountNumber } = params;
    const now = new Date().toISOString();

    const historyItem: EAApplicationHistory = {
        userId,
        sk: `HISTORY#${appliedAt}#${accountNumber}#${now}`,
        action,
        changedBy,
        changedAt: now,
        previousStatus,
        newStatus
    };

    await docClient.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: historyItem
    }));
}

function generateLicenseKey(): string {
    return `SMP-${new Date().getFullYear()}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
}
