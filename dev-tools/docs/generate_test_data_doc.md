# SanKey Test Data Generator ガイド

## 📖 概要

`generate-test-data.js` は、SanKey アプリケーションの開発・テスト環境でダミーデータを自動生成するためのNode.jsスクリプトです。DynamoDBテーブルにEAライセンス申請のテストデータを効率的に作成・管理できます。

## 🎯 主な機能

- **ダミーデータ生成**: リアルなEAライセンス申請データの自動生成
- **データ削除**: 既存テストデータの完全削除
- **リセット機能**: 削除と生成を同時実行
- **ステータス制御**: 5種類のライセンスステータスに対応
- **バッチ処理**: DynamoDB制限に対応した効率的な書き込み
- **エラー復旧**: 未処理アイテムの自動リトライ機能

## 📋 前提条件

### 必要なソフトウェア
- Node.js 18.0.0 以上
- AWS CLI がインストールされていること
- AWS SSO でログイン済みであること

### 必要なAWS権限
- CloudFormation スタックの読み取り権限
- Cognito UserPool へのアクセス権限
- DynamoDB テーブルへの読み書き権限

### AWS環境
- SankeyDevAuthStack (CREATE_COMPLETE)
- SankeyDevApiStack (CREATE_COMPLETE)  
- SankeyDevDbStack (CREATE_COMPLETE)

## 🚀 クイックスタート

### 1. AWS SSO ログイン
```bash
aws sso login --profile poruru
```

### 2. 基本的な使用法
```bash
# デフォルト実行（5件のPendingデータを生成）
node generate-test-data.js --profile poruru

# npm スクリプト経由
pnpm run generate-data -- --profile poruru
```

## 📚 使用方法

### 基本コマンド構文
```bash
node generate-test-data.js [options]
```

### 必須オプション
| オプション | 短縮形 | 説明 | 例 |
|-----------|-------|------|-----|
| `--profile` | `-p` | AWS SSO プロファイル名 | `--profile poruru` |

### オプション一覧

| オプション | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `--region` | string | プロファイルデフォルト | AWS リージョン |
| `--email` | string | "poruru.inv@gmail.com" | Cognito検索用メールアドレス |
| `--user-id` | string | - | 直接UserID指定（メール検索をスキップ） |
| `--count` | number | 5 | 生成するレコード数 |
| `--status` | string | "Pending" | ステータス固定 |
| `--dummy-email` | string | - | ダミーデータ用メールアドレス |
| `--use-real-email` | boolean | true | 実際のメールアドレスを使用 |
| `--delete` | boolean | false | 既存データを削除（生成なし） |
| `--reset` | boolean | false | 既存データを削除後に生成 |
| `--require-approval` | string | "always" | ユーザー選択の承認設定 |
| `--debug` | boolean | false | デバッグ出力を有効化 |

### ステータス種類

| ステータス | 説明 | 追加フィールド |
|-----------|------|---------------|
| `Pending` | 申請中・承認待ち | - |
| `Active` | 有効なライセンス | `approvedAt`, `expiresAt`, `licenseKey` |
| `Expired` | 期限切れライセンス | `approvedAt`, `expiresAt`, `licenseKey` |
| `Rejected` | 申請却下 | - |
| `Revoked` | ライセンス取り消し | `approvedAt`, `revokedAt`, `licenseKey` |
| `Random` | 重み付きランダム選択 | ステータスに応じて変動 |

## 💡 使用例

### 基本的な生成パターン

#### デフォルト実行
```bash
node generate-test-data.js --profile poruru
```
- 5件のPendingステータス
- 実際のメールアドレス使用
- 既存データに追加

#### ステータス指定
```bash
# 有効ライセンスを3件生成
node generate-test-data.js --profile poruru --status Active --count 3

# 期限切れライセンスを2件生成
node generate-test-data.js --profile poruru --status Expired --count 2

# ランダムステータスで10件生成
node generate-test-data.js --profile poruru --status Random --count 10
```

### データ管理パターン

#### 削除のみ
```bash
# 既存データをすべて削除（生成なし）
node generate-test-data.js --profile poruru --delete
```

#### リセット（削除 + 生成）
```bash
# クリーンな状態から5件生成
node generate-test-data.js --profile poruru --reset --count 5

# 異なるステータスでリセット
node generate-test-data.js --profile poruru --reset --status Active --count 3
```

### メール設定パターン

#### 実際のメールアドレス使用
```bash
# デフォルト（既に有効）
node generate-test-data.js --profile poruru --use-real-email
```

#### ダミーメールアドレス使用
```bash
# 指定したダミーメールを全データに使用
node generate-test-data.js --profile poruru --dummy-email "test@example.com" --count 5
```

#### ランダムダミーメール
```bash
# --use-real-email を無効にしてランダム生成
node generate-test-data.js --profile poruru --count 5
# ※現在のデフォルトは --use-real-email=true のため要調整
```

### 高度な使用例

#### 大量データ生成
```bash
# 100件の大量テストデータ
node generate-test-data.js --profile poruru --reset --count 100 --debug
```

#### 直接UserID指定
```bash
# メール検索をスキップして高速化
node generate-test-data.js --profile poruru --user-id "e764aa58-f0d1-70a7-69ae-04aef2d3a650" --count 10
```

#### 別リージョンでの実行
```bash
node generate-test-data.js --profile dev-profile --region us-west-2 --count 5
```

## 🚫 禁止されている組み合わせ

以下のオプション組み合わせはエラーになります：

```bash
# ❌ --delete と --count の同時指定
node generate-test-data.js --profile poruru --delete --count 5
# エラー: --delete option cannot be used with --count. Use --reset instead.

# ❌ --delete と --reset の同時指定  
node generate-test-data.js --profile poruru --delete --reset
# エラー: --delete and --reset cannot be used together.
```

## 📊 生成データの詳細

### 基本フィールド構造
```json
{
  "userId": "e764aa58-f0d1-70a7-69ae-04aef2d3a650",
  "sk": "APPLICATION#2025-01-15T10:30:45Z#XM Trading#1005249375#Scalping Master EA",
  "accountNumber": "1005249375",
  "eaName": "Scalping Master EA",
  "broker": "XM Trading", 
  "email": "poruru.inv@gmail.com",
  "xAccount": "@TradingMaster_fx",
  "status": "Pending",
  "appliedAt": "2025-01-15T10:30:45Z",
  "updatedAt": "2025-06-06T15:30:45Z"
}
```

### EA名サンプル
- Scalping Master EA
- Trend Follower Pro
- Grid Trading Bot
- News Trading EA
- Arbitrage Hunter
- Breakout Warrior
- Swing Master EA
- Martingale Pro
- Hedge Fund EA
- Fibonacci Trader

### ブローカーサンプル
- XM Trading
- FXGT
- TitanFX
- IC Markets
- Exness
- AXIORY
- BigBoss
- HotForex
- FBS
- InstaForex

### ステータス別追加フィールド

#### Active ステータス
```json
{
  "approvedAt": "2025-01-16T08:15:30Z",
  "expiresAt": "2025-12-31T23:59:59Z", 
  "licenseKey": "SMP-2025-A7B3F9D1"
}
```

#### Expired ステータス
```json
{
  "approvedAt": "2024-06-15T14:20:10Z",
  "expiresAt": "2025-05-01T23:59:59Z",
  "licenseKey": "SMP-2024-C8E5A2F4"
}
```

#### Revoked ステータス
```json
{
  "approvedAt": "2024-11-20T09:45:22Z", 
  "revokedAt": "2025-02-14T16:30:15Z",
  "licenseKey": "SMP-2025-D9F6B3A7"
}
```

## ⚙️ 技術仕様

### バッチ処理
- DynamoDBの制限により25件ずつバッチ処理
- 未処理アイテムの自動リトライ（最大3回）
- 指数バックオフでリトライ間隔調整

### パフォーマンス
- 小量データ（5-10件）: 2-5秒
- 中量データ（50件）: 5-10秒  
- 大量データ（100件以上）: 10秒以上

### エラーハンドリング
- AWS認証エラーの検出
- ネットワークエラーの自動リトライ
- 不正なオプション組み合わせの事前チェック
- わかりやすいエラーメッセージ

## 🔧 トラブルシューティング

### よくあるエラーと解決方法

#### AWS SSO ログインエラー
```
Error: Failed to initialize AWS clients
```
**解決方法:**
```bash
aws sso login --profile poruru
```

#### ユーザーが見つからない
```
User not found with email: example@gmail.com
```
**解決方法:**
- メールアドレスが正しいか確認
- 出力された利用可能ユーザー一覧から正しいメールを選択
- `--user-id` オプションで直接UserIDを指定

#### DynamoDBアクセスエラー
```
Failed to delete user data: AccessDeniedException
```
**解決方法:**
- IAM権限の確認（`dynamodb:Query`, `dynamodb:BatchWriteItem`）
- AWS SSO ログインの再実行
- プロファイル設定の確認

#### スタックが見つからない
```
No Sankey stacks found
```
**解決方法:**
- 正しいリージョンでの実行確認
- CloudFormationスタックの存在確認
- スタック名がパターンに一致するか確認

### パフォーマンス最適化

#### 高速化のコツ
1. **UserID直接指定**: メール検索をスキップ
   ```bash
   node generate-test-data.js --profile poruru --user-id "xxx" --count 50
   ```

2. **デバッグ無効**: 本番では --debug を外す

3. **バッチサイズ最適化**: 25件単位で処理するため、25の倍数が効率的

## 📝 ログ出力例

### 正常実行時
```
=== SanKey Dummy Data Generator ===
ℹ 📧 Profile: poruru
ℹ 🌍 Region: Using profile default  
👤 📧 Email: poruru.inv@gmail.com
ℹ 📊 Records: 5
📧 📧 Using real email address: poruru.inv@gmail.com
ℹ 📊 Status: Pending (default)
ℹ 🔧 Initializing AWS clients...
✅ AWS clients initialized successfully
ℹ 🔍 Searching for Sankey stacks...
✅ Found 1 stack combination(s):
📋 Available Stack Combinations:
1. DEV Environment
   Auth Stack: SankeyDevAuthStack (CREATE_COMPLETE)
   API Stack:  SankeyDevApiStack (CREATE_COMPLETE)
   DB Stack:   SankeyDevDbStack (CREATE_COMPLETE)
ℹ 🎯 Selecting stack combination...
✅ Selected: DEV Environment
ℹ 🔍 Retrieving DynamoDB table name...
✅ Table Name: sankey-applications-dev
ℹ 🔍 Retrieving UserPool ID...
✅ UserPool ID: ap-northeast-1_9e9NHTAkW
🔍 Looking up user by email: poruru.inv@gmail.com
✅ User ID: e764aa58-f0d1-70a7-69ae-04aef2d3a650
🎲 Generating 5 dummy records...
  Progress [████████████████████] 100% (5/5)
ℹ Generated 5 dummy records in 1ms
📊 Writing 5 items to DynamoDB in 1 batch(es)...
ℹ Batch write completed: 5/5 items succeeded in 788ms
🎉 🎉 All 5 items inserted successfully!
ℹ 🎉 Operation completed in 9.9s
```

### 削除実行時
```
=== SanKey Dummy Data Generator ===
⚠️ 🗑️ Delete mode: Will delete all existing data (no generation)
📊 🔍 Scanning existing data for user: e764aa58-f0d1-70a7-69ae-04aef2d3a650
⚠️ Found 15 existing items for this user
📊 🗑️ Deleting 15 items in 1 batch(es)...
ℹ Deleted 15/15 items in 776ms
✅ 🗑️ Deleted 15 existing items
🎉 🎉 Delete operation completed
ℹ 🎉 Operation completed in 5.3s
```

## 🔗 関連ドキュメント

- [SanKey プロジェクト概要](../README.md)
- [update-env.js ガイド](./update-env-guide.md)
- [AWS CDK設定ガイド](../cdk/README.md)
- [共通ライブラリリファレンス](./lib/README.md)

## 📞 サポート

問題が発生した場合は、以下の情報を含めて報告してください：

1. 実行したコマンド
2. エラーメッセージの全文
3. AWS環境情報（リージョン、スタック状態）
4. Node.js バージョン（`node --version`）
5. 実行ログ（`--debug` オプション付き）

---

**更新日**: 2025年6月6日  
**バージョン**: 1.0.0  
**作成者**: SanKey Development Team