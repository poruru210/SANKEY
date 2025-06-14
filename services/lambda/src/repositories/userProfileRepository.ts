/**
 * User Profile Repository
 *
 * Handles DynamoDB operations for user profile data
 */

import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { UserProfile, SetupPhase } from '../../models/userProfile';
import { UserProfileRepositoryDependencies } from '../../di/types';

/**
 * Update options for user profile
 */
export interface UserProfileUpdateOptions {
    setupPhase?: SetupPhase;
    notificationEnabled?: boolean;
    testResults?: UserProfile['testResults'];
}

/**
 * Repository for user profile related DynamoDB operations
 */
export class UserProfileRepository {
    private readonly docClient: DynamoDBDocumentClient;
    private readonly tableName: string;
    private readonly logger: Logger;

    constructor(dependencies: UserProfileRepositoryDependencies) {
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
            this.logger.error('Failed to get user profile', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Creates a new user profile
     */
    async createUserProfile(profile: UserProfile): Promise<void> {
        try {
            await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: profile,
                ConditionExpression: 'attribute_not_exists(userId)'
            }));

            this.logger.info('User profile created successfully', {
                userId: profile.userId,
                setupPhase: profile.setupPhase
            });
        } catch (error) {
            if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
                const message = 'User profile already exists';
                this.logger.error('Failed to create user profile', {
                    userId: profile.userId,
                    error: message
                });
                throw new Error(message);
            }

            this.logger.error('Failed to create user profile', {
                userId: profile.userId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Updates an existing user profile
     */
    async updateUserProfile(userId: string, updates: UserProfileUpdateOptions): Promise<UserProfile> {
        try {
            const timestamp = new Date().toISOString();

            // Build update expression
            const updateExpressions: string[] = [];
            const expressionAttributeNames: Record<string, string> = {};
            const expressionAttributeValues: Record<string, any> = {};

            // Add each update field
            if (updates.setupPhase !== undefined) {
                updateExpressions.push('#setupPhase = :setupPhase');
                expressionAttributeNames['#setupPhase'] = 'setupPhase';
                expressionAttributeValues[':setupPhase'] = updates.setupPhase;
            }

            if (updates.notificationEnabled !== undefined) {
                updateExpressions.push('#notificationEnabled = :notificationEnabled');
                expressionAttributeNames['#notificationEnabled'] = 'notificationEnabled';
                expressionAttributeValues[':notificationEnabled'] = updates.notificationEnabled;
            }

            if (updates.testResults !== undefined) {
                updateExpressions.push('#testResults = :testResults');
                expressionAttributeNames['#testResults'] = 'testResults';
                expressionAttributeValues[':testResults'] = updates.testResults;
            }

            // Always update updatedAt
            updateExpressions.push('#updatedAt = :updatedAt');
            expressionAttributeNames['#updatedAt'] = 'updatedAt';
            expressionAttributeValues[':updatedAt'] = timestamp;

            const result = await this.docClient.send(new UpdateCommand({
                TableName: this.tableName,
                Key: { userId },
                UpdateExpression: `SET ${updateExpressions.join(', ')}`,
                ExpressionAttributeNames: expressionAttributeNames,
                ExpressionAttributeValues: expressionAttributeValues,
                ReturnValues: 'ALL_NEW',
                ConditionExpression: 'attribute_exists(userId)'
            }));

            this.logger.info('User profile updated successfully', {
                userId,
                updatedFields: Object.keys(updates)
            });

            return result.Attributes as UserProfile;
        } catch (error) {
            this.logger.error('Failed to update user profile', {
                userId,
                updates,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Creates or updates a user profile
     */
    async createOrUpdateUserProfile(profile: UserProfile): Promise<UserProfile> {
        const existingProfile = await this.getUserProfile(profile.userId);

        if (!existingProfile) {
            await this.createUserProfile(profile);
            return profile;
        }

        // Extract fields to update (excluding userId and createdAt)
        const { userId, createdAt, ...updates } = profile;
        return await this.updateUserProfile(userId, updates);
    }
}