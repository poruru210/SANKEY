#!/usr/bin/env node
/**
 * Copyright 2025 SANKEY
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const { execSync } = require('child_process');
const fs = require('fs');

// コンソール出力
const log = {
  success: (msg) => console.log(`✓ ${msg}`),
  error: (msg) => console.log(`✗ ${msg}`),
  info: (msg) => console.log(`ℹ ${msg}`)
};

// claspの確認
function checkClasp() {
  try {
    execSync('clasp --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ログイン確認
function checkLogin() {
  try {
    execSync('clasp list', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// プロジェクト作成とScript ID取得
function createAndGetScriptId(name) {
  try {
    // プロジェクト作成
    const output = execSync(
      `clasp create --title "${name}" --type standalone`,
      { encoding: 'utf8' }
    );
    
    console.log(output);
    
    // .clasp.jsonからScript IDを取得
    if (fs.existsSync('.clasp.json')) {
      const config = JSON.parse(fs.readFileSync('.clasp.json', 'utf8'));
      return config.scriptId;
    }
    
    // 出力からScript IDを抽出（フォールバック）
    const match = output.match(/https:\/\/script\.google\.com\/d\/([a-zA-Z0-9-_]+)\/edit/);
    return match ? match[1] : null;
  } catch (error) {
    log.error(`プロジェクト作成エラー: ${error.message}`);
    return null;
  }
}

// メイン
async function main() {
  console.log('=== GAS セットアップ ===\n');
  
  // 1. clasp確認
  if (!checkClasp()) {
    log.error('claspがインストールされていません');
    console.log('\nnpm install -g @google/clasp');
    process.exit(1);
  }
  
  // 2. ログイン確認
  if (!checkLogin()) {
    log.error('claspにログインしてください');
    console.log('\nclasp login');
    process.exit(1);
  }
  
  // 3. 既存ファイル削除
  if (fs.existsSync('.clasp.json')) {
    fs.unlinkSync('.clasp.json');
  }
  if (fs.existsSync('.clasp-dev.json')) {
    fs.unlinkSync('.clasp-dev.json');
  }
  
  // 4. 開発環境を先に作成
  log.info('開発環境を作成中...');
  const devScriptId = createAndGetScriptId('SANKEY Form (dev)');
  
  if (!devScriptId) {
    log.error('開発環境の作成に失敗しました');
    process.exit(1);
  }
  
  // 5. 開発環境の設定をリネーム
  fs.renameSync('.clasp.json', '.clasp-dev.json');
  log.success('開発環境を作成しました');
  log.info(`  Script ID: ${devScriptId}`);
  
  // 6. 本番環境を作成
  console.log();
  log.info('本番環境を作成中...');
  const prodScriptId = createAndGetScriptId('SANKEY Form');
  
  if (!prodScriptId) {
    log.error('本番環境の作成に失敗しました');
    process.exit(1);
  }
  
  // 7. 本番環境の設定をリネーム
  fs.renameSync('.clasp.json', '.clasp-prod.json');
  log.success('本番環境を作成しました');
  log.info(`  Script ID: ${prodScriptId}`);
  
  // 8. rootDirを追加
  for (const file of ['.clasp-prod.json', '.clasp-dev.json']) {
    if (fs.existsSync(file)) {
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      config.rootDir = './dist';
      fs.writeFileSync(file, JSON.stringify(config, null, 2));
    }
  }
  
  // 8. srcディレクトリ作成
  if (!fs.existsSync('src')) {
    fs.mkdirSync('src');
    log.success('srcディレクトリを作成しました');
  }
  
  // 9. 完了
  console.log('\n=== セットアップ完了 ===');
  console.log('\n作成されたプロジェクト:');
  console.log(`- 本番環境 [SANKEY Form]:`);
  console.log(`  https://script.google.com/d/${prodScriptId}/edit`);
  console.log(`- 開発環境 [SANKEY Form (dev)]:`);
  console.log(`  https://script.google.com/d/${devScriptId}/edit`);
  console.log('\n使用方法:');
  console.log('  npm run deploy      → 開発環境にデプロイ');
  console.log('  npm run deploy:prod → 本番環境にデプロイ');
}

// 実行
main().catch(error => {
  log.error(`エラー: ${error.message}`);
  process.exit(1);
});