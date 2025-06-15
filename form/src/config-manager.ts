import { Config } from './types';
import { CONFIG } from './config-values';

/**
 * 設定を取得する
 */
export function getConfig(): Config {
  return CONFIG;
}

/**
 * 設定値の検証
 */
export function validateConfig(): boolean {
  const issues: string[] = [];
  const config = getConfig();

  if (!config.WEBHOOK_URL || config.WEBHOOK_URL.indexOf('your-api') !== -1) {
    issues.push('WEBHOOK_URL が設定されていません');
  }

  if (!config.USER_ID || config.USER_ID.indexOf('xxxx') !== -1) {
    issues.push('USER_ID が設定されていません');
  }

  if (!config.JWT_SECRET || config.JWT_SECRET.indexOf('your-') !== -1) {
    issues.push('JWT_SECRET が設定されていません');
  }

  if (issues.length > 0) {
    console.error('❌ 設定エラー:', issues);
    return false;
  }

  console.log('✅ 設定は正常です');
  return true;
}

/**
 * GASプロジェクトID取得
 */
export function getGasProjectId(): string {
  try {
    return ScriptApp.getScriptId();
  } catch (error) {
    console.error('GASプロジェクトID取得エラー:', error);
    return '';
  }
}
