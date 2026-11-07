import { defineConfig } from '@playwright/test';

const port = Number(process.env.SPLITNEXT_E2E_PORT ?? 8791);

if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || port === 8787) {
  throw new Error('SPLITNEXT_E2E_PORT must be an integer from 1024 to 65535, excluding development port 8787');
}

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
  reporter: [['list'], ['json', { outputFile: '.wrangler/verification/private/browser-results.json' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1100, height: 900 },
    // Screens change at once, so assertions never meet the copies a morph
    // flies over the new screen; one test turns motion back on.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: [
      'node scripts/reset-e2e-state.mjs',
      `wrangler d1 migrations apply INDEX --local --persist-to ${state}`,
      `wrangler dev --port ${port} --persist-to ${state} --var ENABLE_DEBUG_INSPECTION:true`,
    ].join(' && '),
    url: `http://localhost:${port}/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
