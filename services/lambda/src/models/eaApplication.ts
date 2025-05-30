export interface EAApplication {
    userId: string;
    sk: string; // "APPLICATION#<appliedAt>#<accountNumber>"
    accountNumber: string;
    eaName: string;
    broker: string;
    email: string;
    xAccount: string;
    status: 'Pending' | 'Active' | 'Expired' | 'Revoked' | 'Rejected';
    appliedAt: string;
    approvedAt?: string;
    expiresAt?: string;
    revokedAt?: string;
    licenseKey?: string;
    updatedAt?: string;
}

export interface EAApplicationHistory {
    userId: string;
    sk: string; // "HISTORY#<appliedAt>#<accountNumber>#<timestamp>"
    action: 'Pending' | 'Active' | 'Expired' | 'Revoked' | 'Rejected';
    changedBy: string; // CognitoユーザーID
    changedAt: string;
    previousStatus?: string;
    newStatus?: string;
}