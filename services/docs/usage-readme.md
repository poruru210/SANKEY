# 改善版ライセンスサービス使用方法

## アーキテクチャ概要

このシステムは以下の特徴を持ちます：

1. **Cognito認証**: すべてのAPI呼び出しにCognito認証が必要
2. **ユーザー毎のAPI Key**: 各ユーザーに固有のAPI Keyを発行
3. **個別Usage Plan**: ユーザー毎にレート制限を適用（10 req/s, 1000 req/day）
4. **ユーザー毎のマスターキー**: 各ユーザーに固有の暗号化キーを生成

## 無料枠での運用

- **Cognito**: 月間50,000 MAU（月間アクティブユーザー）まで無料
- **API Gateway**: 月間100万リクエストまで無料
- **Lambda**: 月間100万リクエスト、400,000 GB-秒まで無料
- **SSM Parameter Store**: 標準パラメータは10,000個まで無料

## セットアップ手順

### 1. デプロイ

```bash
cd services
pnpm install
pnpm build
pnpm deploy
```

### 2. 管理者ユーザーの作成

AWS ConsoleからCognito User Poolにアクセスし、管理者グループ（admin）を作成後、管理者ユーザーを追加。

### 3. ユーザーの作成（管理者権限）

```bash
# 管理者として認証
aws cognito-idp admin-initiate-auth \
  --user-pool-id <USER_POOL_ID> \
  --client-id <CLIENT_ID> \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME=admin@example.com,PASSWORD=<PASSWORD>

# ユーザー作成
curl -X POST https://<API_ENDPOINT>/admin/users \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "x-api-key: <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "accountId": "12345",
    "temporaryPassword": "TempPass123!"
  }'
```

## 使用方法

### 1. ユーザー認証

```bash
# 初回ログイン（パスワード変更が必要）
aws cognito-idp admin-initiate-auth \
  --user-pool-id <USER_POOL_ID> \
  --client-id <CLIENT_ID> \
  --auth-flow ADMIN_NO_SRP_AUTH \
  --auth-parameters USERNAME=user@example.com,PASSWORD=TempPass123!

# 新しいパスワードを設定
aws cognito-idp admin-respond-to-auth-challenge \
  --user-pool-id <USER_POOL_ID> \
  --client-id <CLIENT_ID> \
  --challenge-name NEW_PASSWORD_REQUIRED \
  --challenge-responses USERNAME=user@example.com,NEW_PASSWORD=NewPass123! \
  --session <SESSION_FROM_PREVIOUS_RESPONSE>
```

### 2. ライセンス生成

```bash
# API Keyの取得（AWS Console or CLI）
aws apigateway get-api-keys --query "items[?tags.userId=='<USER_ID>'].value" --output text

# ライセンス生成リクエスト
curl -X POST https://<API_ENDPOINT>/generate \
  -H "Authorization: Bearer <ID_TOKEN>" \
  -H "x-api-key: <USER_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "eaName": "MyEA",
    "expiry": "2024-12-31T23:59:59Z"
  }'
```

### レスポンス例

```json
{
  "license": "BASE64_ENCODED_LICENSE_STRING",
  "issuedAt": "2024-01-15T10:30:00Z",
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

## セキュリティ考慮事項

1. **二重認証**: Cognito認証 + API Key
2. **レート制限**: ユーザー毎に個別制限
3. **暗号化**: ユーザー毎の固有キーで暗号化
4. **監査**: CloudWatch Logsで全APIアクセスを記録

## 料金見積もり（月間）

- ユーザー数: 100人
- API呼び出し: 各ユーザー100回/月 = 10,000回
- **推定料金**: $0（すべて無料枠内）

## トラブルシューティング

### API Keyが取得できない