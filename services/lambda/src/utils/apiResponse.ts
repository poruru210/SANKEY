// lambda/src/utils/apiResponse.ts
import { APIGatewayProxyResult } from 'aws-lambda';

/**
 * 統一APIレスポンス形式
 */
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    message: string;
    timestamp: string;
}

/**
 * 統一レスポンス作成関数
 * 全てのAPIエンドポイントで一貫したレスポンス形式を提供
 */
export function createResponse(
    statusCode: number,
    success: boolean,
    message: string,
    data?: any
): APIGatewayProxyResult {
    const response: ApiResponse = {
        success,
        message,
        timestamp: new Date().toISOString(),
        ...(data && { data })
    };

    return {
        statusCode,
        body: JSON.stringify(response),
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept,Cache-Control,X-Requested-With',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
        },
    };
}

/**
 * 成功レスポンス作成のヘルパー
 */
export function createSuccessResponse(message: string, data?: any): APIGatewayProxyResult {
    return createResponse(200, true, message, data);
}

/**
 * エラーレスポンス作成のヘルパー
 */
export function createErrorResponse(
    statusCode: number,
    message: string,
    error?: Error | string
): APIGatewayProxyResult {
    const errorData = error instanceof Error
        ? {
            error: error.message,
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        }
        : error
            ? { error: error }
            : undefined;

    return createResponse(statusCode, false, message, errorData);
}

/**
 * バリデーションエラー用のヘルパー
 */
export function createValidationErrorResponse(message: string, details?: any): APIGatewayProxyResult {
    return createResponse(400, false, message, details);
}

/**
 * 認証エラー用のヘルパー
 */
export function createUnauthorizedResponse(message: string = 'Unauthorized'): APIGatewayProxyResult {
    return createResponse(401, false, message);
}

/**
 * 権限エラー用のヘルパー
 */
export function createForbiddenResponse(message: string = 'Forbidden'): APIGatewayProxyResult {
    return createResponse(403, false, message);
}

/**
 * 見つからないエラー用のヘルパー
 */
export function createNotFoundResponse(message: string = 'Not found'): APIGatewayProxyResult {
    return createResponse(404, false, message);
}

/**
 * サーバーエラー用のヘルパー
 */
export function createInternalErrorResponse(
    message: string = 'Internal server error',
    error?: Error
): APIGatewayProxyResult {
    return createErrorResponse(500, message, error);
}