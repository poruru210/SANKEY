import { FormData, LicenseData } from './config';
import { getConfig } from './config-manager';

/**
 * シート取得または作成（Google Form連携版）
 */
export function getOrCreateSheet(sheetName: string): GoogleAppsScript.Spreadsheet.Sheet | null {
  try {
    let spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet | null = null;
    const config = getConfig();

    // 方法1: Formに紐づいたスプレッドシートを取得（推奨）
    try {
      // アクティブなフォームを取得
      const form = FormApp.getActiveForm();
      if (form) {
        // フォームの送信先スプレッドシートIDを取得
        const destinationId = form.getDestinationId();
        if (destinationId) {
          spreadsheet = SpreadsheetApp.openById(destinationId);
          console.log('フォームに紐づいたスプレッドシートを使用:', destinationId);
        } else {
          console.log('フォームにスプレッドシートが紐づいていません');
        }
      }
    } catch (formError) {
      console.log('フォーム連携スプレッドシート取得エラー:', formError);
    }

    // 方法2: 手動で設定されたスプレッドシートIDを使用
    const spreadsheetId = (config.FORM_FIELDS as any).SPREADSHEET_ID;
    if (!spreadsheet && spreadsheetId && spreadsheetId.trim() !== '') {
      try {
        spreadsheet = SpreadsheetApp.openById(spreadsheetId.trim());
        console.log('設定されたスプレッドシートIDを使用:', spreadsheetId);
      } catch (openError) {
        console.error('スプレッドシートIDが無効です:', openError);
      }
    }

    // 方法3: 現在のスプレッドシートを取得（スクリプトエディタから実行時）
    if (!spreadsheet) {
      try {
        spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
        if (spreadsheet) {
          console.log('アクティブなスプレッドシートを使用');
        }
      } catch (activeError) {
        console.log('アクティブスプレッドシート取得エラー:', activeError);
      }
    }

    // 方法4: 新しいスプレッドシートを作成（最終手段）
    if (!spreadsheet) {
      try {
        console.log('新しいスプレッドシートを作成します...');
        spreadsheet = SpreadsheetApp.create('EA License Integration Test Data - ' + new Date().toISOString());

        console.log('✅ 新規スプレッドシート作成成功:', {
          spreadsheetId: spreadsheet.getId(),
          url: spreadsheet.getUrl(),
          message: 'フォームの回答の送信先をこのスプレッドシートに設定することを推奨します'
        });
      } catch (createError) {
        console.error('スプレッドシート作成エラー:', createError);
        return null;
      }
    }

    // シートを取得または作成
    if (spreadsheet) {
      let sheet: GoogleAppsScript.Spreadsheet.Sheet | null = null;

      // 既存のシートを探す
      try {
        sheet = spreadsheet.getSheetByName(sheetName);
        if (sheet) {
          console.log('既存のシートを使用:', sheetName);
        }
      } catch (e) {
        console.log('シート検索エラー:', e);
      }

      // シートが見つからない場合は作成
      if (!sheet) {
        try {
          sheet = spreadsheet.insertSheet(sheetName);
          console.log('新しいシートを作成しました:', sheetName);
        } catch (insertError) {
          console.error('シート作成エラー:', insertError);

          // フォームの回答シートがある場合は、それとは別のシートを作成
          try {
            const sheets = spreadsheet.getSheets();
            if (sheets && sheets.length > 0) {
              // 最後のシートの後に新規シート追加
              const lastIndex = sheets.length;
              sheet = spreadsheet.insertSheet(sheetName, lastIndex);
              console.log('シートを最後に追加しました:', sheetName);
            }
          } catch (fallbackError) {
            console.error('シート追加のフォールバックも失敗:', fallbackError);
            return null;
          }
        }
      }

      return sheet;
    }

    return null;

  } catch (error) {
    console.error('getOrCreateSheet完全エラー:', error);
    return null;
  }
}

/**
 * スプレッドシートに申請データを記録
 */
export function recordToSpreadsheet(formData: FormData, responseData: any): void {
  try {
    const sheet = getOrCreateSheet('EA_APPLICATIONS');

    // シートが取得できない場合はスキップ
    if (!sheet) {
      console.warn('スプレッドシートへの記録をスキップします');
      return;
    }

    // ヘッダー行の確認・作成
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 8).setValues([[
        '申請日時', 'EA名', 'ブローカー', '口座番号', 'メール', 'Xアカウント', '申請ID', '一時URL'
      ]]);
    }

    // データ行の追加
    const timestamp = new Date().toLocaleString('ja-JP');
    let applicationId = '';
    let temporaryUrl = '';

    if (responseData && responseData.data) {
      applicationId = responseData.data.applicationId || '';
      temporaryUrl = responseData.data.temporaryUrl || '';
    }

    sheet.appendRow([
      timestamp,
      formData.eaName,
      formData.broker,
      formData.accountNumber,
      formData.email,
      formData.xAccount,
      applicationId,
      temporaryUrl
    ]);

    console.log('スプレッドシートに記録完了:', {
      sheet: sheet.getName(),
      row: sheet.getLastRow(),
      applicationId: applicationId
    });

  } catch (error) {
    console.error('スプレッドシート記録エラー:', error);
    // エラーが発生しても処理は継続
  }
}

/**
 * ライセンス情報をスプレッドシートに記録
 */
export function recordLicenseToSpreadsheet(licenseData: LicenseData): void {
  try {
    const sheet = getOrCreateSheet('EA_LICENSES');

    // シートが取得できない場合はスキップ
    if (!sheet) {
      console.warn('スプレッドシートへの記録をスキップします');
      return;
    }

    // ヘッダー行の確認・作成
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 7).setValues([[
        '受信日時', 'ユーザーID', '申請ID', 'ライセンスID', 'ライセンス値', 'テストID', '備考'
      ]]);
    }

    // データ行の追加
    const timestamp = licenseData.receivedAt.toLocaleString('ja-JP');
    const remark = licenseData.testId ? '統合テスト' : '本番';

    sheet.appendRow([
      timestamp,
      licenseData.userId,
      licenseData.applicationId,
      licenseData.licenseId,
      licenseData.licenseValue || '',
      licenseData.testId || '',
      remark
    ]);

    console.log('ライセンス情報をスプレッドシートに記録完了:', {
      sheet: sheet.getName(),
      row: sheet.getLastRow(),
      licenseId: licenseData.licenseId,
      isTest: !!licenseData.testId
    });

  } catch (error) {
    console.error('ライセンス記録エラー:', error);
    // エラーが発生しても処理は継続
  }
}
