# 改善後のプロジェクト構造

```
services/
├── cdk/
│   ├── bin/
│   │   └── app.ts
│   ├── lib/
│   │   └── license-service-stack.ts      # 更新: Cognito追加
│   ├── test/
│   │   └── license-service-stack.test.ts # 更新: テスト追加
│   ├── jest.config.ts
│   ├── package.json
│   └── tsconfig.json
│
├── lambda/
│   ├── src/
│   │   ├── handlers/
│   │   │   ├── licenseGenerator.handler.ts    # 更新: Cognito対応
│   │   │   ├── postConfirmation.handler.ts    # 新規: Cognito Post Confirmation
│   │   │   └── createUser.handler.ts          # 新規: 管理者用API
│   │   ├── services/
│   │   │   └── encryption.ts                  # 既存: 変更なし
│   │   ├── models/
│   │   │   └── licensePayload.ts              # 更新: userId追加
│   │   └── utils/
│   │       ├── parameterStore.ts              # 既存: 変更なし
│   │       └── apiGateway.ts                  # 新規: API Gateway操作用
│   ├── tests/
│   │   └── unit/
│   │       ├── encryption.spec.ts
│   │       ├── handler.spec.ts
│   │       ├── postConfirmation.spec.ts       # 新規
│   │       └── createUser.spec.ts             # 新規
│   ├── jest.config.ts
│   ├── package.json                           # 更新: 依存関係追加
│   └── tsconfig.json
│
├── .gitattributes
├── .gitignore
├── .npmrc
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md                                  # 新規: 使用方法
```

## 新規ファイルの配置

### 1. Lambda Handlers
```bash
# Post Confirmation Handler
services/lambda/src/handlers/postConfirmation.handler.ts

# Create User Handler
services/lambda/src/handlers/createUser.handler.ts
```

### 2. ユーティリティ（必要に応じて）
```bash
# API Gateway操作用ユーティリティ
services/lambda/src/utils/apiGateway.ts
```

### 3. テストファイル
```bash
# Post Confirmation Handler のテスト
services/lambda/tests/unit/postConfirmation.spec.ts

# Create User Handler のテスト
services/lambda/tests/unit/createUser.spec.ts
```

## ファイル作成コマンド

```bash
# ディレクトリ構造を作成
cd services/lambda/src/handlers
touch postConfirmation.handler.ts
touch createUser.handler.ts

cd ../utils
touch apiGateway.ts

cd ../../tests/unit
touch postConfirmation.spec.ts
touch createUser.spec.ts
```

## CDKスタックの更新

CDKスタック（`services/cdk/lib/license-service-stack.ts`）は既存ファイルを更新します。

## 依存関係の更新

```bash
# Lambda関数の依存関係を更新
cd services/lambda
pnpm add @aws-sdk/client-cognito-identity-provider @aws-sdk/client-api-gateway

# CDKの依存関係を更新（既にaws-cdk-libに含まれているので不要）
cd ../cdk
# Cognitoは aws-cdk-lib に含まれています
```

これで、すべてのファイルが適切な場所に配置されます。