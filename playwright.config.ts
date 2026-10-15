import { defineConfig } from '@playwright/test';

const port = 8791;

const state = '.wrangler/e2e-state';

/**
 * Browser tests against the built app on a local Worker with its own,
 * freshly migrated storage, separate from `npm run dev` data. Run after a
 * frontend build; `npm run check` builds first.
 */
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1100, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: [
      `rm -rf ${state}`,
      `wrangler d1 migrations apply INDEX --local --persist-to ${state}`,
      `wrangler dev --port ${port} --persist-to ${state} --var ENABLE_DEBUG_INSPECTION:true`,
    ].join(' && '),
    url: `http://localhost:${port}/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
