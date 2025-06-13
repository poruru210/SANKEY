module.exports = {
  // テスト環境
  testEnvironment: 'node',
  
  // プロジェクトのルートディレクトリ
  rootDir: '.',
  
  // テストファイルのパターン
  testMatch: [
    '**/__tests__/**/*.test.js'
  ],
  
  // カバレッジ設定
  collectCoverageFrom: [
    'core/**/*.js',
    'services/**/*.js',
    'setup-environment.js',
    '!**/__tests__/**',
    '!**/node_modules/**'
  ],
  
  // カバレッジレポートの形式
  coverageReporters: ['text', 'lcov', 'html'],
  
  // モジュールディレクトリ
  moduleDirectories: ['node_modules', '.'],
  
  // タイムアウト設定
  testTimeout: 10000,
  
  // 詳細な出力
  verbose: true
};