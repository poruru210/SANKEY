import { FormData, WebhookResponse, TestResult } from './config';
import { getConfig } from './config-manager';
import { createJWT } from './jwt';

/**
 * Webhookの送信(JWT版)
 */
export function sendWebhook(formData: FormData): WebhookResponse {
  try {
    const config = getConfig();
    const jwt = createJWT(formData);

    console.log('JWT署名済みリクエストデータ準備完了', {
      jwtLength: jwt.length,
      userId: config.USER_ID
    });

    const response = UrlFetchApp.fetch(config.WEBHOOK_URL, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      payload: JSON.stringify({
        userId: config.USER_ID,
        data: jwt,
        iv: "",
        hmac: "jwt-signed",
        method: "JWT"
      }),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    console.log('レスポンス:', {
      code: responseCode,
      body: responseText
    });

    if (responseCode === 200) {
      try {
        return {
          success: true,
          response: JSON.parse(responseText)
        };
      } catch (parseError) {
        return {
          success: true,
          response: { message: responseText }
        };
      }
    } else if (responseCode === 503) {
      console.log('サービス一時利用不可 - 3秒後にリトライします');
      Utilities.sleep(3000);
      return sendWebhook(formData);
    } else {
      return {
        success: false,
        error: 'HTTP ' + responseCode + ': ' + responseText
      };
    }

  } catch (error) {
    console.error('sendWebhook エラー:', error);
    return {
      success: false,
      error: error instanceof Error ? error.toString() : String(error)
    };
  }
}

/**
 * SANKEYにテスト結果を通知
 */
export function notifyTestSuccess(testResult: TestResult): WebhookResponse {
  try {
    const config = getConfig();

    if (!config.TEST_NOTIFICATION_URL || config.TEST_NOTIFICATION_URL === '') {
      console.error('TEST_NOTIFICATION_URL が設定されていません');
      return { success: false, error: 'TEST_NOTIFICATION_URL not configured' };
    }

    const notificationData = {
      userId: config.USER_ID,
      testResult: testResult
    };

    console.log('テスト結果通知を送信中...', {
      testSuccess: testResult.success,
      userId: config.USER_ID
    });

    const response = UrlFetchApp.fetch(config.TEST_NOTIFICATION_URL, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      payload: JSON.stringify(notificationData),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    console.log('テスト結果通知レスポンス:', {
      code: responseCode,
      body: responseText
    });

    if (responseCode === 200) {
      try {
        return {
          success: true,
          response: JSON.parse(responseText)
        };
      } catch (parseError) {
        return {
          success: true,
          response: { message: responseText }
        };
      }
    } else {
      return {
        success: false,
        error: 'HTTP ' + responseCode + ': ' + responseText
      };
    }

  } catch (error) {
    console.error('テスト結果通知エラー:', error);
    return {
      success: false,
      error: error instanceof Error ? error.toString() : String(error)
    };
  }
}

/**
 * 統合テスト完了をSANKEYに通知
 */
export function notifyIntegrationTestCompletion(completionData: {
  userId: string;
  testId: string;
  licenseId: string;
  applicationId: string;
  success: boolean;
  timestamp: string;
  details: string;
}): WebhookResponse {
  try {
    const config = getConfig();
    const completionUrl = config.RESULT_NOTIFICATION_URL.includes('/result/notification')
      ? config.RESULT_NOTIFICATION_URL.replace('/result/notification', '/test/complete')
      : config.RESULT_NOTIFICATION_URL.includes('/result')
        ? config.RESULT_NOTIFICATION_URL.replace('/result', '/test/complete')
        : config.RESULT_NOTIFICATION_URL + '/test/complete';

    const notificationPayload = {
      userId: completionData.userId,
      testId: completionData.testId,
      licenseId: completionData.licenseId,
      applicationId: completionData.applicationId,
      testResult: {
        success: completionData.success,
        timestamp: completionData.timestamp,
        details: completionData.details
      }
    };

    console.log('統合テスト完了通知を送信中...', {
      url: completionUrl,
      testId: completionData.testId
    });

    const response = UrlFetchApp.fetch(completionUrl, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      payload: JSON.stringify(notificationPayload),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    console.log('統合テスト完了通知レスポンス:', {
      code: responseCode,
      body: responseText
    });

    if (responseCode === 200) {
      try {
        return {
          success: true,
          response: JSON.parse(responseText)
        };
      } catch (parseError) {
        return {
          success: true,
          response: { message: responseText }
        };
      }
    } else {
      return {
        success: false,
        error: 'HTTP ' + responseCode + ': ' + responseText
      };
    }

  } catch (error) {
    console.error('統合テスト完了通知エラー:', error);
    return {
      success: false,
      error: error instanceof Error ? error.toString() : String(error)
    };
  }
}
