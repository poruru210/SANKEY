// lib/status-utils.ts または utils/status.ts
// ステータス関連のユーティリティ関数を管理する専用ファイル

/**
 * ステータス値を翻訳キーにマッピングするヘルパー関数
 * @param status - バックエンドから受け取るステータス値
 * @returns 対応する翻訳キー
 */
export function getStatusTranslationKey(status: string): string {
    const normalizedStatus = status.toLowerCase()

    switch (normalizedStatus) {
        case 'pending':
            return 'status.pending'
        case 'active':
            return 'status.active'
        case 'expired':
            return 'status.expired'
        case 'revoked':
            return 'status.revoked'
        case 'rejected':
            return 'status.rejected'
        case 'deactivated':
            return 'status.deactivated'
        case 'awaitingnotification':
            return 'status.awaitingNotification'
        case 'cancelled':
            return 'status.cancelled'
        default:
            // フォールバックとして、動的にキーを生成
            return `status.${normalizedStatus}`
    }
}

/**
 * ステータスに応じたスタイルクラスを取得する関数
 * @param status - ステータス値
 * @returns Tailwind CSSクラス
 */
export function getStatusStyle(status: string): string {
    const normalizedStatus = status.toLowerCase().replace(/\s+/g, ''); // Normalize spaces for multi-word statuses

    switch (normalizedStatus) {
        case 'active':
            return "bg-[var(--badge-active-bg)] text-[var(--badge-active-text)] border-[var(--badge-active-bg)]";
        case 'pending':
            return "bg-[var(--badge-pending-bg)] text-[var(--badge-pending-text)] border-[var(--badge-pending-bg)]";
        case 'awaitingnotification':
            return "bg-[var(--badge-awaitingnotification-bg)] text-[var(--badge-awaitingnotification-text)] border-[var(--badge-awaitingnotification-bg)]";
        case 'cancelled':
            return "bg-[var(--badge-cancelled-bg)] text-[var(--badge-cancelled-text)] border-[var(--badge-cancelled-bg)]";
        case 'rejected':
            return "bg-[var(--badge-rejected-bg)] text-[var(--badge-rejected-text)] border-[var(--badge-rejected-bg)]";
        case 'expired':
            return "bg-[var(--badge-expired-bg)] text-[var(--badge-expired-text)] border-[var(--badge-expired-bg)]";
        case 'revoked':
            return "bg-[var(--badge-revoked-bg)] text-[var(--badge-revoked-text)] border-[var(--badge-revoked-bg)]";
        case 'deactivated':
            return "bg-[var(--badge-deactivated-bg)] text-[var(--badge-deactivated-text)] border-[var(--badge-deactivated-bg)]";
        default:
            // Fallback to a generic gray badge or a predefined default variable if available
            return "bg-gray-500 text-white border-gray-500";
    }
}