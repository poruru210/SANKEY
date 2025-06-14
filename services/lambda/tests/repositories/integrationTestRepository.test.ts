import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { IntegrationTestRepository } from '../../src/repositories/integrationTestRepository';
import {
    UserProfile,
    IntegrationTest,
    createDefaultUserProfile,
    createIntegrationTest
} from '../../src/models/userProfile';
import type { IntegrationTestRepositoryDependencies } from '../../src/di/dependencies';

// Mock DynamoDB
const dynamoMock = mockClient(DynamoDBDocumentClient);

describe('IntegrationTestRepository', () => {
    let repository: IntegrationTestRepository;
    let mockDocClient: any;
    let mockLogger: any;
    const tableName = 'test-user-profile-table';
    const userId = 'test-user-123';

    beforeEach(() => {
        vi.clearAllMocks();
        dynamoMock.reset();

        // Create mock document client
        mockDocClient = {
            send: vi.fn()
        };

        // Create mock logger
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn()
        };

        // Create dependencies object
        const dependencies: IntegrationTestRepositoryDependencies = {
            docClient: mockDocClient,
            tableName: tableName,
            logger: mockLogger
        };

        // Create repository with dependencies
        repository = new IntegrationTestRepository(dependencies);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('getUserProfile', () => {
        it('should successfully retrieve user profile', async () => {
            // Arrange
            const mockUserProfile: UserProfile = {
                userId,
                setupPhase: 'TEST',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                testResults: {
                    integration: {
                        testId: 'INTEGRATION_123',
                        gasWebappUrl: 'https://example.com',
                        currentStep: 'STARTED',
                        currentStepStatus: 'success',
                        lastUpdated: '2025-01-01T00:00:00Z'
                    }
                }
            };

            mockDocClient.send.mockResolvedValueOnce({
                Item: mockUserProfile
            });

            // Act
            const result = await repository.getUserProfile(userId);

            // Assert
            expect(result).toEqual(mockUserProfile);
            expect(mockDocClient.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    input: {
                        TableName: tableName,
                        Key: { userId }
                    }
                })
            );
        });

        it('should return null when user profile not found', async () => {
            // Arrange
            mockDocClient.send.mockResolvedValueOnce({
                Item: undefined
            });

            // Act
            const result = await repository.getUserProfile(userId);

            // Assert
            expect(result).toBeNull();
        });

        it('should handle DynamoDB errors', async () => {
            // Arrange
            mockDocClient.send.mockRejectedValueOnce(
                new Error('DynamoDB error')
            );

            // Act & Assert
            await expect(repository.getUserProfile(userId)).rejects.toThrow('DynamoDB error');
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to get user profile:',
                expect.objectContaining({
                    userId,
                    error: 'DynamoDB error'
                })
            );
        });
    });

    describe('initializeIntegrationTest', () => {
        it('should successfully initialize integration test when testResults exists', async () => {
            // Arrange
            const integrationTest = createIntegrationTest(
                'INTEGRATION_123',
                'https://example.com'
            );

            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    userId,
                    testResults: {
                        integration: integrationTest
                    }
                }
            });

            // Act
            await repository.initializeIntegrationTest(userId, integrationTest);

            // Assert
            expect(mockDocClient.send).toHaveBeenCalledWith(
                expect.any(Object)
            );

            const callArg = mockDocClient.send.mock.calls[0][0];
            expect(callArg.input).toMatchObject({
                TableName: tableName,
                Key: { userId },
                UpdateExpression: expect.stringMatching(/testResults\.integration = :integration.*updatedAt = :updatedAt/s),
                ExpressionAttributeValues: expect.objectContaining({
                    ':integration': integrationTest,
                    ':updatedAt': expect.any(String)
                })
            });
        });

        it('should create testResults if it does not exist', async () => {
            // Arrange
            const integrationTest = createIntegrationTest(
                'INTEGRATION_123',
                'https://example.com'
            );

            const conditionalError = new Error('ConditionalCheckFailedException');
            (conditionalError as any).name = 'ConditionalCheckFailedException';

            // First call fails due to missing testResults
            mockDocClient.send.mockRejectedValueOnce(conditionalError);
            // Second call succeeds
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    userId,
                    testResults: {
                        integration: integrationTest
                    }
                }
            });

            // Act
            await repository.initializeIntegrationTest(userId, integrationTest);

            // Assert
            expect(mockDocClient.send).toHaveBeenCalledTimes(2);

            // Second call should create testResults
            const secondCall = mockDocClient.send.mock.calls[1][0];
            expect(secondCall.input).toMatchObject({
                TableName: tableName,
                Key: { userId },
                UpdateExpression: expect.stringMatching(/testResults = :testResults.*updatedAt = :updatedAt/s),
                ExpressionAttributeValues: expect.objectContaining({
                    ':testResults': {
                        integration: integrationTest
                    },
                    ':updatedAt': expect.any(String)
                })
            });
        });

        it('should handle update errors', async () => {
            // Arrange
            const integrationTest = createIntegrationTest(
                'INTEGRATION_123',
                'https://example.com'
            );

            mockDocClient.send.mockRejectedValueOnce(
                new Error('Update failed')
            );

            // Act & Assert
            await expect(
                repository.initializeIntegrationTest(userId, integrationTest)
            ).rejects.toThrow('Update failed');
        });
    });

    describe('updateIntegrationTest', () => {
        it('should successfully update integration test', async () => {
            // Arrange
            const updatedTest: IntegrationTest = {
                testId: 'INTEGRATION_123',
                gasWebappUrl: 'https://example.com',
                currentStep: 'GAS_WEBHOOK_RECEIVED',
                currentStepStatus: 'success',
                lastUpdated: '2025-01-01T00:01:00Z',
                completedSteps: {
                    STARTED: '2025-01-01T00:00:00Z',
                    GAS_WEBHOOK_RECEIVED: '2025-01-01T00:01:00Z'
                }
            };

            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    userId,
                    testResults: {
                        integration: updatedTest
                    }
                }
            });

            // Act
            await repository.updateIntegrationTest(userId, updatedTest);

            // Assert
            expect(mockDocClient.send).toHaveBeenCalledWith(
                expect.any(Object)
            );

            const callArg = mockDocClient.send.mock.calls[0][0];
            expect(callArg.input).toMatchObject({
                TableName: tableName,
                Key: { userId },
                UpdateExpression: expect.stringMatching(/testResults\.integration = :integration.*updatedAt = :updatedAt/s),
                ExpressionAttributeValues: expect.objectContaining({
                    ':integration': updatedTest,
                    ':updatedAt': expect.any(String)
                })
            });
        });
    });

    describe('clearIntegrationTest', () => {
        it('should successfully clear integration test', async () => {
            // Arrange
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    userId,
                    testResults: {}
                }
            });

            // Act
            await repository.clearIntegrationTest(userId);

            // Assert
            expect(mockDocClient.send).toHaveBeenCalledWith(
                expect.any(Object)
            );

            const callArg = mockDocClient.send.mock.calls[0][0];
            expect(callArg.input).toMatchObject({
                TableName: tableName,
                Key: { userId },
                UpdateExpression: expect.stringMatching(/REMOVE testResults\.integration.*SET updatedAt = :updatedAt/s),
                ExpressionAttributeValues: expect.objectContaining({
                    ':updatedAt': expect.any(String)
                })
            });
        });

        it('should handle clear errors', async () => {
            // Arrange
            mockDocClient.send.mockRejectedValueOnce(
                new Error('Clear failed')
            );

            // Act & Assert
            await expect(
                repository.clearIntegrationTest(userId)
            ).rejects.toThrow('Clear failed');
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to clear integration test:',
                expect.objectContaining({
                    userId,
                    error: 'Clear failed'
                })
            );
        });
    });

    describe('updateSetupTest', () => {
        it('should successfully update setup test when testResults exists', async () => {
            // Arrange
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    userId,
                    testResults: {
                        setup: {
                            success: true,
                            timestamp: expect.any(String),
                            details: 'Test completed'
                        }
                    }
                }
            });

            // Act
            await repository.updateSetupTest(userId, true, 'Test completed');

            // Assert
            expect(mockDocClient.send).toHaveBeenCalledWith(
                expect.any(Object)
            );

            const callArg = mockDocClient.send.mock.calls[0][0];
            expect(callArg.input).toMatchObject({
                TableName: tableName,
                Key: { userId },
                UpdateExpression: expect.stringMatching(/testResults\.setup = :setup.*updatedAt = :updatedAt/s),
                ExpressionAttributeValues: expect.objectContaining({
                    ':setup': {
                        success: true,
                        timestamp: expect.any(String),
                        details: 'Test completed'
                    },
                    ':updatedAt': expect.any(String)
                })
            });
        });

        it('should create testResults if it does not exist', async () => {
            // Arrange
            const conditionalError = new Error('ConditionalCheckFailedException');
            (conditionalError as any).name = 'ConditionalCheckFailedException';

            // First call fails due to missing testResults
            mockDocClient.send.mockRejectedValueOnce(conditionalError);
            // Second call succeeds
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    userId,
                    testResults: {
                        setup: {
                            success: false,
                            timestamp: expect.any(String),
                            details: 'Test failed'
                        }
                    }
                }
            });

            // Act
            await repository.updateSetupTest(userId, false, 'Test failed');

            // Assert
            expect(mockDocClient.send).toHaveBeenCalledTimes(2);
        });
    });

    describe('updateSetupPhase', () => {
        it('should successfully update setup phase', async () => {
            // Arrange
            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    userId,
                    setupPhase: 'PRODUCTION'
                }
            });

            // Act
            await repository.updateSetupPhase(userId, 'PRODUCTION');

            // Assert
            expect(mockDocClient.send).toHaveBeenCalledWith(
                expect.any(Object)
            );

            const callArg = mockDocClient.send.mock.calls[0][0];
            expect(callArg.input).toMatchObject({
                TableName: tableName,
                Key: { userId },
                UpdateExpression: expect.stringMatching(/setupPhase = :phase.*updatedAt = :updatedAt/s),
                ExpressionAttributeValues: expect.objectContaining({
                    ':phase': 'PRODUCTION',
                    ':updatedAt': expect.any(String)
                })
            });
        });

        it('should handle phase update errors', async () => {
            // Arrange
            mockDocClient.send.mockRejectedValueOnce(
                new Error('Phase update failed')
            );

            // Act & Assert
            await expect(
                repository.updateSetupPhase(userId, 'TEST')
            ).rejects.toThrow('Phase update failed');
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to update setup phase:',
                expect.objectContaining({
                    userId,
                    phase: 'TEST',
                    error: 'Phase update failed'
                })
            );
        });
    });

    describe('Complex Scenarios', () => {
        it('should handle user profile without testResults', async () => {
            // Arrange
            const userProfileWithoutTests: UserProfile = {
                userId,
                setupPhase: 'SETUP',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            mockDocClient.send.mockResolvedValueOnce({
                Item: userProfileWithoutTests
            });

            // Act
            const result = await repository.getUserProfile(userId);

            // Assert
            expect(result).toEqual(userProfileWithoutTests);
            expect(result?.testResults).toBeUndefined();
        });

        it('should handle user profile with testResults but no integration', async () => {
            // Arrange
            const userProfileWithEmptyTests: UserProfile = {
                userId,
                setupPhase: 'TEST',
                notificationEnabled: true,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                testResults: {
                    setup: {
                        success: true,
                        timestamp: '2025-01-01T00:00:00Z'
                    }
                }
            };

            mockDocClient.send.mockResolvedValueOnce({
                Item: userProfileWithEmptyTests
            });

            // Act
            const result = await repository.getUserProfile(userId);

            // Assert
            expect(result).toEqual(userProfileWithEmptyTests);
            expect(result?.testResults?.integration).toBeUndefined();
        });

        it('should update integration test with all optional fields', async () => {
            // Arrange
            const complexTest: IntegrationTest = {
                testId: 'INTEGRATION_123',
                gasWebappUrl: 'https://example.com',
                applicationSK: 'APPLICATION#2025-01-01T00:00:00Z',
                licenseId: 'LICENSE_123',
                currentStep: 'LICENSE_ISSUED',
                currentStepStatus: 'success',
                lastUpdated: '2025-01-01T00:02:00Z',
                completedSteps: {
                    STARTED: '2025-01-01T00:00:00Z',
                    GAS_WEBHOOK_RECEIVED: '2025-01-01T00:01:00Z',
                    LICENSE_ISSUED: '2025-01-01T00:02:00Z'
                },
                lastError: {
                    step: 'GAS_WEBHOOK_RECEIVED',
                    timestamp: '2025-01-01T00:00:30Z',
                    message: 'Retry succeeded'
                }
            };

            mockDocClient.send.mockResolvedValueOnce({
                Attributes: {
                    userId,
                    testResults: {
                        integration: complexTest
                    }
                }
            });

            // Act
            await repository.updateIntegrationTest(userId, complexTest);

            // Assert
            expect(mockDocClient.send).toHaveBeenCalledWith(
                expect.any(Object)
            );

            const callArg = mockDocClient.send.mock.calls[0][0];
            expect(callArg.input).toMatchObject({
                TableName: tableName,
                Key: { userId },
                UpdateExpression: expect.stringMatching(/testResults\.integration = :integration.*updatedAt = :updatedAt/s),
                ExpressionAttributeValues: expect.objectContaining({
                    ':integration': complexTest,
                    ':updatedAt': expect.any(String)
                })
            });
        });
    });

    describe('Error Handling', () => {
        it('should handle DynamoDB service unavailable', async () => {
            // Arrange
            const serviceError = new Error('Service Unavailable');
            (serviceError as any).name = 'ServiceUnavailable';

            mockDocClient.send.mockRejectedValueOnce(serviceError);

            

            // Act & Assert
            await expect(repository.getUserProfile(userId)).rejects.toThrow('Service Unavailable');
        });

        it('should handle DynamoDB throttling', async () => {
            // Arrange
            const throttleError = new Error('Throughput exceeded');
            (throttleError as any).name = 'ProvisionedThroughputExceededException';

            mockDocClient.send.mockRejectedValueOnce(throttleError);

            // Act & Assert
            await expect(repository.getUserProfile(userId)).rejects.toThrow('Throughput exceeded');
        });
    });
});

