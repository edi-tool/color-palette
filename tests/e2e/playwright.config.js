// E2E 設定。システムの Chrome を使い、ブラウザのダウンロードは不要。
// 実機（iPhone Safari 等）は自動化できないため対象外。検証記録に別途書く。
const { defineConfig } = require('@playwright/test');

const PORT = 8199;

module.exports = defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: {
    command: `node server.cjs`,
    env: { PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: false, // 古いサーバーを使い回すと不安定になるため、必ず新しく起動する
    timeout: 20_000,
  },
});
