/**
 * User Profile Domain Model
 *
 * This module defines the user profile structure and related types
 * for the EA License Application system.
 */

// ========================================
// Core Types
// ========================================

export type SetupPhase = 'SETUP' | 'TEST' | 'PRODUCTION';
export type IntegrationTestStep = 'STARTED' | 'GAS_WEBHOOK_RECEIVED' | 'LICENSE_ISSUED' | 'COMPLETED';
export type StepStatus = 'success' | 'failed' | 'pending';

// ========================================
// Test Results
// ========================================

/**
 * Result of the setup connection test
 */
export interface SetupTestResult {
    success: boolean;
    timestamp: string;
    details?: string;
}

/**
 * Integration test tracking with minimal but complete information
 */
export interface IntegrationTest {
    testId: string;
    gasWebappUrl: string;
    applicationSK?: string;
    licenseId?: string;

    // Current progress
    currentStep: IntegrationTestStep;
    currentStepStatus: StepStatus;
    lastUpdated: string;

    // Error tracking (only the latest error)
    lastError?: {
        step: IntegrationTestStep;
        timestamp: string;
        message: string;
    };

    // Success history (timestamp only for completed steps)
    completedSteps?: {
        STARTED?: string;
        GAS_WEBHOOK_RECEIVED?: string;
        LICENSE_ISSUED?: string;
        COMPLETED?: string;
    };
}

/**
 * Container for all test results
 */
export interface TestResults {
    setup?: SetupTestResult;
    integration?: IntegrationTest;
}

// ========================================
// User Profile
// ========================================

/**
 * Main user profile structure
 */
export interface UserProfile {
    userId: string;
    setupPhase: SetupPhase;
    testResults?: TestResults;
    notificationEnabled: boolean;
    createdAt: string;
    updatedAt: string;
}

// ========================================
// Factory Functions
// ========================================

/**
 * Creates a new user profile with default values
 */
export function createDefaultUserProfile(userId: string): UserProfile {
    const timestamp = new Date().toISOString();
    return {
        userId,
        setupPhase: 'SETUP',
        notificationEnabled: true,
        createdAt: timestamp,
        updatedAt: timestamp
    };
}

/**
 * Creates a new integration test instance
 */
export function createIntegrationTest(testId: string, gasWebappUrl: string): IntegrationTest {
    return {
        testId,
        gasWebappUrl,
        currentStep: 'STARTED',
        currentStepStatus: 'pending',
        lastUpdated: new Date().toISOString()
    };
}

// ========================================
// Domain Logic
// ========================================

/**
 * Records progress for a test step
 */
export function recordStepProgress(
    integration: IntegrationTest,
    step: IntegrationTestStep,
    success: boolean,
    details?: {
        error?: string;
        applicationSK?: string;
        licenseId?: string;
    }
): IntegrationTest {
    const timestamp = new Date().toISOString();

    const updated: IntegrationTest = {
        ...integration,
        currentStep: step,
        currentStepStatus: success ? 'success' : 'failed',
        lastUpdated: timestamp
    };

    if (success) {
        // Record successful completion
        updated.completedSteps = {
            ...integration.completedSteps,
            [step]: timestamp
        };

        // Clear any previous error
        delete updated.lastError;

        // Update step-specific data
        if (details?.applicationSK) {
            updated.applicationSK = details.applicationSK;
        }
        if (details?.licenseId) {
            updated.licenseId = details.licenseId;
        }
    } else {
        // Record failure
        updated.lastError = {
            step,
            timestamp,
            message: details?.error || 'Unknown error'
        };
    }

    return updated;
}

// ========================================
// Query Functions
// ========================================

/**
 * Validates if a value is a valid setup phase
 */
export function isValidSetupPhase(value: string): value is SetupPhase {
    return ['SETUP', 'TEST', 'PRODUCTION'].includes(value);
}

/**
 * Checks if progression to target phase is allowed
 */
export function canProgressToPhase(currentPhase: SetupPhase, targetPhase: SetupPhase): boolean {
    const phaseOrder: SetupPhase[] = ['SETUP', 'TEST', 'PRODUCTION'];
    const currentIndex = phaseOrder.indexOf(currentPhase);
    const targetIndex = phaseOrder.indexOf(targetPhase);

    return targetIndex === currentIndex + 1;
}

/**
 * Gets the next step in the integration test flow
 */
export function getNextStep(currentStep: IntegrationTestStep): IntegrationTestStep | null {
    const steps: IntegrationTestStep[] = ['STARTED', 'GAS_WEBHOOK_RECEIVED', 'LICENSE_ISSUED', 'COMPLETED'];
    const currentIndex = steps.indexOf(currentStep);

    if (currentIndex === -1 || currentIndex === steps.length - 1) {
        return null;
    }

    return steps[currentIndex + 1];
}

/**
 * Checks if the integration test is completed
 */
export function isIntegrationTestCompleted(integration?: IntegrationTest): boolean {
    return integration?.currentStep === 'COMPLETED' &&
        integration?.currentStepStatus === 'success';
}

/**
 * Calculates the integration test progress percentage
 */
export function getIntegrationTestProgress(integration?: IntegrationTest): number {
    if (!integration) return 0;

    const completedCount = Object.keys(integration.completedSteps || {}).length;
    return Math.round((completedCount / 4) * 100);
}

/**
 * Checks if a specific step is completed
 */
export function isStepCompleted(integration: IntegrationTest, step: IntegrationTestStep): boolean {
    return !!integration.completedSteps?.[step];
}

/**
 * Gets the duration between test start and completion
 */
export function getTestDuration(integration?: IntegrationTest): number | null {
    if (!integration?.completedSteps?.STARTED || !integration?.completedSteps?.COMPLETED) {
        return null;
    }

    const startTime = new Date(integration.completedSteps.STARTED).getTime();
    const endTime = new Date(integration.completedSteps.COMPLETED).getTime();

    return endTime - startTime;
}

// ========================================
// Type Guards
// ========================================

/**
 * Type guard for IntegrationTestStep
 */
export function isValidIntegrationTestStep(value: string): value is IntegrationTestStep {
    return ['STARTED', 'GAS_WEBHOOK_RECEIVED', 'LICENSE_ISSUED', 'COMPLETED'].includes(value);
}

/**
 * Type guard for StepStatus
 */
export function isValidStepStatus(value: string): value is StepStatus {
    return ['success', 'failed', 'pending'].includes(value);
}