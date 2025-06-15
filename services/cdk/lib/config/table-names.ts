// lib/config/table-names.ts

/**
 * DynamoDBテーブル名の一元管理
 * スタック間の循環依存を避けるため、テーブル名を静的に管理
 */
export class TableNames {
    /**
     * ユーザープロファイルテーブルのベース名
     */
    private static readonly USER_PROFILE_BASE = 'user-profiles';

    /**
     * EAアプリケーションテーブルのベース名
     */
    private static readonly EA_APPLICATIONS_BASE = 'applications';

    /**
     * ユーザープロファイルテーブル名を取得
     * @param environment 環境名 (dev/prod/staging等)
     * @returns 完全なテーブル名
     */
    public static getUserProfileTableName(environment: string): string {
        return `sankey-${TableNames.USER_PROFILE_BASE}-${environment}`;
    }

    /**
     * EAアプリケーションテーブル名を取得
     * @param environment 環境名 (dev/prod/staging等)
     * @returns 完全なテーブル名
     */
    public static getEAApplicationsTableName(environment: string): string {
        return `sankey-${TableNames.EA_APPLICATIONS_BASE}-${environment}`;
    }

    /**
     * ベース名のみを取得（CDKヘルパー用）
     */
    public static get userProfileBase(): string {
        return TableNames.USER_PROFILE_BASE;
    }

    public static get eaApplicationsBase(): string {
        return TableNames.EA_APPLICATIONS_BASE;
    }
}