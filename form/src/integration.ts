import { FormData, NotificationData } from './config';
import { validateConfig, getGasProjectId } from './config-manager';
import { sendWebhook, notifyTestSuccess, notifyIntegrationTestCompletion } from './webhook';
import { recordLicenseToSpreadsheet } from './spreadsheet';
import { createJWT } from './jwt';

/**
 * 統合テスト用のダミー申請送信
 * 🔧 修正: testIdは必須パラメータ（冪等性保証）
 */
export function triggerIntegrationTest(testId: string): any {
  try {
    console.log('統合テストを開始します...', { testId: testId });

    if (!validateConfig()) {
      console.error('❌ 設定が不正です');
      return { success: false, error: '設定が不正です' };
    }

    // 🔧 修正: testIdは必須（サーバー側から提供される）
    if (!testId) {
      console.error('❌ testIdが必要です（サーバー側から提供される必要があります）');
      return { success: false, error: 'testId parameter is required' };
    }

    // 🔧 修正: 動的生成を削除、サーバー側testIdのみ使用
    const integrationTestId = testId;

    // 統合テスト用ダミーデータ（サーバー側と完全一致）
    const integrationTestData: FormData = {
      eaName: "Integration Test EA",
      accountNumber: "INTEGRATION_TEST_123456",
      broker: "Test Broker",
      email: "integration-test@sankey.trade",
      xAccount: "@integration_test",
      integrationTestId: integrationTestId
    };

    console.log('統合テスト用ダミーデータでWebhook送信を実行します...', {
      integrationTestId: integrationTestId
    });

    const result = sendWebhook(integrationTestData);

    if (result.success) {
      console.log('✅ 統合テスト用Webhook送信成功');

      return {
        success: true,
        message: 'Integration test application submitted successfully',
        applicationId: result.response.data ? result.response.data.applicationId : 'N/A',
        testId: integrationTestId,
        nextStep: 'Integration test will be automatically approved'
      };
    } else {
      console.log('❌ 統合テスト用Webhook送信失敗');
      return {
        success: false,
        error: 'Integration test webhook failed: ' + result.error
      };
    }

  } catch (error) {
    console.error('❌ 統合テスト中にエラー:', error);
    return { success: false, error: error instanceof Error ? error.toString() : String(error) };
  }
}

/**
 * 接続テスト（SANKEY連携テスト）
 */
export function testConnection(): any {
  try {
    console.log('接続テストを開始します...');

    // 設定値検証
    if (!validateConfig()) {
      console.error('❌ 設定が不正です');
      return { success: false, error: '設定が不正です' };
    }

    // JWT作成テスト（認証確認）
    console.log('JWT認証テストを実行します...');
    try {
      const testPayload: FormData = {
        eaName: 'Connection Test',
        accountNumber: 'TEST_CONNECTION',
        broker: 'Test',
        email: 'test@example.com',
        xAccount: '@test'
      };
      const testJwt = createJWT(testPayload);
      console.log('✅ JWT作成成功');
    } catch (jwtError) {
      console.error('❌ JWT作成失敗:', jwtError);

      // JWT作成失敗をSANKEYに通知
      notifyTestSuccess({
        success: false,
        timestamp: new Date().toISOString(),
        details: 'JWT creation failed: ' + (jwtError instanceof Error ? jwtError.toString() : String(jwtError))
      });

      return {
        success: false,
        error: 'JWT creation failed: ' + (jwtError instanceof Error ? jwtError.toString() : String(jwtError))
      };
    }

    // SANKEYにテスト成功を通知
    console.log('SANKEY認証確認を実行します...');

    const notificationResult = notifyTestSuccess({
      success: true,
      timestamp: new Date().toISOString(),
      details: 'GAS connection test completed - SANKEY configuration verified',
      gasProjectId: getGasProjectId()
    });

    if (notificationResult.success) {
      console.log('✅ 接続テスト完了');
      return {
        success: true,
        message: 'Connection test completed - SANKEY configuration verified',
        notificationResult: notificationResult.response
      };
    } else {
      console.log('❌ SANKEY通知送信失敗');
      return {
        success: false,
        error: 'SANKEY notification failed: ' + notificationResult.error
      };
    }

  } catch (error) {
    console.error('❌ テスト中にエラー:', error);

    // エラーもSANKEYに通知
    try {
      notifyTestSuccess({
        success: false,
        timestamp: new Date().toISOString(),
        details: 'GAS connection test error: ' + (error instanceof Error ? error.toString() : String(error))
      });
    } catch (notifyError) {
      console.error('通知送信もエラー:', notifyError);
    }

    return { success: false, error: error instanceof Error ? error.toString() : String(error) };
  }
}

/**
 * SANKEYからの通知処理
 */
export function onSankeyNotification(notificationData: NotificationData): any {
  try {
    console.log('SANKEY通知処理を開始します...');

    // 必須パラメータの検証
    if (!notificationData.userId || !notificationData.applicationId || !notificationData.licenseId) {
      return {
        success: false,
        error: 'Missing required parameters: userId, applicationId, licenseId'
      };
    }

    const { userId, applicationId, licenseId, licenseValue, testId } = notificationData;

    console.log('ライセンス通知詳細:', {
      userId: userId,
      applicationId: applicationId,
      licenseId: licenseId,
      isIntegrationTest: !!testId
    });

    // ライセンス情報をスプレッドシートに記録（エラーが発生しても処理継続）
    try {
      recordLicenseToSpreadsheet({
        userId: userId,
        applicationId: applicationId,
        licenseId: licenseId,
        licenseValue: licenseValue,
        testId: testId,
        receivedAt: new Date()
      });
    } catch (recordError) {
      console.error('スプレッドシート記録エラー（処理は継続）:', recordError);
    }

    // 統合テスト時の特別処理
    if (testId) {
      console.log('統合テスト完了通知を送信します...', { testId: testId });

      const completionResult = notifyIntegrationTestCompletion({
        userId: userId,
        testId: testId,
        licenseId: licenseId,
        applicationId: applicationId,
        success: true,
        timestamp: new Date().toISOString(),
        details: 'Integration test completed successfully - License received via GAS webhook'
      });

      if (completionResult.success) {
        console.log('✅ 統合テスト完了通知送信成功');
        return {
          success: true,
          message: 'License notification received and integration test completed',
          integrationTestResult: completionResult.response
        };
      } else {
        console.log('⚠️ ライセンス受信成功、但し完了通知送信失敗');
        return {
          success: true,
          message: 'License notification received but integration test completion failed',
          warning: completionResult.error
        };
      }
    } else {
      // 通常のライセンス通知
      console.log('✅ ライセンス通知受信完了');
      return {
        success: true,
        message: 'License notification received successfully'
      };
    }

  } catch (error) {
    console.error('❌ SANKEY通知処理エラー:', error);
    return {
      success: false,
      error: error instanceof Error ? error.toString() : String(error)
    };
  }
}
