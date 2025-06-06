# update-env.js ドキュメント

## 🎯 概要

**update-env.js** は、AWS環境の設定を自動取得してNext.jsアプリケーションの `.env.local` ファイルを更新するNode.jsスクリプトです。PowerShellスクリプト `update-cognito-env.ps1` のNode.js版として開発されました。

---

## 🚀 インストール・セットアップ

### 1. 依存関係のインストール

```bash
cd cdk/scripts
pnpm install --ignore-workspace
```

**注意:** pnpm workspaceの干渉を避けるため `--ignore-workspace` フラグが必要です。

### 2. 必要な依存関係

```json
{
  "@aws-sdk/client-cloudformation": "^3.695.0",
  "@aws-sdk/client-cognito-identity-provider": "^3.695.0", 
  "commander": "^12.1.0"
}
```

---

## 📖 使用方法

### 基本的な使用法

```bash
# 基本実行（選択プロンプト表示）
node update-env.js --profile poruru

# 自動承認モード
node update-env.js --profile poruru --require-approval never

# カスタム設定
node update-env.js --profile poruru --region us-west-2 --env-file custom.env

# デバッグモード
node update-env.js --profile poruru --debug
```

### 📋 コマンドライン引数

| 引数 | 必須 | デフォルト | 説明 |
|------|------|------------|------|
| `-p, --profile <profile>` | ✅ | なし | AWS SSOプロファイル名 |
| `-r, --region <region>` | ❌ | プロファイルデフォルト | AWS リージョン |
| `-f, --env-file <file>` | ❌ | `.env.local` | 環境ファイルパス |
| `--require-approval <type>` | ❌ | `always` | 承認要求 (`always`/`never`) |
| `--debug` | ❌ | false | デバッグ出力を有効化 |
| `-h, --help` | ❌ | なし | ヘルプを表示 |

---

## 🔧 機能詳細

### 1. **AWS環境検出**

自動的にCloudFormationスタックを検索し、Sankeyプロジェクトの環境を検出します。

**検索パターン:**
- `Sankey{Environment}AuthStack` (例: `SankeyDevAuthStack`)
- `Sankey{Environment}ApiStack` (例: `SankeyDevApiStack`)

**対応環境:**
- `Dev` (開発環境)
- `Staging` (ステージング環境)  
- `Prod` (本番環境)

### 2. **設定値自動取得**

**CloudFormation Outputs から取得:**
- `UserPoolId` - Cognito User Pool ID
- `UserPoolClientId` - Cognito Client ID
- `UserPoolDomainUrl` - Cognito Domain URL (オプション)
- `ApiEndpoint` - API Gateway エンドポイント

**Cognito API から取得:**
- `ClientSecret` - Cognito Client Secret
- Logout URLs, Callback URLs

### 3. **.env.local 自動更新**

**自動生成・更新される設定:**

```bash
# API Endpoint設定
NEXT_PUBLIC_API_ENDPOINT=https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod

# Cognito設定
COGNITO_CLIENT_ID=1pia2iv7ekqdrin3dm0mg5fqmm
COGNITO_CLIENT_SECRET=7mqrv50n...
COGNITO_ISSUER=https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_9e9NHTAkW

# Cognito Logout設定 (Domain設定時のみ)
NEXT_PUBLIC_COGNITO_DOMAIN=https://sankey-auth-dev.auth.ap-northeast-1.amazoncognito.com
NEXT_PUBLIC_COGNITO_CLIENT_ID=1pia2iv7ekqdrin3dm0mg5fqmm
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Auth.js設定 (自動生成)
AUTH_SECRET="ランダム生成された文字列"
NEXTAUTH_URL=http://localhost:3000
```

---

## 💡 実行例

### 例1: 通常の実行

```bash
$ node update-env.js --profile poruru

ℹ 🚀 SanKey Environment Updater
ℹ 📧 Profile: poruru
ℹ 🌍 Region: Using profile default
ℹ 📁 Env file: .env.local
ℹ 🔧 Initializing AWS clients...
✅ AWS clients initialized successfully
ℹ 🔍 Searching for Sankey stacks...
✅ Found 1 stack combination(s):

📋 Available Stack Combinations:
1. DEV Environment
   Auth Stack: SankeyDevAuthStack (CREATE_COMPLETE)
   API Stack:  SankeyDevApiStack (CREATE_COMPLETE)

ℹ 🎯 Selecting stack combination...
Please select a combination (1-1): 1
✅ Selected: DEV Environment
ℹ 📋 Retrieving configuration values...
ℹ 🔐 Retrieving Cognito client details...
✅ Configuration values retrieved:
   API Endpoint: https://r34k1ss01a.execute-api.ap-northeast-1.amazonaws.com/prod
   Cognito Client ID: 1pia2iv7ekqdrin3dm0mg5fqmm
   Cognito Client Secret: 7mqrv50n...
   Cognito Issuer: https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_9e9NHTAkW
   Cognito Domain: https://sankey-auth-dev.auth.ap-northeast-1.amazoncognito.com
ℹ 📝 Updating .env.local file...
✅ Updated .env.local file: /path/to/.env.local
✅ 🎉 Environment configuration updated successfully!

📋 Next Steps:
   1. Restart your Next.js application: npm run dev
   2. Verify the configuration in your app
```

### 例2: 自動承認モード

```bash
$ node update-env.js --profile poruru --require-approval never

ℹ 🚀 SanKey Environment Updater
ℹ 📧 Profile: poruru
ℹ 🌍 Region: Using profile default
ℹ 📁 Env file: .env.local
ℹ 🔧 Initializing AWS clients...
✅ AWS clients initialized successfully
ℹ 🔍 Searching for Sankey stacks...
✅ Found 1 stack combination(s):

📋 Available Stack Combinations:
1. DEV Environment
   Auth Stack: SankeyDevAuthStack (CREATE_COMPLETE)
   API Stack:  SankeyDevApiStack (CREATE_COMPLETE)

ℹ 🎯 Selecting stack combination...
ℹ 🚀 Auto-selecting: DEV Environment
# 以下同様...
```

---

## ⚠️ トラブルシューティング

### 1. **AWS SSO Token期限切れ**

```bash
❌ Error: Failed to fetch CloudFormation stacks: Token is expired
⚠️ Make sure you have run: aws sso login --profile poruru
```

**解決方法:**
```bash
aws sso login --profile poruru
```

### 2. **スタックが見つからない**

```bash
❌ No Sankey stacks found. Please check:
❌ - Stack naming convention: Sankey{Environment}{Type}Stack
❌ - AWS region and profile settings
```

**確認事項:**
- CDKスタックがデプロイされているか
- スタック名が正しい命名規則に従っているか
- AWS リージョンが正しいか

### 3. **Client Secret未設定**

```bash
❌ Error: Cognito Client Secret not found. Make sure the User Pool Client has a secret generated.
```

**解決方法:**
AWS Cognitoコンソールで User Pool Client の設定を確認し、Client Secret を生成してください。

### 4. **pnpm workspace干渉**

```bash
Error: Cannot find module 'commander'
```

**解決方法:**
```bash
cd cdk/scripts
pnpm install --ignore-workspace
```

---

## 🔒 セキュリティ考慮事項

### 1. **機密情報の取り扱い**

- Client Secret はマスクされて表示されます
- .env.local ファイルは `.gitignore` に含めてください
- AWS認証情報は環境変数・プロファイルで管理

### 2. **権限要件**

**必要なAWS権限:**
- `cloudformation:DescribeStacks`
- `cognito-idp:DescribeUserPoolClient`
- `cognito-idp:DescribeUserPool`

---

## 🛠️ 設定ファイル

### .npmrc
```ini
# pnpm workspace から除外
ignore-workspace=true
```

### package.json (cdk/scripts/)
```json
{
  "name": "@sankey/scripts",
  "private": true,
  "scripts": {
    "update-env": "node update-env.js"
  }
}
```

---

## 📈 PowerShellスクリプトからの改善点

### ✅ 改善された機能

1. **環境依存解決** - スタック名の自動検出
2. **クロスプラットフォーム** - Windows/Mac/Linux対応
3. **型安全性** - TypeScript風エラーハンドリング
4. **モダンなパッケージ管理** - pnpm対応
5. **CI/CD対応** - `--require-approval never` オプション
6. **美しいUI** - 色付きログ・進捗表示

### 🔄 移行完了

- ❌ `update-cognito-env.ps1` (削除推奨)
- ✅ `update-env.js` (置き換え完了)

---

## 📝 今後の拡張予定

- [ ] 複数リージョン対応
- [ ] 設定ファイルテンプレート機能
- [ ] バックアップ・ロールバック機能
- [ ] CI/CD パイプライン統合

---

**このドキュメントでupdate-env.jsの全機能・使用方法が網羅されています。**