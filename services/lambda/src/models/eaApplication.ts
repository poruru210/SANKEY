// services/lambda/src/models/eaApplication.ts
// === ApplicationStatus の定義 ===
export type ApplicationStatus =
    | 'Pending'
    | 'Approve'
    | 'AwaitingNotification'
    | 'FailedNotification'  // 新規追加: メール送信失敗
    | 'Active'
    | 'Expired'
    | 'Revoked'
    | 'Rejected'
    | 'Cancelled';

// === HistoryAction の Union Type 定義 ===
export type HistoryAction =
    | ApplicationStatus  // 全てのステータスを含む
    | 'Created'          // 新規作成
    | 'Updated'          // 一般的な更新
    | 'SystemExpired'    // システムによる期限切れ
    | 'SystemUpdate'     // システムによる更新
    | 'LicenseGenerated' // ライセンス生成
    | 'EmailSent'        // メール送信完了
    | 'EmailFailed'      // メール送信失敗
    | 'AdminAction'      // 管理者による操作
    | 'RetryNotification'; // 通知再送

// === EAApplicationHistory インターフェース ===
export interface EAApplicationHistory {
    userId: string;
    sk: string; // HISTORY#{applicationSK}#{timestamp}
    action: HistoryAction; // Union Type を使用
    changedBy: string;
    changedAt: string;
    previousStatus?: ApplicationStatus;
    newStatus?: ApplicationStatus;
    reason?: string;
    errorDetails?: string; // エラー詳細情報（新規追加）
    retryCount?: number;   // リトライ回数（新規追加）
    ttl?: number; // Unix timestamp (TTL用)
}

export interface EAApplication {
    userId: string;
    sk: string;

    // 基本情報
    eaName: string;
    accountNumber: string;
    broker: string;
    email: string;
    xAccount: string;

    // ステータス管理
    status: ApplicationStatus;
    appliedAt: string;
    updatedAt: string;

    // 通知スケジュール（復活）
    notificationScheduledAt?: string;

    // 失敗時の追跡情報（新規追加）
    lastFailureReason?: string;  // 最後の失敗理由
    failureCount?: number;       // 失敗回数
    lastFailedAt?: string;       // 最後の失敗時刻

    // ビジネスロジックで必要な情報のみ
    licenseKey?: string;
    expiryDate?: string;

    // TTL（自動削除用）
    ttl?: number; // Unix timestamp
}

// === SQS通知メッセージ ===
export interface NotificationMessage {
    applicationSK: string;  // SKフィールドと統一
    userId: string;
    retryCount?: number;    // リトライ回数（新規追加）
    originalFailureReason?: string; // 元の失敗理由（新規追加）
}

// === DLQ処理用のメッセージ ===
export interface DLQNotificationMessage extends NotificationMessage {
    originalEventSourceARN: string; // 元のSQSキューのARN
    failureReason: string;          // 失敗理由
    failedAt: string;               // 失敗時刻
    receiptHandle?: string;         // SQSメッセージのレシートハンドル
}

export const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
    'Pending': ['Approve', 'AwaitingNotification', 'Rejected', 'Cancelled'],
    'Approve': ['AwaitingNotification'],
    'AwaitingNotification': ['Active', 'FailedNotification', 'Cancelled'],
    'FailedNotification': ['AwaitingNotification', 'Active', 'Cancelled'], // 再送可能
    'Active': ['Expired', 'Revoked'],
    'Expired': [],
    'Revoked': [],
    'Rejected': [],
    'Cancelled': []
};

// === TTL関連の定数と関数 ===

// 終了ステータス（削除対象）の定義
export const TERMINAL_STATUSES: ApplicationStatus[] = ['Expired', 'Revoked', 'Rejected', 'Cancelled'];

// ステータスが終了ステータスかどうかを判定
export function isTerminalStatus(status: ApplicationStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
}

// 再送可能なステータスかどうかを判定（新規追加）
export function isRetryableStatus(status: ApplicationStatus): boolean {
    return status === 'FailedNotification';
}

// TTL期間をカスタマイズ可能な関数（デフォルト6ヶ月）
export function calculateTTL(fromDate?: string, months: number = 6): number {
    const baseDate = fromDate ? new Date(fromDate) : new Date();
    const targetDate = new Date(baseDate);
    targetDate.setMonth(baseDate.getMonth() + months);

    // Unix timestampに変換（秒単位）
    return Math.floor(targetDate.getTime() / 1000);
}

// 環境変数またはコンテキストからTTL期間を取得
export function getTTLMonths(): number {
    // 環境変数から取得（Lambda関数用）
    const envMonths = process.env.TTL_MONTHS;
    if (envMonths) {
        const months = parseInt(envMonths, 10);
        if (!isNaN(months) && months > 0 && months <= 60) {
            return months;
        }
    }

    // デフォルト値
    return 6;
}

// 実際に使用するTTL計算関数（環境変数を考慮）
export function calculateTTLWithConfig(fromDate?: string): number {
    const months = getTTLMonths();
    return calculateTTL(fromDate, months);
}

// === ヘルパー関数 ===
export function isValidStatusTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
}

export function getStatusTimestampField(status: ApplicationStatus): keyof EAApplication | null {
    // 常に updatedAt のみ更新（HISTORY テーブルで詳細な時刻管理）
    return 'updatedAt';
}

// === SK 生成関数 ===
export function generateApplicationSK(
    appliedAt: string,
    broker: string,
    accountNumber: string,
    eaName: string
): string {
    return `APPLICATION#${appliedAt}#${broker}#${accountNumber}#${eaName}`;
}

// APPLICATION SKを含む形式
export function generateHistorySK(
    applicationSK: string,  // APPLICATION SK全体を受け取る
    timestamp: string
): string {
    // APPLICATION# プレフィックスを除去してからHISTORY SKを生成
    const cleanSK = applicationSK.startsWith('APPLICATION#')
        ? applicationSK.substring('APPLICATION#'.length)
        : applicationSK;

    return `HISTORY#${cleanSK}#${timestamp}`;
}

// HISTORY クエリ用のプレフィックス生成
export function getHistoryQueryPrefix(applicationSK: string): string {
    const cleanSK = applicationSK.startsWith('APPLICATION#')
        ? applicationSK.substring('APPLICATION#'.length)
        : applicationSK;

    return `HISTORY#${cleanSK}#`;
}

// === 型ガード関数 ===
export function isApplicationStatus(value: string): value is ApplicationStatus {
    const validStatuses: ApplicationStatus[] = [
        'Pending', 'Approve', 'AwaitingNotification', 'FailedNotification', 'Active', 'Expired', 'Revoked', 'Rejected', 'Cancelled'
    ];
    return validStatuses.includes(value as ApplicationStatus);
}

export function isHistoryAction(value: string): value is HistoryAction {
    const validActions: HistoryAction[] = [
        // ApplicationStatus
        'Pending', 'Approve', 'AwaitingNotification', 'FailedNotification', 'Active', 'Expired', 'Revoked', 'Rejected', 'Cancelled',
        // Additional actions
        'Created', 'Updated', 'SystemExpired', 'SystemUpdate', 'LicenseGenerated', 'EmailSent', 'EmailFailed', 'AdminAction', 'RetryNotification'
    ];
    return validActions.includes(value as HistoryAction);
}

// === 失敗処理関連の定数 ===
export const MAX_RETRY_COUNT = 3; // 最大リトライ回数
export const RETRY_DELAY_SECONDS = 300; // リトライ間隔（秒）