import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // テスト環境
    environment: 'node',
    
    // グローバル設定（Jestとの互換性のため）
    globals: true,
    
    // テストファイルのパターン
    include: ['**/__tests__/**/*.test.js'],
    
    // カバレッジ設定
    coverage: {
      enabled: false, // 明示的に指定した時のみ有効
      provider: 'v8',
      include: [
        'core/**/*.js',
        'services/**/*.js',
        'setup-environment.js'
      ],
      exclude: [
        '**/__tests__/**',
        '**/node_modules/**'
      ],
      reporter: ['text', 'lcov', 'html']
    },
    
    // タイムアウト設定
    testTimeout: 10000,
    
    // CommonJSサポート - 削除（不要）
    // pool: 'forks',
    
    // セットアップファイル（必要に応じて）
    // setupFiles: ['./vitest.setup.js']
  }
});