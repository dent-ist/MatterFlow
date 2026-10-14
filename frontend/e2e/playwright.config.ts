import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for the MatterFlow end-to-end suite (docs/qa/e2e.md).
 *
 * The suite talks to a running stack and never starts one itself: `e2e/run-local.sh` (or CI) starts SQL Server and the API that
 * serves the built Angular app on one origin, then runs `playwright test`.
 *
 * Environment:
 *   E2E_BASE_URL         origin of the app and API (default http://127.0.0.1:5190)
 *   E2E_CHROMIUM_PATH    Chromium executable to use instead of Playwright's own download (the sandbox ships one)
 *   E2E_NO_SANDBOX=1     pass --no-sandbox (needed when Chromium runs as root in a container)
 *   E2E_WORKERS          number of parallel workers (default 2; 1 on CI)
 */
const baseURL = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:5190';
const executablePath = process.env['E2E_CHROMIUM_PATH'] || undefined;
const isCi = !!process.env['CI'];

export default defineConfig({
  testDir: './tests',
  outputDir: '../test-results',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: process.env['E2E_WORKERS'] ? Number(process.env['E2E_WORKERS']) : isCi ? 1 : 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  use: {
    baseURL,
    // The firm works in America/New_York; individual tests override the zone to check per-viewer behaviour.
    timezoneId: 'America/New_York',
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      executablePath,
      args: process.env['E2E_NO_SANDBOX'] ? ['--no-sandbox'] : [],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
