import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

const target = path.resolve(root, '.wrangler/e2e-state');

if (path.relative(root, target) !== path.join('.wrangler', 'e2e-state')) throw new Error('unsafe_e2e_state_path');

await rm(target, { recursive: true, force: true });
