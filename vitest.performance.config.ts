import { defineConfig } from 'vitest/config';
import config from './vitest.config';

// The same 20 ms budget, measured without other test files competing for CPU.
export default defineConfig({
  ...config,
  test: { ...config.test, include: ['test/storageBudget.performance.ts'], maxWorkers: 1,
    outputFile: '.wrangler/verification/private/performance-results.json' },
});
