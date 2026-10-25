import { defineConfig } from '@playwright/test';

const port = 8793;

const state = '.wrangler/showcase-state';

/**
 * Records the showcase: the built app on a local Worker with its own fresh
 * storage, driven through each flow on a phone-sized screen. `npm run
 * showcase` builds the app first and turns the recordings into a page.
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['capture.spec.ts', 'cases.spec.ts'],
  outputDir: '../test-results/showcase',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    reducedMotion: 'no-preference',
  },
  webServer: {
    command: [
      `node -e "require('node:fs').rmSync('${state}', { recursive: true, force: true })"`,
      `wrangler d1 migrations apply INDEX --local --persist-to ${state}`,
      `wrangler dev --port ${port} --persist-to ${state}`,
    ].join(' && '),
    cwd: '..',
    url: `http://localhost:${port}/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
