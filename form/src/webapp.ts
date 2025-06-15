import {
  IntegrationTestRequest,
  SankeyNotificationRequest,
  PostRequestData,
} from './types';
import { triggerIntegrationTest, onSankeyNotification } from './integration';

/**
 * WebアプリのPOSTリクエスト処理（修正版）
 * - SANKEYからの通知受信
 * - 統合テスト実行（testId必須）
 */
export function doPost(
  e: GoogleAppsScript.Events.DoPost
): GoogleAppsScript.Content.TextOutput {
  try {
    console.log('POSTリクエストを受信しました');

    if (!e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(
        JSON.stringify({
          success: false,
          error: 'No POST data received',
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // リクエストデータを解析
    const requestData = JSON.parse(e.postData.contents) as PostRequestData;
    console.log('受信データ:', requestData);

    // 統合テストリクエストかどうかを判定
    if ('action' in requestData && requestData.action === 'integration_test') {
      const integrationRequest = requestData as IntegrationTestRequest;
      console.log('統合テスト実行リクエストを受信:', {
        testId: integrationRequest.testId,
        timestamp: integrationRequest.timestamp,
      });

      // testIdの必須検証
      if (!integrationRequest.testId) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: false,
            error: 'testId is required for integration test',
          })
        ).setMimeType(ContentService.MimeType.JSON);
      }

      // 統合テスト実行（サーバー側testIdを厳密に使用）
      const result = triggerIntegrationTest(integrationRequest.testId);

      return ContentService.createTextOutput(
        JSON.stringify(result)
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // SANKEYからの通知として処理
    const notificationRequest = requestData as SankeyNotificationRequest;
    console.log('SANKEYからの通知として処理します');
    const result = onSankeyNotification(notificationRequest);

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
      ContentService.MimeType.JSON
    );
  } catch (error) {
    console.error('doPost処理エラー:', error);
    return ContentService.createTextOutput(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.toString() : String(error),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
