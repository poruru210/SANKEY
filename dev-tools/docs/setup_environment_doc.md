# SanKey Environment Setup Script (`setup-environment.js`) ガイド

## 📖 概要

`setup-environment.js` は、SanKey アプリケーションの完全な環境構築を自動化するためのNode.jsスクリプトです。AWSリソースのプロビジョニング（CDK経由）、Cloudflareでの証明書管理とDNS設定、Vercelプロジェクトの環境変数設定、ローカル開発用の `.env.local` ファイル生成、そしてアプリケーションのデプロイまで、一連のセットアッププロセスを対話的または直接実行モードでサポートします。

## 🎯 主な機能

- **対話式メニュー**: 各セットアップステップを対話的に選択・実行可能。
- **直接実行モード**: コマンドラインオプションで特定の処理を直接実行。
- **証明書管理**: Cloudflare Origin CA証明書を作成し、AWS Certificate Manager (ACM) にインポート。
- **Vercel連携**: Vercelプロジェクトの環境変数を自動設定し、デプロイをトリガー。
- **ローカル環境設定**: AWS設定を元に `.env.local` ファイルを生成。
- **エラーハンドリング**: カスタムエラークラス (`dev-tools/lib/errors.js`) を使用し、エラー発生時の原因究明と対処を支援。
- **設定の一元管理**: 多くの設定値や固定文字列を `dev-tools/lib/constants.js` で集中管理。

## 🛠️ スクリプトの構造と責務

`setup-environment.js` は、環境セットアップ全体のオーケストレーターとしての役割を担います。実際の個々の処理は、`dev-tools/modules/` ディレクトリ内の専門モジュールや `dev-tools/lib/` ディレクトリ内のヘルパー関数によって実行されます。

主なモジュール構成：
- **`interactive-menu-module.js`**: 対話型メニューの表示とユーザー入力処理。
- **`aws-config-module.js`**: AWS CloudFormationスタックから設定情報を取得。
- **`certificate-module.js`**: Cloudflare Origin CA証明書の作成とACMへのインポート。
- **`custom-domain-module.js`**: （現在は `certificate-module` に統合されているか、別途DNS設定用として機能する可能性あり。要確認）
- **`env-local-module.js`**: `.env.local` ファイルの生成と更新。
- **`vercel-env-module.js`**: Vercel環境変数の設定。
- **`ssm-module.js`**: AWS Systems Manager Parameter Store を利用した設定値の保存・取得（例: 証明書ARN）。
- **`lib/constants.js`**: スクリプト全体で使用される定数（APIエンドポイント、固定文字列、設定キー名など）を一元管理。このファイルの重要性が増しており、多くの設定がここに集約されています。
- **`lib/errors.js`**: カスタムエラークラスを定義し、エラーハンドリングを強化。
- **`lib/logger.js`**: ログ出力のフォーマットや色付けを管理。
- **`lib/cli-helpers.js`**: コマンドライン引数の処理やタイマーなどのユーティリティ。
- **`lib/aws-helpers.js`**: AWS SDK操作のヘルパー関数。
- **`lib/vercel-helpers.js`**: Vercel API操作のヘルパー関数。

以前存在した `menu-module.js` は `interactive-menu-module.js` に機能が統合され、削除されました。

## 🚀 使用方法

基本的な使用法は `generate-test-data.js` と同様に、プロファイル指定で実行します。

```bash
node setup-environment.js --profile your-aws-sso-profile
```

対話モードが起動し、実行したい操作を選択できます。
特定の操作のみを実行したい場合は、コマンドラインオプションを使用します（例: `--generate-env-local`）。

詳細はスクリプトのヘルプを参照してください。
```bash
node setup-environment.js --help
```

## 🔧 設定とカスタマイズ

多くの設定値やAPIエンドポイント、固定文字列は `dev-tools/lib/constants.js` で一元管理されています。スクリプトの基本的な動作や対象を変更したい場合は、まずこのファイルを確認・編集することを推奨します。

## ⚠️ エラーハンドリングとトラブルシューティング

本スクリプトでは、`dev-tools/lib/errors.js` に定義されたカスタムエラークラスを用いたエラーハンドリングが強化されています。エラー発生時には、エラーの種類（`ConfigurationError`, `ApiError`, `CdkNotDeployedError` など）に応じて、より具体的で分かりやすいエラーメッセージと原因、可能な対処法がログに出力されます。

問題が発生した場合は、出力されたエラーメッセージとログを注意深く確認してください。`--debug` オプションを付けて実行すると、より詳細なスタックトレースやデバッグ情報が得られます。

一般的なトラブルシューティング手順：
1.  **AWS SSOログインの確認**: `aws sso login --profile <your-profile>` が実行済みであるか。
2.  **環境変数の確認**: `.env` ファイルに必要なAPIキー（Cloudflare, Vercelなど）が正しく設定されているか。
3.  **CDKスタックの状態**: 関連するAWSリソース（Cognito, API Gatewayなど）がCDKによって正しくデプロイされているか。`CdkNotDeployedError` が発生した場合は、エラーメッセージに従って必要なCDKスタックをデプロイしてください。
4.  **IAM権限**: スクリプト実行に必要なIAM権限がプロファイルに付与されているか。
5.  **`constants.js` の設定**: APIエンドポイントや固定値が現在の環境に対して正しいか。

---
**最終更新日**: (ここに手動で日付を挿入)
**バージョン**: (スクリプトのバージョンに合わせる)
