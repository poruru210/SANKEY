/**
 * Integration Test Repository
 *
 * Handles DynamoDB operations for integration test data
 */

import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { UserProfile, IntegrationTest } from '../models/userProfile';
import { IntegrationTestRepositoryDependencies } from '../di/dependencies';

/**
 * Repository for integration test related DynamoDB operations
 */
export class IntegrationTestRepository {
    private readonly docClient: DynamoDBDocumentClient;
    private readonly tableName: string;
    private readonly logger: Logger;

    /**
     * DI対応コンストラクタ
     */
    constructor(dependencies: IntegrationTestRepositoryDependencies) {
        this.docClient = dependencies.docClient;
        this.tableName = dependencies.tableName;
        this.logger = dependencies.logger;
    }

    /**
     * Retrieves a user profile from DynamoDB
     */
    async getUserProfile(userId: string): Promise<UserProfile | null> {
        try {
            const result = await this.docClient.send(new GetCommand({
                TableName: this.tableName,
                Key: { userId }
            }));

            return result.Item as UserProfile || null;
        } catch (error) {
            this.logger.error('Failed to get user profile:', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Updates the integration test data in user profile
     */
    async updateIntegrationTest(userId: string, integrationTest: IntegrationTest): Promise<void> {
        const timestamp = new Date().toISOString();

        try {
            await this.docClient.send(new UpdateCommand({
                TableName: this.tableName,
                Key: { userId },
                UpdateExpression: `
                    SET 
                    testResults.integration = :integration,
                    updatedAt = :updatedAt
                `,
                ExpressionAttributeValues: {
                    ':integration': integrationTest,
                    ':updatedAt': timestamp
                },
                ConditionExpression: 'attribute_exists(userId)'
            }));
        } catch (error) {
            this.logger.error('Failed to update integration test:', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Initializes integration test data for a user
     * Creates testResults structure if it doesn't exist
     */
    async initializeIntegrationTest(userId: string, integrationTest: IntegrationTest): Promise<void> {
        const timestamp = new Date().toISOString();

        try {
            // First attempt: Update with condition that testResults exists
            await this.docClient.send(new UpdateCommand({
                TableName: this.tableName,
                Key: { userId },
                UpdateExpression: `
                    SET 
                    testResults.integration = :integration,
                    updatedAt = :updatedAt
                `,
                ExpressionAttributeValues: {
                    ':integration': integrationTest,
                    ':updatedAt': timestamp
                },
                ConditionExpression: 'attribute_exists(testResults)'
            }));
        } catch (error) {
            // If testResults doesn't exist, create it
            if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
                await this.docClient.send(new UpdateCommand({
                    TableName: this.tableName,
                    Key: { userId },
                    UpdateExpression: `
                        SET 
                        testResults = :testResults,
                        updatedAt = :updatedAt
                    `,
                    ExpressionAttributeValues: {
                        ':testResults': {
                            integration: integrationTest
                        },
                        ':updatedAt': timestamp
                    },
                    ConditionExpression: 'attribute_exists(userId)'
                }));
            } else {
                throw error;
            }
        }
    }

    /**
     * Clears integration test data
     */
    async clearIntegrationTest(userId: string): Promise<void> {
        const timestamp = new Date().toISOString();

        try {
            await this.docClient.send(new UpdateCommand({
                TableName: this.tableName,
                Key: { userId },
                UpdateExpression: `
                    REMOVE testResults.integration
                    SET updatedAt = :updatedAt
                `,
                ExpressionAttributeValues: {
                    ':updatedAt': timestamp
                },
                ConditionExpression: 'attribute_exists(userId)'
            }));
        } catch (error) {
            this.logger.error('Failed to clear integration test:', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Updates setup test result
     */
    async updateSetupTest(userId: string, success: boolean, details?: string): Promise<void> {
        const timestamp = new Date().toISOString();

        try {
            await this.docClient.send(new UpdateCommand({
                TableName: this.tableName,
                Key: { userId },
                UpdateExpression: `
                    SET 
                    testResults.setup = :setup,
                    updatedAt = :updatedAt
                `,
                ExpressionAttributeValues: {
                    ':setup': {
                        success,
                        timestamp,
                        details
                    },
                    ':updatedAt': timestamp
                },
                ConditionExpression: 'attribute_exists(userId)'
            }));
        } catch (error) {
            // If testResults doesn't exist, create it
            if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
                await this.docClient.send(new UpdateCommand({
                    TableName: this.tableName,
                    Key: { userId },
                    UpdateExpression: `
                        SET 
                        testResults = :testResults,
                        updatedAt = :updatedAt
                    `,
                    ExpressionAttributeValues: {
                        ':testResults': {
                            setup: {
                                success,
                                timestamp,
                                details
                            }
                        },
                        ':updatedAt': timestamp
                    },
                    ConditionExpression: 'attribute_exists(userId)'
                }));
            } else {
                throw error;
            }
        }
    }

    /**
     * Updates user's setup phase
     */
    async updateSetupPhase(userId: string, phase: 'SETUP' | 'TEST' | 'PRODUCTION'): Promise<void> {
        const timestamp = new Date().toISOString();

        try {
            await this.docClient.send(new UpdateCommand({
                TableName: this.tableName,
                Key: { userId },
                UpdateExpression: `
                    SET 
                    setupPhase = :phase,
                    updatedAt = :updatedAt
                `,
                ExpressionAttributeValues: {
                    ':phase': phase,
                    ':updatedAt': timestamp
                },
                ConditionExpression: 'attribute_exists(userId)'
            }));
        } catch (error) {
            this.logger.error('Failed to update setup phase:', {
                userId,
                phase,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}