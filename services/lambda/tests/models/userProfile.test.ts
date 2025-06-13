import { describe, it, expect } from 'vitest';
import {
    UserProfile,
    IntegrationTest,
    IntegrationTestStep,
    SetupPhase,
    createDefaultUserProfile,
    createIntegrationTest,
    recordStepProgress,
    isValidSetupPhase,
    canProgressToPhase,
    getNextStep,
    isIntegrationTestCompleted,
    getIntegrationTestProgress,
    isStepCompleted,
    getTestDuration,
    isValidIntegrationTestStep,
    isValidStepStatus
} from '../../src/models/userProfile';

describe('UserProfile Model', () => {
    describe('createDefaultUserProfile', () => {
        it('should create a default user profile with correct values', () => {
            // Arrange
            const userId = 'test-user-123';

            // Act
            const profile = createDefaultUserProfile(userId);

            // Assert
            expect(profile.userId).toBe(userId);
            expect(profile.setupPhase).toBe('SETUP');
            expect(profile.notificationEnabled).toBe(true);
            expect(profile.createdAt).toBeDefined();
            expect(profile.updatedAt).toBeDefined();
            expect(profile.createdAt).toBe(profile.updatedAt);
        });
    });

    describe('createIntegrationTest', () => {
        it('should create a new integration test instance', () => {
            // Arrange
            const testId = 'INTEGRATION_1234567890_abc123';
            const gasWebappUrl = 'https://script.google.com/macros/s/test-id/exec';

            // Act
            const test = createIntegrationTest(testId, gasWebappUrl);

            // Assert
            expect(test.testId).toBe(testId);
            expect(test.gasWebappUrl).toBe(gasWebappUrl);
            expect(test.currentStep).toBe('STARTED');
            expect(test.currentStepStatus).toBe('pending');
            expect(test.lastUpdated).toBeDefined();
            expect(test.completedSteps).toBeUndefined();
            expect(test.lastError).toBeUndefined();
        });
    });

    describe('recordStepProgress', () => {
        it('should record successful step progress', () => {
            // Arrange
            const integration: IntegrationTest = {
                testId: 'TEST_123',
                gasWebappUrl: 'https://example.com',
                currentStep: 'STARTED',
                currentStepStatus: 'pending',
                lastUpdated: '2025-01-01T00:00:00Z'
            };

            // Act
            const updated = recordStepProgress(integration, 'STARTED', true);

            // Assert
            expect(updated.currentStep).toBe('STARTED');
            expect(updated.currentStepStatus).toBe('success');
            expect(updated.completedSteps?.STARTED).toBeDefined();
            expect(updated.lastError).toBeUndefined();
        });

        it('should record failed step progress with error', () => {
            // Arrange
            const integration: IntegrationTest = {
                testId: 'TEST_123',
                gasWebappUrl: 'https://example.com',
                currentStep: 'GAS_WEBHOOK_RECEIVED',
                currentStepStatus: 'pending',
                lastUpdated: '2025-01-01T00:00:00Z'
            };

            // Act
            const updated = recordStepProgress(integration, 'GAS_WEBHOOK_RECEIVED', false, {
                error: 'Webhook validation failed'
            });

            // Assert
            expect(updated.currentStep).toBe('GAS_WEBHOOK_RECEIVED');
            expect(updated.currentStepStatus).toBe('failed');
            expect(updated.lastError).toEqual({
                step: 'GAS_WEBHOOK_RECEIVED',
                timestamp: expect.any(String),
                message: 'Webhook validation failed'
            });
            expect(updated.completedSteps?.GAS_WEBHOOK_RECEIVED).toBeUndefined();
        });

        it('should preserve completed steps when recording new progress', () => {
            // Arrange
            const integration: IntegrationTest = {
                testId: 'TEST_123',
                gasWebappUrl: 'https://example.com',
                currentStep: 'GAS_WEBHOOK_RECEIVED',
                currentStepStatus: 'success',
                lastUpdated: '2025-01-01T00:00:00Z',
                completedSteps: {
                    STARTED: '2025-01-01T00:00:00Z'
                }
            };

            // Act
            const updated = recordStepProgress(integration, 'LICENSE_ISSUED', true, {
                licenseId: 'LICENSE_123'
            });

            // Assert
            expect(updated.completedSteps).toEqual({
                STARTED: '2025-01-01T00:00:00Z',
                LICENSE_ISSUED: expect.any(String)
            });
            expect(updated.licenseId).toBe('LICENSE_123');
        });

        it('should update applicationSK when provided', () => {
            // Arrange
            const integration: IntegrationTest = {
                testId: 'TEST_123',
                gasWebappUrl: 'https://example.com',
                currentStep: 'GAS_WEBHOOK_RECEIVED',
                currentStepStatus: 'pending',
                lastUpdated: '2025-01-01T00:00:00Z'
            };

            // Act
            const updated = recordStepProgress(integration, 'GAS_WEBHOOK_RECEIVED', true, {
                applicationSK: 'APPLICATION#2025-01-01T00:00:00Z'
            });

            // Assert
            expect(updated.applicationSK).toBe('APPLICATION#2025-01-01T00:00:00Z');
        });
    });

    describe('Setup Phase Validation', () => {
        describe('isValidSetupPhase', () => {
            it('should validate correct setup phases', () => {
                expect(isValidSetupPhase('SETUP')).toBe(true);
                expect(isValidSetupPhase('TEST')).toBe(true);
                expect(isValidSetupPhase('PRODUCTION')).toBe(true);
            });

            it('should reject invalid setup phases', () => {
                expect(isValidSetupPhase('INVALID')).toBe(false);
                expect(isValidSetupPhase('')).toBe(false);
                expect(isValidSetupPhase('setup')).toBe(false);
            });
        });

        describe('canProgressToPhase', () => {
            it('should allow valid phase progressions', () => {
                expect(canProgressToPhase('SETUP', 'TEST')).toBe(true);
                expect(canProgressToPhase('TEST', 'PRODUCTION')).toBe(true);
            });

            it('should reject invalid phase progressions', () => {
                expect(canProgressToPhase('SETUP', 'PRODUCTION')).toBe(false);
                expect(canProgressToPhase('TEST', 'SETUP')).toBe(false);
                expect(canProgressToPhase('PRODUCTION', 'TEST')).toBe(false);
                expect(canProgressToPhase('PRODUCTION', 'PRODUCTION')).toBe(false);
            });
        });
    });

    describe('Integration Test Step Management', () => {
        describe('getNextStep', () => {
            it('should return the next step in sequence', () => {
                expect(getNextStep('STARTED')).toBe('GAS_WEBHOOK_RECEIVED');
                expect(getNextStep('GAS_WEBHOOK_RECEIVED')).toBe('LICENSE_ISSUED');
                expect(getNextStep('LICENSE_ISSUED')).toBe('COMPLETED');
            });

            it('should return null for the last step', () => {
                expect(getNextStep('COMPLETED')).toBe(null);
            });

            it('should return null for invalid steps', () => {
                expect(getNextStep('INVALID' as IntegrationTestStep)).toBe(null);
            });
        });

        describe('isValidIntegrationTestStep', () => {
            it('should validate correct steps', () => {
                expect(isValidIntegrationTestStep('STARTED')).toBe(true);
                expect(isValidIntegrationTestStep('GAS_WEBHOOK_RECEIVED')).toBe(true);
                expect(isValidIntegrationTestStep('LICENSE_ISSUED')).toBe(true);
                expect(isValidIntegrationTestStep('COMPLETED')).toBe(true);
            });

            it('should reject invalid steps', () => {
                expect(isValidIntegrationTestStep('INVALID')).toBe(false);
                expect(isValidIntegrationTestStep('')).toBe(false);
            });
        });

        describe('isValidStepStatus', () => {
            it('should validate correct statuses', () => {
                expect(isValidStepStatus('success')).toBe(true);
                expect(isValidStepStatus('failed')).toBe(true);
                expect(isValidStepStatus('pending')).toBe(true);
            });

            it('should reject invalid statuses', () => {
                expect(isValidStepStatus('INVALID')).toBe(false);
                expect(isValidStepStatus('')).toBe(false);
            });
        });
    });

    describe('Integration Test Progress Tracking', () => {
        describe('isIntegrationTestCompleted', () => {
            it('should return true for completed test', () => {
                const integration: IntegrationTest = {
                    testId: 'TEST_123',
                    gasWebappUrl: 'https://example.com',
                    currentStep: 'COMPLETED',
                    currentStepStatus: 'success',
                    lastUpdated: '2025-01-01T00:00:00Z'
                };

                expect(isIntegrationTestCompleted(integration)).toBe(true);
            });

            it('should return false for incomplete test', () => {
                const integration: IntegrationTest = {
                    testId: 'TEST_123',
                    gasWebappUrl: 'https://example.com',
                    currentStep: 'LICENSE_ISSUED',
                    currentStepStatus: 'success',
                    lastUpdated: '2025-01-01T00:00:00Z'
                };

                expect(isIntegrationTestCompleted(integration)).toBe(false);
            });

            it('should return false for failed completion', () => {
                const integration: IntegrationTest = {
                    testId: 'TEST_123',
                    gasWebappUrl: 'https://example.com',
                    currentStep: 'COMPLETED',
                    currentStepStatus: 'failed',
                    lastUpdated: '2025-01-01T00:00:00Z'
                };

                expect(isIntegrationTestCompleted(integration)).toBe(false);
            });

            it('should return false for undefined integration', () => {
                expect(isIntegrationTestCompleted(undefined)).toBe(false);
            });
        });

        describe('getIntegrationTestProgress', () => {
            it('should calculate progress based on completed steps', () => {
                const integration: IntegrationTest = {
                    testId: 'TEST_123',
                    gasWebappUrl: 'https://example.com',
                    currentStep: 'LICENSE_ISSUED',
                    currentStepStatus: 'success',
                    lastUpdated: '2025-01-01T00:00:00Z',
                    completedSteps: {
                        STARTED: '2025-01-01T00:00:00Z',
                        GAS_WEBHOOK_RECEIVED: '2025-01-01T00:01:00Z'
                    }
                };

                expect(getIntegrationTestProgress(integration)).toBe(50); // 2 out of 4 steps
            });

            it('should return 100 for fully completed test', () => {
                const integration: IntegrationTest = {
                    testId: 'TEST_123',
                    gasWebappUrl: 'https://example.com',
                    currentStep: 'COMPLETED',
                    currentStepStatus: 'success',
                    lastUpdated: '2025-01-01T00:00:00Z',
                    completedSteps: {
                        STARTED: '2025-01-01T00:00:00Z',
                        GAS_WEBHOOK_RECEIVED: '2025-01-01T00:01:00Z',
                        LICENSE_ISSUED: '2025-01-01T00:02:00Z',
                        COMPLETED: '2025-01-01T00:03:00Z'
                    }
                };

                expect(getIntegrationTestProgress(integration)).toBe(100);
            });

            it('should return 0 for undefined integration', () => {
                expect(getIntegrationTestProgress(undefined)).toBe(0);
            });

            it('should return 0 for test with no completed steps', () => {
                const integration: IntegrationTest = {
                    testId: 'TEST_123',
                    gasWebappUrl: 'https://example.com',
                    currentStep: 'STARTED',
                    currentStepStatus: 'pending',
                    lastUpdated: '2025-01-01T00:00:00Z'
                };

                expect(getIntegrationTestProgress(integration)).toBe(0);
            });
        });

        describe('isStepCompleted', () => {
            it('should return true for completed steps', () => {
                const integration: IntegrationTest = {
                    testId: 'TEST_123',
                    gasWebappUrl: 'https://example.com',
                    currentStep: 'LICENSE_ISSUED',
                    currentStepStatus: 'success',
                    lastUpdated: '2025-01-01T00:00:00Z',
                    completedSteps: {
                        STARTED: '2025-01-01T00:00:00Z',
                        GAS_WEBHOOK_RECEIVED: '2025-01-01T00:01:00Z'
                    }
                };

                expect(isStepCompleted(integration, 'STARTED')).toBe(true);
                expect(isStepCompleted(integration, 'GAS_WEBHOOK_RECEIVED')).toBe(true);
            });

            it('should return false for incomplete steps', () => {
                const integration: IntegrationTest = {
                    testId: 'TEST_123',
                    gasWebappUrl: 'https://example.com',
                    currentStep: 'GAS_WEBHOOK_RECEIVED',
                    currentStepStatus: 'success',
                    lastUpdated: '2025-01-01T00:00:00Z',
                    completedSteps: {
                        STARTED: '2025-01-01T00:00:00Z'
                    }
                };

                expect(isStepCompleted(integration, 'LICENSE_ISSUED')).toBe(false);
                expect(isStepCompleted(integration, 'COMPLETED')).toBe(false);
            });
        });

        describe('getTestDuration', () => {
            it('should calculate duration between start and completion', () => {
                const integration: IntegrationTest = {
                    testId: 'TEST_123',
                    gasWebappUrl: 'https://example.com',
                    currentStep: 'COMPLETED',
                    currentStepStatus: 'success',
                    lastUpdated: '2025-01-01T00:03:00Z',
                    completedSteps: {
                        STARTED: '2025-01-01T00:00:00Z',
                        GAS_WEBHOOK_RECEIVED: '2025-01-01T00:01:00Z',
                        LICENSE_ISSUED: '2025-01-01T00:02:00Z',
                        COMPLETED: '2025-01-01T00:03:00Z'
                    }
                };

                const duration = getTestDuration(integration);
                expect(duration).toBe(180000); // 3 minutes in milliseconds
            });

            it('should return null for incomplete test', () => {
                const integration: IntegrationTest = {
                    testId: 'TEST_123',
                    gasWebappUrl: 'https://example.com',
                    currentStep: 'LICENSE_ISSUED',
                    currentStepStatus: 'success',
                    lastUpdated: '2025-01-01T00:02:00Z',
                    completedSteps: {
                        STARTED: '2025-01-01T00:00:00Z',
                        GAS_WEBHOOK_RECEIVED: '2025-01-01T00:01:00Z'
                    }
                };

                expect(getTestDuration(integration)).toBe(null);
            });

            it('should return null for undefined integration', () => {
                expect(getTestDuration(undefined)).toBe(null);
            });
        });
    });
});