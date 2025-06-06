# EA License Application - Google Apps Script 設定マニュアル

## 1. 事前準備

### 1.1 必要な情報を入手

システム管理者から以下の情報を入手してください：

- **API Gateway URL**: `https://xxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/applications/webhook`
- **User ID**: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`  
- **Master Key**: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`（Base64形式）

### 1.2 Googleフォームの準備

申請フォームに以下の質問項目を作成してください：

| 質問項目 | 必須 | 回答例 |
|---------|------|--------|
| EA名 | ✓ | MyTradingEA v1.0 |
| アカウント番号 | ✓ | 1234567890 |
| ブローカー名 | ✓ | XM Trading |
| メールアドレス | ✓ | user@example.com |
| Xアカウント名 | ✓ | @username |

## 2. Google Apps Script の作成

### 2.1 新しいプロジェクトを作成

1. [Google Apps Script](https://script.google.com) にアクセス
2. 「新しいプロジェクト」をクリック
3. プロジェクト名を「EA License Application」に変更

### 2.2 コードファイルの準備

1. 左側のファイル一覧で「コード.gs」を削除
   - 「コード.gs」の右側の「⋮」をクリック → 「削除」
2. 「+」ボタンをクリック → 「スクリプト」を選択
3. ファイル名を「webhook」に変更

### 2.3 コードの貼り付け

提供されたスクリプトコード全体をコピーして貼り付けてください。

### 2.4 設定値の入力

コードの上部にある `CONFIG` セクションを実際の値に変更してください：

```javascript
var CONFIG = {
  // ここに実際の値を入力
  WEBHOOK_URL: "実際のAPI Gateway URL",
  USER_ID: "実際のUser ID",
  MASTER_KEY: "実際のMaster Key",
  
  // フォームの質問項目名（実際の質問文に合わせて変更）
  FORM_FIELDS: {
    EA_NAME: "EA名",
    ACCOUNT_NUMBER: "アカウント番号", 
    BROKER: "ブローカー名",
    EMAIL: "メールアドレス",
    X_ACCOUNT: "Xアカウント名"
  }
};
```

**重要**: サンプル値（`your-api`、`xxxx`、`your-`等）が残っていないことを確認してください。

### 2.5 FORM_FIELDS の調整

実際のGoogleフォームの質問文に合わせて調整してください：

**例：フォームの質問が「あなたのEA名を入力してください」の場合**
```javascript
FORM_FIELDS: {
  EA_NAME: "あなたのEA名を入力してください",
  // ...
}
```

## 3. 設定テスト

### 3.1 設定値の確認

1. 上部メニューの「実行」をクリック
2. 「関数を実行」→「validateConfig」を選択
3. 実行後、下部の「実行ログ」で「✅ 設定は正常です」が表示されることを確認

**エラーが出た場合**: CONFIG セクションの設定値を再確認してください。

### 3.2 通信テスト

1. 「実行」→「関数を実行」→「testWebhook」を選択
2. 実行後、「実行ログ」で「✅ テスト成功」が表示されることを確認

**エラーが出た場合**: システム管理者に設定値を再確認してください。

## 4. フォームとの連携設定

### 4.1 権限の許可

初回実行時に権限許可画面が表示されます：

1. 「権限を確認」をクリック
2. Googleアカウントを選択
3. 「詳細」をクリック
4. 「EA License Application（安全ではないページ）に移動」をクリック
5. 「許可」をクリック

### 4.2 トリガーの設定

1. 左側メニューの「トリガー」（時計アイコン）をクリック
2. 「トリガーを追加」をクリック
3. 以下の設定を入力：

| 項目 | 設定値 |
|------|--------|
| 実行する関数 | onFormSubmit |
| 実行するデプロイ | Head |
| イベントのソース | フォームから |
| イベントの種類 | フォーム送信時 |
| エラー通知設定 | 今すぐ通知を受け取る |

4. 「保存」をクリック

### 4.3 フォームの関連付け

1. Googleフォームを開く
2. 右上の「⋮」→「スクリプト エディタ」をクリック
3. 先ほど作成したApps Scriptプロジェクトが開くことを確認

**または**

1. Apps Scriptで上部の「トリガー」→「トリガーを追加」
2. 「イベントのソース」で「フォームから」を選択
3. 対象のフォームを選択

## 5. 動作確認

### 5.1 本番テスト

1. 実際のGoogleフォームからテストデータを送信
2. Apps Scriptの「実行ログ」を確認
3. 「Webhook送信成功」のメッセージが表示されることを確認

### 5.2 エラー確認方法

エラーが発生した場合：

1. Apps Scriptの「実行ログ」でエラー内容を確認
2. エラーメッセージをシステム管理者に報告

## 6. オプション設定

### 6.1 メール通知の有効化

申請成功時やエラー時にメール通知を送信したい場合：

1. `sendSuccessNotification` 関数内の以下の行を有効化：
```javascript
// GmailApp.sendEmail(formData.email, subject, body);
```
↓ コメントアウトを削除
```javascript
GmailApp.sendEmail(formData.email, subject, body);
```

2. `sendErrorNotification` 関数内の以下の行を有効化：
```javascript
// GmailApp.sendEmail('admin@example.com', subject, body);
```
↓ 管理者メールアドレスを設定してコメントアウトを削除
```javascript
GmailApp.sendEmail('your-admin@example.com', subject, body);
```

### 6.2 Gmail権限の追加

メール送信を有効にした場合、初回実行時にGmail権限の許可が必要です。

## 7. トラブルシューティング

### 7.1 よくあるエラー

| エラーメッセージ | 対処法 |
|-----------------|--------|
| `❌ 設定が不正です` | CONFIG の設定値を確認 |
| `❌ テスト失敗: HTTP 400` | システム管理者に設定値を確認 |
| `❌ テスト失敗: HTTP 401` | Master Key が正しくない可能性 |
| `ReferenceError: CONFIG is not defined` | コード全体が正しく貼り付けられていない |
| `onFormSubmit is not defined` | 関数名が正しくない、またはコードに問題 |

### 7.2 ログの確認方法

1. Apps Script エディタで「実行」→「実行ログ」
2. エラーの詳細や実行状況を確認
3. 必要に応じてシステム管理者に報告

### 7.3 設定の再確認

問題が解決しない場合、以下を順番に確認：

1. **設定値**: CONFIG セクションの値が正しいか
2. **フォーム項目**: FORM_FIELDS がフォームの質問文と一致しているか
3. **トリガー**: フォーム送信時のトリガーが正しく設定されているか
4. **権限**: 必要な権限が許可されているか

## 8. 完了確認

以下がすべて完了していることを確認してください：

- [ ] CONFIG セクションに正しい設定値を入力
- [ ] validateConfig テストが成功
- [ ] testWebhook テストが成功  
- [ ] フォーム送信時のトリガーを設定
- [ ] 実際のフォーム送信でのテストが成功

すべて完了すれば、EA申請システムの運用開始準備が整いました。

---

**サポートが必要な場合**

問題が発生した場合は、以下の情報と共にシステム管理者にお問い合わせください：
- エラーメッセージの全文
- Apps Script の実行ログ
- 使用しているフォームの質問項目一覧