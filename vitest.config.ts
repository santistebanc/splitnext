import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const migrations = await readD1Migrations('./migrations');

await mkdir('.wrangler/verification/private', { recursive: true });

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // Exercise Expo's dynamic imports in the actual bundled Worker, where
        // its render and manifest modules are siblings of the entry module.
        workers: [
          {
            name: 'app-rendering',
            compatibilityDate: '2026-09-14',
            compatibilityFlags: ['nodejs_compat'],
            modulesRoot: fileURLToPath(
              new URL('./.wrangler/dry-run/', import.meta.url),
            ),
            modules: [
              {
                type: 'ESModule',
                path: fileURLToPath(
                  new URL('./.wrangler/dry-run/index.js', import.meta.url),
                ),
              },
              {
                type: 'Text',
                path: fileURLToPath(
                  new URL(
                    './.wrangler/dry-run/generated/expo-server/_expo/routes.json',
                    import.meta.url,
                  ),
                ),
              },
              {
                type: 'CommonJS',
                path: fileURLToPath(
                  new URL(
                    './.wrangler/dry-run/generated/expo-server/_expo/server/render.js',
                    import.meta.url,
                  ),
                ),
              },
            ],
          },
        ],
        serviceBindings: { APP_RENDERING: 'app-rendering' },
        bindings: {
          ENABLE_DEBUG_INSPECTION: 'true',
          LOG_REQUESTS: 'false',
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    reporters: ['default', 'json'],
    outputFile: '.wrangler/verification/private/unit-results.json',
    // Polls assert eventual convergence (realtime, background sync), which the
    // product promises without a latency bound. The 1 s default failed on a
    // CPU-starved machine although every catch-up completed; 3 s still fails a
    // lost update with its assertion, leaving setup room in the 5 s test timeout.
    expect: { poll: { timeout: 3_000 } },
  },
});
