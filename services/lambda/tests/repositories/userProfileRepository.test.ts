import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { UserProfileRepository } from '../../src/repositories/userProfileRepository';
import { UserProfile, createDefaultUserProfile } from '../../src/models/userProfile';
import { Logger } from '@aws-lambda-powertools/logger';

describe('UserProfileRepository', () => {
    const mockDocClient = mockClient(DynamoDBDocumentClient);
    const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
    } as unknown as Logger;

    const tableName = 'test-user-profile-table';
    const testUserId = 'test-user-123';

    let repository: UserProfileRepository;

    beforeEach(() => {
        mockDocClient.reset();
        vi.clearAllMocks();

        repository = new UserProfileRepository({
            docClient: mockDocClient as unknown as DynamoDBDocumentClient,
            tableName,
            logger: mockLogger,
        });
    });

    describe('getUserProfile', () => {
        it('should return user profile when it exists', async () => {
            // Arrange
            const expectedProfile: UserProfile = {
                userId: testUserId,
                setupPhase: 'TEST',
                notificationEnabled: true,
                createdAt: '2023-01-01T00:00:00Z',
                updatedAt: '2023-01-02T00:00:00Z',
                testResults: {
                    setup: {
                        success: true,
                        timestamp: '2023-01-01T12:00:00Z',
                    },
                },
            };

            mockDocClient.on(GetCommand).resolves({
                Item: expectedProfile,
            });

            // Act
            const result = await repository.getUserProfile(testUserId);

            // Assert
            expect(result).toEqual(expectedProfile);
            expect(mockDocClient.commandCalls(GetCommand)).toHaveLength(1);
            expect(mockDocClient.commandCalls(GetCommand)[0].args[0].input).toEqual({
                TableName: tableName,
                Key: { userId: testUserId },
            });
        });

        it('should return null when user profile does not exist', async () => {
            // Arrange
            mockDocClient.on(GetCommand).resolves({});

            // Act
            const result = await repository.getUserProfile(testUserId);

            // Assert
            expect(result).toBeNull();
        });

        it('should throw error when DynamoDB operation fails', async () => {
            // Arrange
            const error = new Error('DynamoDB error');
            mockDocClient.on(GetCommand).rejects(error);

            // Act & Assert
            await expect(repository.getUserProfile(testUserId)).rejects.toThrow('DynamoDB error');
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get user profile',
                expect.objectContaining({
                    userId: testUserId,
                    error: 'DynamoDB error',
                })
            );
        });
    });

    describe('createUserProfile', () => {
        it('should create user profile successfully', async () => {
            // Arrange
            const profile = createDefaultUserProfile(testUserId);
            mockDocClient.on(PutCommand).resolves({});

            // Act
            await repository.createUserProfile(profile);

            // Assert
            expect(mockDocClient.commandCalls(PutCommand)).toHaveLength(1);
            expect(mockDocClient.commandCalls(PutCommand)[0].args[0].input).toEqual({
                TableName: tableName,
                Item: profile,
                ConditionExpression: 'attribute_not_exists(userId)',
            });
        });

        it('should throw error when user already exists', async () => {
            // Arrange
            const profile = createDefaultUserProfile(testUserId);
            const error = new Error('ConditionalCheckFailedException');
            error.name = 'ConditionalCheckFailedException';
            mockDocClient.on(PutCommand).rejects(error);

            // Act & Assert
            await expect(repository.createUserProfile(profile)).rejects.toThrow('User profile already exists');
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to create user profile',
                expect.objectContaining({
                    userId: testUserId,
                    error: 'User profile already exists',
                })
            );
        });
    });

    describe('updateUserProfile', () => {
        it('should update user profile successfully', async () => {
            // Arrange
            const updates = {
                setupPhase: 'PRODUCTION' as const,
                notificationEnabled: false,
            };
            const updatedProfile: UserProfile = {
                userId: testUserId,
                setupPhase: 'PRODUCTION',
                notificationEnabled: false,
                createdAt: '2023-01-01T00:00:00Z',
                updatedAt: new Date().toISOString(),
            };

            mockDocClient.on(UpdateCommand).resolves({
                Attributes: updatedProfile,
            });

            // Act
            const result = await repository.updateUserProfile(testUserId, updates);

            // Assert
            expect(result).toEqual(updatedProfile);
            expect(mockDocClient.commandCalls(UpdateCommand)).toHaveLength(1);

            const command = mockDocClient.commandCalls(UpdateCommand)[0].args[0].input;
            expect(command.TableName).toBe(tableName);
            expect(command.Key).toEqual({ userId: testUserId });
            expect(command.UpdateExpression).toContain('setupPhase');
            expect(command.UpdateExpression).toContain('notificationEnabled');
            expect(command.UpdateExpression).toContain('updatedAt');
        });

        it('should update only specified fields', async () => {
            // Arrange
            const updates = {
                notificationEnabled: false,
            };

            mockDocClient.on(UpdateCommand).resolves({
                Attributes: {} as UserProfile,
            });

            // Act
            await repository.updateUserProfile(testUserId, updates);

            // Assert
            const command = mockDocClient.commandCalls(UpdateCommand)[0].args[0].input;
            expect(command.UpdateExpression).toContain('notificationEnabled');
            expect(command.UpdateExpression).toContain('updatedAt');
            expect(command.UpdateExpression).not.toContain('setupPhase');
        });

        it('should throw error when update fails', async () => {
            // Arrange
            const updates = { setupPhase: 'TEST' as const };
            const error = new Error('DynamoDB error');
            mockDocClient.on(UpdateCommand).rejects(error);

            // Act & Assert
            await expect(repository.updateUserProfile(testUserId, updates)).rejects.toThrow('DynamoDB error');
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to update user profile',
                expect.objectContaining({
                    userId: testUserId,
                    updates,
                    error: 'DynamoDB error',
                })
            );
        });
    });

    describe('createOrUpdateUserProfile', () => {
        it('should create profile when it does not exist', async () => {
            // Arrange
            const profile = createDefaultUserProfile(testUserId);
            mockDocClient.on(GetCommand).resolves({});
            mockDocClient.on(PutCommand).resolves({});

            // Act
            const result = await repository.createOrUpdateUserProfile(profile);

            // Assert
            expect(result).toEqual(profile);
            expect(mockDocClient.commandCalls(GetCommand)).toHaveLength(1);
            expect(mockDocClient.commandCalls(PutCommand)).toHaveLength(1);
        });

        it('should update profile when it exists', async () => {
            // Arrange
            const existingProfile: UserProfile = {
                userId: testUserId,
                setupPhase: 'SETUP',
                notificationEnabled: true,
                createdAt: '2023-01-01T00:00:00Z',
                updatedAt: '2023-01-01T00:00:00Z',
            };

            const newProfile: UserProfile = {
                ...existingProfile,
                setupPhase: 'TEST',
                updatedAt: new Date().toISOString(),
            };

            mockDocClient.on(GetCommand).resolves({ Item: existingProfile });
            mockDocClient.on(UpdateCommand).resolves({ Attributes: newProfile });

            // Act
            const result = await repository.createOrUpdateUserProfile(newProfile);

            // Assert
            expect(result).toEqual(newProfile);
            expect(mockDocClient.commandCalls(GetCommand)).toHaveLength(1);
            expect(mockDocClient.commandCalls(UpdateCommand)).toHaveLength(1);
            expect(mockDocClient.commandCalls(PutCommand)).toHaveLength(0);
        });
    });
});