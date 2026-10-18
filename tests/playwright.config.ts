import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const cwd = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({
  testDir: './e2e', timeout: 60_000, expect: { timeout: 12_000 }, fullyParallel: false, workers: 1,
  reporter: [['list'], ['html', { outputFolder: '../artifacts/playwright-report', open: 'never' }]],
  outputDir: '../artifacts/playwright-results',
  use: { baseURL: process.env.MOBILE_BASE_URL || 'http://127.0.0.1:8081', actionTimeout: 15_000, timezoneId: 'Asia/Seoul', trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] } },
  projects: [{ name: 'chromium-mobile-web', use: { ...devices['Pixel 7'], browserName: 'chromium' } }],
  webServer: [
    ...(!process.env.MOBILE_BASE_URL ? [{
      command: 'node scripts/serve-mobile-export.mjs', cwd,
      url: 'http://127.0.0.1:8081', reuseExistingServer: !process.env.CI, timeout: 30_000,
    }] : []),
    ...(!process.env.WEB_BASE_URL ? [{
      command: 'npm run start --workspace @interlink/web', cwd,
      url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI, timeout: 60_000,
      env: { INTERLINK_DATA_MODE: 'demo', INTERLINK_APP_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1' },
    }] : []),
  ],
});
