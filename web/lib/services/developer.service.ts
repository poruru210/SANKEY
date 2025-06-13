import { httpClient, HttpError } from "@/lib/http-client";

export class DeveloperServiceError extends Error {
    constructor(
        message: string,
        public status: number = 500,
        public code?: string
    ) {
        super(message);
        this.name = 'DeveloperServiceError';
    }
}

export interface IntegrationTestRequest {
    gasWebappUrl: string;
}

export interface IntegrationTestResponse {
    success: boolean;
    message: string;
    testId: string;
    nextSteps: string[];
    estimatedDuration: string;
    webhookUrl?: string;
    gasResponse?: any;
}

export type IntegrationTestStep = 'STARTED' | 'GAS_WEBHOOK_RECEIVED' | 'LICENSE_ISSUED' | 'COMPLETED';

export interface IntegrationTestProgress {
    testId: string;
    currentStep: IntegrationTestStep;
    steps: {
        [key in IntegrationTestStep]?: {
            timestamp: string;
            success: boolean;
            details?: string;
            error?: string;
        }
    };
    startedAt: string;
    completedAt?: string;
    totalDuration?: number;
    applicationSK?: string;
}

export interface UserProfile {
    userId: string;
    setupPhase: 'SETUP' | 'TEST' | 'PRODUCTION';
    setupData: {
        gasProjectId?: string;
        formId?: string;
        spreadsheetId?: string;
    };
    testResults: {
        setupTest?: {
            success: boolean;
            timestamp: string;
            details?: string
        };
        integrationTest?: {
            success: boolean;
            timestamp: string;
            testId?: string;
            licenseId?: string;
            applicationId?: string;
            details?: string;
            gasWebappUrl?: string;
            progress?: IntegrationTestProgress;
        };
    };
    notificationEnabled: boolean;
    createdAt: string;
    updatedAt: string;
}

class DeveloperService {
    async downloadGasTemplate(): Promise<Blob> {
        try {
            const response = await httpClient.get<Blob>('/applications/config/gas', {
                headers: {
                    'Accept': 'text/plain',
                },
                responseType: 'blob',
            });

            return response;

        } catch (error) {
            if (error instanceof HttpError) {
                throw new DeveloperServiceError(
                    `Failed to download GAS template: ${error.message}`,
                    error.status
                );
            }
            throw new DeveloperServiceError('Failed to download GAS template');
        }
    }

    async triggerIntegrationTest(gasWebappUrl: string): Promise<IntegrationTestResponse> {
        try {
            const requestData: IntegrationTestRequest = {
                gasWebappUrl
            };

            const response = await httpClient.post<IntegrationTestResponse>('/integration/test/start', requestData);

            return response;

        } catch (error) {
            if (error instanceof HttpError) {
                throw new DeveloperServiceError(
                    `Failed to trigger integration test: ${error.message}`,
                    error.status
                );
            }
            throw new DeveloperServiceError('Failed to trigger integration test');
        }
    }

    async getUserProfile(): Promise<UserProfile> {
        try {
            const response = await httpClient.get<{success: boolean; data: UserProfile}>('/profile');

            return response.data;

        } catch (error) {
            if (error instanceof HttpError) {
                throw new DeveloperServiceError(
                    `Failed to get user profile: ${error.message}`,
                    error.status
                );
            }
            throw new DeveloperServiceError('Failed to get user profile');
        }
    }
}

export const developerService = new DeveloperService();