import { handler } from '../../../src/handlers/rejectApplicationHandler'; // Adjust path as needed
import { EAApplicationRepository } from '../../../src/repositories/eaApplicationRepository'; // Adjust path
import { APIGatewayProxyEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

// Suppress PowerTools logging to keep test output clean
Logger.prototype.info = jest.fn();
Logger.prototype.warn = jest.fn();
Logger.prototype.error = jest.fn();
Logger.prototype.debug = jest.fn();


// Mock the repository
jest.mock('../../../src/repositories/eaApplicationRepository');

const mockGetApplication = jest.fn();
const mockUpdateEAApplicationStatus = jest.fn();
const mockRecordHistory = jest.fn();

EAApplicationRepository.prototype.getApplication = mockGetApplication;
EAApplicationRepository.prototype.updateEAApplicationStatus = mockUpdateEAApplicationStatus;
EAApplicationRepository.prototype.recordHistory = mockRecordHistory;


describe('Reject Application Handler', () => {
    const mockUserId = 'test-user-123';
    const mockApplicationKey = 'test-app-key-456'; // This is the part of SK after "APPLICATION#"
    const fullApplicationSK = `APPLICATION#${mockApplicationKey}`;

    let mockEvent: Partial<APIGatewayProxyEvent>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockEvent = {
            requestContext: {
                authorizer: {
                    claims: {
                        sub: mockUserId,
                    },
                },
                accountId: 'dummy-account-id', // Required by logger
            },
            pathParameters: {
                applicationKey: mockApplicationKey,
            },
            body: null, // No body needed for reject, or add if reason is implemented
        };
    });

    it('should reject a Pending application successfully', async () => {
        const pendingApplication = {
            userId: mockUserId,
            sk: fullApplicationSK,
            status: 'Pending',
            appliedAt: new Date().toISOString(),
            // ... other fields
        };
        mockGetApplication.mockResolvedValue(pendingApplication);
        mockUpdateEAApplicationStatus.mockResolvedValue({ ...pendingApplication, status: 'Rejected', rejectedAt: expect.any(String) });

        const result = await handler(mockEvent as APIGatewayProxyEvent, {} as any, {} as any);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body).message).toBe('Application rejected successfully');
        expect(mockGetApplication).toHaveBeenCalledWith(mockUserId, fullApplicationSK);
        expect(mockUpdateEAApplicationStatus).toHaveBeenCalledWith(
            mockUserId,
            fullApplicationSK,
            'Rejected',
            'rejectedAt',
            expect.any(String) // Current date as ISO string
        );
        expect(mockRecordHistory).toHaveBeenCalledWith({
            userId: mockUserId,
            applicationSK: fullApplicationSK,
            action: 'Rejected',
            changedBy: mockUserId,
            previousStatus: 'Pending',
            newStatus: 'Rejected',
        });
    });

    it('should return 404 if application not found', async () => {
        mockGetApplication.mockResolvedValue(null);

        const result = await handler(mockEvent as APIGatewayProxyEvent, {} as any, {} as any);

        expect(result.statusCode).toBe(404);
        expect(JSON.parse(result.body).message).toBe('Application not found');
        expect(mockGetApplication).toHaveBeenCalledWith(mockUserId, fullApplicationSK);
        expect(mockUpdateEAApplicationStatus).not.toHaveBeenCalled();
        expect(mockRecordHistory).not.toHaveBeenCalled();
    });

    it('should return 400 if application is not in Pending status', async () => {
        const activeApplication = {
            userId: mockUserId,
            sk: fullApplicationSK,
            status: 'Active',
            // ... other fields
        };
        mockGetApplication.mockResolvedValue(activeApplication);

        const result = await handler(mockEvent as APIGatewayProxyEvent, {} as any, {} as any);

        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).message).toBe('Application status is Active, not Pending. Cannot reject.');
        expect(mockGetApplication).toHaveBeenCalledWith(mockUserId, fullApplicationSK);
        expect(mockUpdateEAApplicationStatus).not.toHaveBeenCalled();
        expect(mockRecordHistory).not.toHaveBeenCalled();
    });

    it('should return 400 if applicationKey is missing', async () => {
        mockEvent.pathParameters = {}; // Missing applicationKey
        const result = await handler(mockEvent as APIGatewayProxyEvent, {} as any, {} as any);

        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).message).toBe('Invalid request: Missing applicationKey or userId from token.');
    });

    it('should return 400 if userId is missing from token claims', async () => {
        mockEvent.requestContext!.authorizer = { claims: {} }; // Missing sub (userId)
        const result = await handler(mockEvent as APIGatewayProxyEvent, {} as any, {} as any);

        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).message).toBe('Invalid request: Missing applicationKey or userId from token.');
    });

    it('should return 500 if getApplication fails', async () => {
        mockGetApplication.mockRejectedValue(new Error('DynamoDB error'));
        const result = await handler(mockEvent as APIGatewayProxyEvent, {} as any, {} as any);
        expect(result.statusCode).toBe(500);
        expect(JSON.parse(result.body).message).toBe('Internal server error while rejecting application');
    });

    it('should return 500 if updateEAApplicationStatus fails', async () => {
        const pendingApplication = { userId: mockUserId, sk: fullApplicationSK, status: 'Pending' };
        mockGetApplication.mockResolvedValue(pendingApplication);
        mockUpdateEAApplicationStatus.mockRejectedValue(new Error('Update failed'));

        const result = await handler(mockEvent as APIGatewayProxyEvent, {} as any, {} as any);

        expect(result.statusCode).toBe(500);
        expect(JSON.parse(result.body).message).toBe('Internal server error while rejecting application');
        expect(mockRecordHistory).not.toHaveBeenCalled(); // Should not record history if update fails
    });

    it('should return 200 if recordHistory fails but update was successful', async () => {
        const pendingApplication = {
            userId: mockUserId,
            sk: fullApplicationSK,
            status: 'Pending',
            appliedAt: new Date().toISOString(),
        };
        mockGetApplication.mockResolvedValue(pendingApplication);
        mockUpdateEAApplicationStatus.mockResolvedValue({ ...pendingApplication, status: 'Rejected', rejectedAt: new Date().toISOString() });
        mockRecordHistory.mockRejectedValue(new Error('History recording failed')); // Simulate history failure

        const result = await handler(mockEvent as APIGatewayProxyEvent, {} as any, {} as any);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body).message).toBe('Application rejected successfully');
        expect(mockRecordHistory).toHaveBeenCalled();
    });
});
