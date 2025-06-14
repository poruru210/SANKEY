/**
 * Integration Test Service
 *
 * Business logic for managing integration tests
 */

import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import {
    UserProfile,
    IntegrationTest,
    IntegrationTestStep,
    createIntegrationTest,
    recordStepProgress,
    getNextStep,
    isIntegrationTestCompleted
} from '../models/userProfile';
import { EAApplication } from '../models/eaApplication';
import { IntegrationTestRepository } from '../repositories/integrationTestRepository';
import { EAApplicationRepository } from '../repositories/eaApplicationRepository';
import { UserProfileRepository } from '../repositories/userProfileRepository';
import {IntegrationTestServiceDependencies} from "@lambda/di/dependencies";

/**
 * Service for managing integration tests
 */
export class IntegrationTestService {
    private readonly docClient: DynamoDBDocumentClient;
    private readonly integrationTestRepository: IntegrationTestRepository;
    private readonly eaApplicationRepository: EAApplicationRepository;
    private readonly userProfileRepository: UserProfileRepository;
    private readonly logger: Logger;
    private readonly applicationsTableName: string;

    /**
     * DI対応コンストラクタ
     */
    constructor(dependencies: IntegrationTestServiceDependencies) {
        this.docClient = dependencies.docClient;
        this.integrationTestRepository = dependencies.integrationTestRepository;
        this.eaApplicationRepository = dependencies.eaApplicationRepository;
        this.userProfileRepository = dependencies.userProfileRepository;
        this.logger = dependencies.logger;
        this.applicationsTableName = process.env.TABLE_NAME || 'ea-applications-licenseservicedbstack';
    }

    /**
     * Starts a new integration test
     */
    async startIntegrationTest(userId: string, testId: string, gasWebappUrl: string): Promise<void> {
        this.logger.info('Starting integration test:', { userId, testId, gasWebappUrl });

        // Create new integration test instance
        const integrationTest = createIntegrationTest(testId, gasWebappUrl);

        // Record STARTED step as in progress
        const updatedTest = recordStepProgress(
            integrationTest,
            'STARTED',
            false, // Initially pending, will be updated after GAS call
            { error: 'Pending GAS WebApp call' }
        );

        // Initialize in database
        await this.integrationTestRepository.initializeIntegrationTest(userId, updatedTest);
    }

    /**
     * Records successful start of integration test (after GAS call)
     */
    async recordTestStarted(userId: string, testId: string): Promise<void> {
        this.logger.info('Recording test started:', { userId, testId });

        const userProfile = await this.userProfileRepository.getUserProfile(userId);
        if (!userProfile?.testResults?.integration) {
            throw new Error('Integration test not found');
        }

        if (userProfile.testResults.integration.testId !== testId) {
            throw new Error('Test ID mismatch');
        }

        // Update STARTED step as successful
        const updatedTest = recordStepProgress(
            userProfile.testResults.integration,
            'STARTED',
            true,
            { error: undefined }
        );

        await this.integrationTestRepository.updateIntegrationTest(userId, updatedTest);
    }

    /**
     * Records progress for a specific step
     */
    async recordProgress(
        userId: string,
        step: IntegrationTestStep,
        success: boolean,
        details?: {
            error?: string;
            applicationSK?: string;
            licenseId?: string;
        }
    ): Promise<void> {
        this.logger.info('Recording progress:', { userId, step, success });

        const userProfile = await this.userProfileRepository.getUserProfile(userId);
        if (!userProfile?.testResults?.integration) {
            throw new Error('No active integration test found');
        }

        const integrationTest = userProfile.testResults.integration;

        // Validate step progression
        if (step !== 'STARTED' && !this.canProgressToStep(integrationTest, step)) {
            throw new Error(`Cannot progress to step ${step} from current state`);
        }

        // Record progress
        const updatedTest = recordStepProgress(integrationTest, step, success, details);

        // Update in database
        await this.integrationTestRepository.updateIntegrationTest(userId, updatedTest);

        // Log result
        if (success) {
            this.logger.info('Step completed successfully:', { userId, step });
        } else {
            this.logger.error('Step failed:', { userId, step, error: details?.error });
        }
    }

    /**
     * Cleans up all integration test data for a user
     */
    async cleanupIntegrationTestData(userId: string): Promise<void> {
        this.logger.info('Cleaning up integration test data:', { userId });

        try {
            // Clean up UserProfile data
            await this.integrationTestRepository.clearIntegrationTest(userId);
            this.logger.info('Cleared integration test from user profile:', { userId });

            // Clean up related Applications
            await this.cleanupIntegrationTestApplications(userId);
            this.logger.info('Integration test cleanup completed:', { userId });

        } catch (error) {
            this.logger.error('Error during integration test cleanup:', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
            // Don't throw - cleanup should be best effort
        }
    }

    /**
     * Gets the current integration test status
     */
    async getIntegrationTestStatus(userId: string): Promise<{
        active: boolean;
        test?: IntegrationTest;
        canRetry: boolean;
        nextStep?: IntegrationTestStep;
        progress: number;
    }> {
        const userProfile = await this.userProfileRepository.getUserProfile(userId);
        const integrationTest = userProfile?.testResults?.integration;

        if (!integrationTest) {
            return {
                active: false,
                canRetry: true,
                progress: 0
            };
        }

        const isCompleted = isIntegrationTestCompleted(integrationTest);
        const canRetry = integrationTest.currentStepStatus === 'failed';
        const nextStep = !isCompleted && integrationTest.currentStepStatus === 'success'
            ? getNextStep(integrationTest.currentStep) || undefined
            : undefined;

        const completedSteps = Object.keys(integrationTest.completedSteps || {}).length;
        const progress = Math.round((completedSteps / 4) * 100);

        return {
            active: !isCompleted,
            test: integrationTest,
            canRetry,
            nextStep,
            progress
        };
    }

    /**
     * Checks if an application is part of an integration test
     */
    isIntegrationTestApplication(application: EAApplication): boolean {
        return !!(
            application.integrationTestId ||
            application.accountNumber === 'INTEGRATION_TEST_123456' ||
            application.broker === 'Test Broker' ||
            application.eaName === 'Integration Test EA'
        );
    }

    /**
     * Validates if test can progress to the specified step
     */
    private canProgressToStep(integrationTest: IntegrationTest, targetStep: IntegrationTestStep): boolean {
        // Check if we're retrying the current failed step
        if (integrationTest.currentStep === targetStep && integrationTest.currentStepStatus === 'failed') {
            return true;
        }

        // Check if we're moving to the next step after success
        if (integrationTest.currentStepStatus === 'success') {
            const nextStep = getNextStep(integrationTest.currentStep);
            return nextStep === targetStep;
        }

        return false;
    }

    /**
     * Cleans up integration test applications
     */
    private async cleanupIntegrationTestApplications(userId: string): Promise<void> {
        try {
            const allApplications = await this.eaApplicationRepository.getAllApplications(userId);
            const testApplications = allApplications.filter(app => this.isIntegrationTestApplication(app));

            this.logger.info('Found integration test applications:', {
                userId,
                total: allApplications.length,
                testApps: testApplications.length
            });

            for (const app of testApplications) {
                try {
                    await this.eaApplicationRepository.deleteApplication(userId, app.sk);
                    this.logger.info('Deleted test application:', { userId, sk: app.sk });
                } catch (error) {
                    this.logger.error('Failed to delete test application:', {
                        userId,
                        sk: app.sk,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        } catch (error) {
            this.logger.error('Failed to cleanup test applications:', {
                userId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Finds integration test applications by test ID
     */
    async findIntegrationTestApplications(testId: string): Promise<EAApplication[]> {
        try {
            const scanParams = {
                TableName: this.applicationsTableName,
                FilterExpression: 'integrationTestId = :testId',
                ExpressionAttributeValues: {
                    ':testId': testId
                },
                ProjectionExpression: 'userId, sk, integrationTestId, accountNumber, broker, eaName, #status',
                ExpressionAttributeNames: {
                    '#status': 'status'
                }
            };

            const result = await this.docClient.send(new ScanCommand(scanParams));
            return (result.Items || []) as EAApplication[];

        } catch (error) {
            this.logger.error('Error finding test applications:', {
                testId,
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }
}