import { describe, it, expect } from 'vitest';
import { IntegrationTestValidator } from '../../src/services/integrationTestValidator';
import { EAApplication } from '../../src/models/eaApplication';
import { IntegrationTestProgress } from '../../src/services/integrationTestProgressService';

describe('IntegrationTestValidator', () => {
    describe('isIntegrationTestApplication', () => {
        it('should identify application with integrationTestId', () => {
            // Arrange
            const application: EAApplication = {
                userId: 'test-user',
                sk: 'APPLICATION#123',
                eaName: 'Test EA',
                accountNumber: '123456',
                broker: 'Test Broker',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                integrationTestId: 'TEST_123'
            };

            // Act & Assert
            expect(IntegrationTestValidator.isIntegrationTestApplication(application)).toBe(true);
        });

        it('should identify application with specific accountNumber', () => {
            // Arrange
            const application: EAApplication = {
                userId: 'test-user',
                sk: 'APPLICATION#123',
                eaName: 'Some EA',
                accountNumber: 'INTEGRATION_TEST_123456',
                broker: 'Some Broker',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            // Act & Assert
            expect(IntegrationTestValidator.isIntegrationTestApplication(application)).toBe(true);
        });

        it('should identify application with Test Broker', () => {
            // Arrange
            const application: EAApplication = {
                userId: 'test-user',
                sk: 'APPLICATION#123',
                eaName: 'Some EA',
                accountNumber: '999999',
                broker: 'Test Broker',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            // Act & Assert
            expect(IntegrationTestValidator.isIntegrationTestApplication(application)).toBe(true);
        });

        it('should identify application with Integration Test EA name', () => {
            // Arrange
            const application: EAApplication = {
                userId: 'test-user',
                sk: 'APPLICATION#123',
                eaName: 'Integration Test EA',
                accountNumber: '777777',
                broker: 'Regular Broker',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            // Act & Assert
            expect(IntegrationTestValidator.isIntegrationTestApplication(application)).toBe(true);
        });

        it('should not identify regular application', () => {
            // Arrange
            const application: EAApplication = {
                userId: 'test-user',
                sk: 'APPLICATION#123',
                eaName: 'Regular EA',
                accountNumber: '555555',
                broker: 'Regular Broker',
                email: 'test@example.com',
                xAccount: '@test',
                status: 'Pending',
                appliedAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z'
            };

            // Act & Assert
            expect(IntegrationTestValidator.isIntegrationTestApplication(application)).toBe(false);
        });
    });

    describe('isLikelyIntegrationTestBySK', () => {
        it('should identify likely integration test by SK pattern', () => {
            expect(IntegrationTestValidator.isLikelyIntegrationTestBySK(
                'APPLICATION#2025#Test Broker#123456#Test EA'
            )).toBe(true);

            expect(IntegrationTestValidator.isLikelyIntegrationTestBySK(
                'APPLICATION#2025#Broker#INTEGRATION_TEST_123456#EA'
            )).toBe(true);

            expect(IntegrationTestValidator.isLikelyIntegrationTestBySK(
                'APPLICATION#2025#Broker#123456#Integration Test EA'
            )).toBe(true);
        });

        it('should not identify regular SK', () => {
            expect(IntegrationTestValidator.isLikelyIntegrationTestBySK(
                'APPLICATION#2025#Regular Broker#123456#Regular EA'
            )).toBe(false);
        });

        it('should handle invalid SK format', () => {
            expect(IntegrationTestValidator.isLikelyIntegrationTestBySK('INVALID_SK')).toBe(false);
            expect(IntegrationTestValidator.isLikelyIntegrationTestBySK('NOT#ENOUGH#PARTS')).toBe(false);
        });
    });

    describe('validateIntegrationTestState', () => {
        it('should validate correct state with progress and gasWebappUrl', () => {
            // Arrange
            const integrationTestData = {
                gasWebappUrl: 'https://test.gas.url',
                progress: {
                    testId: 'TEST_123',
                    currentStep: 'GAS_WEBHOOK_RECEIVED',
                    startedAt: '2025-01-01T00:00:00Z',
                    steps: {
                        STARTED: { timestamp: '2025-01-01T00:00:00Z', success: true }
                    }
                }
            };

            // Act
            const result = IntegrationTestValidator.validateIntegrationTestState(integrationTestData);

            // Assert
            expect(result.isValid).toBe(true);
            expect(result.issues).toHaveLength(0);
            expect(result.currentState?.hasProgress).toBe(true);
            expect(result.currentState?.testId).toBe('TEST_123');
            expect(result.currentState?.gasWebappUrl).toBe('https://test.gas.url');
        });

        it('should detect gasWebappUrl without progress', () => {
            // Arrange
            const integrationTestData = {
                gasWebappUrl: 'https://test.gas.url'
                // progress is missing
            };

            // Act
            const result = IntegrationTestValidator.validateIntegrationTestState(integrationTestData);

            // Assert
            expect(result.isValid).toBe(false);
            expect(result.issues).toContain('gasWebappUrl exists but no progress data found');
        });

        it('should detect STARTED step without gasWebappUrl', () => {
            // Arrange
            const integrationTestData = {
                progress: {
                    testId: 'TEST_123',
                    currentStep: 'STARTED',
                    startedAt: '2025-01-01T00:00:00Z',
                    steps: {
                        STARTED: { timestamp: '2025-01-01T00:00:00Z', success: true }
                    }
                }
                // gasWebappUrl is missing
            };

            // Act
            const result = IntegrationTestValidator.validateIntegrationTestState(integrationTestData);

            // Assert
            expect(result.isValid).toBe(false);
            expect(result.issues).toContain('STARTED step exists but gasWebappUrl is missing');
        });

        it('should handle null/undefined data', () => {
            // Act
            const result = IntegrationTestValidator.validateIntegrationTestState(null);

            // Assert
            expect(result.isValid).toBe(true);
            expect(result.currentState?.hasProgress).toBe(false);
            expect(result.issues).toHaveLength(0);
        });
    });

    describe('validateTestId', () => {
        it('should validate correct testId format', () => {
            expect(IntegrationTestValidator.validateTestId('INTEGRATION_1234567890_abc123')).toBe(true);
            expect(IntegrationTestValidator.validateTestId('INTEGRATION_9999999999_xyz789')).toBe(true);
        });

        it('should reject invalid testId format', () => {
            expect(IntegrationTestValidator.validateTestId('INVALID_FORMAT')).toBe(false);
            expect(IntegrationTestValidator.validateTestId('INTEGRATION_abc_123')).toBe(false);
            expect(IntegrationTestValidator.validateTestId('TEST_1234567890_abc123')).toBe(false);
            expect(IntegrationTestValidator.validateTestId('')).toBe(false);
        });
    });

    describe('canTransitionToStep', () => {
        it('should allow valid step transitions', () => {
            expect(IntegrationTestValidator.canTransitionToStep(undefined, 'STARTED')).toBe(true);
            expect(IntegrationTestValidator.canTransitionToStep('STARTED', 'GAS_WEBHOOK_RECEIVED')).toBe(true);
            expect(IntegrationTestValidator.canTransitionToStep('GAS_WEBHOOK_RECEIVED', 'LICENSE_ISSUED')).toBe(true);
            expect(IntegrationTestValidator.canTransitionToStep('LICENSE_ISSUED', 'COMPLETED')).toBe(true);
        });

        it('should allow re-recording the same step', () => {
            expect(IntegrationTestValidator.canTransitionToStep('STARTED', 'STARTED')).toBe(true);
            expect(IntegrationTestValidator.canTransitionToStep('COMPLETED', 'COMPLETED')).toBe(true);
        });

        it('should reject invalid transitions', () => {
            expect(IntegrationTestValidator.canTransitionToStep('STARTED', 'LICENSE_ISSUED')).toBe(false);
            expect(IntegrationTestValidator.canTransitionToStep('COMPLETED', 'STARTED')).toBe(false);
            expect(IntegrationTestValidator.canTransitionToStep('LICENSE_ISSUED', 'GAS_WEBHOOK_RECEIVED')).toBe(false);
        });

        it('should reject transitions from invalid step', () => {
            expect(IntegrationTestValidator.canTransitionToStep('INVALID', 'STARTED')).toBe(false);
        });

        it('should require STARTED as first step', () => {
            expect(IntegrationTestValidator.canTransitionToStep(undefined, 'GAS_WEBHOOK_RECEIVED')).toBe(false);
            expect(IntegrationTestValidator.canTransitionToStep(undefined, 'LICENSE_ISSUED')).toBe(false);
            expect(IntegrationTestValidator.canTransitionToStep(undefined, 'COMPLETED')).toBe(false);
        });
    });

    describe('isFatalError', () => {
        it('should identify fatal errors for critical steps', () => {
            // GAS_WEBHOOK_RECEIVED failures are fatal
            expect(IntegrationTestValidator.isFatalError(
                'GAS_WEBHOOK_RECEIVED',
                new Error('Any error')
            )).toBe(true);

            // STARTED failures are fatal
            expect(IntegrationTestValidator.isFatalError(
                'STARTED',
                new Error('Any error')
            )).toBe(true);
        });

        it('should identify non-fatal errors for non-critical steps', () => {
            expect(IntegrationTestValidator.isFatalError(
                'LICENSE_ISSUED',
                new Error('Some error')
            )).toBe(false);

            expect(IntegrationTestValidator.isFatalError(
                'COMPLETED',
                new Error('Some error')
            )).toBe(false);
        });

        it('should identify fatal error patterns', () => {
            expect(IntegrationTestValidator.isFatalError(
                'LICENSE_ISSUED',
                new Error('ValidationException: Invalid input')
            )).toBe(true);

            expect(IntegrationTestValidator.isFatalError(
                'COMPLETED',
                new Error('ResourceNotFoundException: Table not found')
            )).toBe(true);

            expect(IntegrationTestValidator.isFatalError(
                'LICENSE_ISSUED',
                new Error('AccessDeniedException: Not authorized')
            )).toBe(true);
        });
    });

    describe('shouldCleanupProgress', () => {
        it('should cleanup completed progress with matching testId', () => {
            // Arrange
            const progress: IntegrationTestProgress = {
                testId: 'TEST_123',
                currentStep: 'COMPLETED',
                steps: {
                    STARTED: { timestamp: '2025-01-01T00:00:00Z', success: true },
                    GAS_WEBHOOK_RECEIVED: { timestamp: '2025-01-01T00:01:00Z', success: true },
                    LICENSE_ISSUED: { timestamp: '2025-01-01T00:02:00Z', success: true },
                    COMPLETED: { timestamp: '2025-01-01T00:03:00Z', success: true }
                },
                startedAt: '2025-01-01T00:00:00Z',
                completedAt: '2025-01-01T00:03:00Z'
            };

            // Act & Assert
            expect(IntegrationTestValidator.shouldCleanupProgress(progress, 'TEST_123')).toBe(true);
        });

        it('should not cleanup non-matching testId', () => {
            // Arrange
            const progress: IntegrationTestProgress = {
                testId: 'TEST_123',
                currentStep: 'COMPLETED',
                steps: {},
                startedAt: '2025-01-01T00:00:00Z'
            };

            // Act & Assert
            expect(IntegrationTestValidator.shouldCleanupProgress(progress, 'TEST_456')).toBe(false);
        });

        it('should not cleanup incomplete progress', () => {
            // Arrange
            const progress: IntegrationTestProgress = {
                testId: 'TEST_123',
                currentStep: 'LICENSE_ISSUED',
                steps: {},
                startedAt: '2025-01-01T00:00:00Z'
            };

            // Act & Assert
            expect(IntegrationTestValidator.shouldCleanupProgress(progress, 'TEST_123')).toBe(false);
        });

        it('should handle undefined progress', () => {
            // Act & Assert
            expect(IntegrationTestValidator.shouldCleanupProgress(undefined, 'TEST_123')).toBe(false);
        });
    });
});