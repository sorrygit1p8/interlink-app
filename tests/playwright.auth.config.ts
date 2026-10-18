import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const cwd = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({
  testDir: './auth', timeout: 60_000, expect: { timeout: 12_000 }, workers: 1,
  reporter: [['list']], outputDir: '../artifacts/goal-auth-results',
  use: {
    ...devices['Pixel 7'], browserName: 'chromium', baseURL: 'http://127.0.0.1:8082',
    actionTimeout: 15_000, timezoneId: 'Asia/Seoul', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    serviceWorkers: 'block', launchOptions: { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  },
  webServer: {
    command: 'node scripts/serve-mobile-export.mjs', cwd, url: 'http://127.0.0.1:8082',
    reuseExistingServer: false, timeout: 30_000,
    env: { INTERLINK_EXPORT_DIR: 'artifacts/prod-check', INTERLINK_PREVIEW_PORT: '8082' },
  },
});
