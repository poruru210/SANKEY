# SanKey Developer Tools

このディレクトリには、SanKeyアプリケーションの開発、テスト、および環境構築を支援するための各種スクリプトが含まれています。

## スクリプト一覧

### 1. 環境構築スクリプト (`setup-environment.js`)

SanKeyアプリケーションの完全な環境構築（AWSリソース、Cloudflare証明書・DNS、Vercel環境変数、ローカル `.env.local` ファイル生成、デプロイなど）を自動化します。対話モードと直接実行モードをサポートしています。

-   **詳細ドキュメント**: [./docs/setup_environment_doc.md](./docs/setup_environment_doc.md)
-   **使用例**:
    ```bash
    node setup-environment.js --profile your-aws-sso-profile
    ```

### 2. テストデータ生成スクリプト (`generate-test-data.js`)

DynamoDBテーブルにEAライセンス申請のテストデータを効率的に作成・管理するためのスクリプトです。ダミーデータの生成、既存データの削除、リセット機能などを提供します。

-   **詳細ドキュメント**: [./docs/generate_test_data_doc.md](./docs/generate_test_data_doc.md)
-   **使用例**:
    ```bash
    node generate-test-data.js --profile your-aws-sso-profile --count 10
    ```

## ライブラリとモジュール

-   `lib/`: 各スクリプトで共通して使用されるヘルパー関数、定数定義、カスタムエラークラスなどが含まれています。
    -   `constants.js`: プロジェクト全体で使用される定数を一元管理しています。カスタマイズの際はまずこのファイルを確認してください。
    -   `errors.js`: カスタムエラークラスが定義されており、エラーハンドリングの強化に貢献しています。
-   `modules/`: 特定の機能（例: AWS設定取得、Vercel環境変数設定など）に特化した処理をまとめたモジュールが含まれています。

## 注意事項

-   各スクリプトを実行する前に、必要な環境変数（`.env`ファイル経由）やAWS SSOプロファイルが正しく設定されていることを確認してください。
-   各スクリプトのヘルプオプション (`--help`) で、利用可能なコマンドラインオプションの詳細を確認できます。
