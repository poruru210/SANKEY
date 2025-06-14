import { FormData } from './config';
import { getConfig } from './config-manager';
import { sendWebhook } from './webhook';
import { recordToSpreadsheet } from './spreadsheet';

/**
 * フォーム送信時の処理（トリガー用）
 */
export function onFormSubmit(e: any): void {
  try {
    console.log('フォーム送信を検知しました');
    const config = getConfig();

    // フォームの回答データを取得
    const formData: FormData = {
      eaName: e.namedValues[config.FORM_FIELDS.EA_NAME.label]?.[0] || '',
      accountNumber: e.namedValues[config.FORM_FIELDS.ACCOUNT_NUMBER.label]?.[0] || '',
      broker: e.namedValues[config.FORM_FIELDS.BROKER.label]?.[0] || '',
      email: e.namedValues[config.FORM_FIELDS.EMAIL.label]?.[0] || '',
      xAccount: e.namedValues[config.FORM_FIELDS.X_ACCOUNT.label]?.[0] || ''
    };

    console.log('フォームデータ:', formData);

    // Webhookを送信
    const result = sendWebhook(formData);

    // 結果を記録
    recordToSpreadsheet(formData, result.response);

    if (result.success) {
      console.log('✅ フォーム処理成功');
    } else {
      console.error('❌ フォーム処理失敗:', result.error);
    }

  } catch (error) {
    console.error('❌ onFormSubmitエラー:', error);
  }
}
