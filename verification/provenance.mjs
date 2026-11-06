import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const digest = (value) => createHash('sha256').update(value).digest('hex');

export const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();

export async function sourceIdentity() {
  const patch = git('diff', 'HEAD', '--binary');
  const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))].sort();
  const contents = {};

  for (const file of files) {
    try { contents[file] = digest(await readFile(file)); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      contents[file] = 'deleted';
    }
  }

  return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '', patch,
    patchHash: digest(patch), fingerprint: digest(JSON.stringify(contents)), files: contents };
}

export async function buildInputs() {
  const source = await sourceIdentity();

  const inputs = Object.fromEntries(Object.entries(source.files).filter(([file]) =>
    /^(src\/(?!generated\/)|apps\/client\/(?!dist\/|\.expo\/)|packages\/|scripts\/(prepare-app\.mjs|service-worker\.js)$)/.test(file) ||
    /^(package(-lock)?\.json|wrangler.*\.jsonc|tsconfig\.json)$/.test(file)));

  if (!Object.entries(inputs).some(([file, value]) => file.startsWith('src/') && value !== 'deleted')) throw new Error('missing_production_sources');

  // Frontend builds always use production mode, including when invoked from Playwright.
  const environment = { NODE_ENV: 'production', EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? null };

  return digest(JSON.stringify({ inputs, environment }));
}

export async function filesUnder(directory) {
  const result = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);

    if (entry.isDirectory()) result.push(...await filesUnder(file));
    else result.push(file);
  }

  return result.sort();
}

export async function assetHashes() {
  const assets = {};

  for (const root of ['.wrangler/app-assets', 'src/generated/expo-server'])
    for (const file of await filesUnder(root)) assets[file.split(path.sep).join('/')] = digest(await readFile(file));

  if (!Object.keys(assets).some((file) => file.endsWith('.js'))) throw new Error('build_has_no_javascript');

  return assets;
}

export const buildStamp = '.wrangler/verification/build.json';

export async function stampBuild(expectedInputs) {
  if (await buildInputs() !== expectedInputs) throw new Error('source_changed_during_build');
  const stamp = { version: 1, inputs: expectedInputs, assets: await assetHashes(), node: process.version };

  await mkdir(path.dirname(buildStamp), { recursive: true });
  await writeFile(buildStamp, JSON.stringify(stamp, null, 2));

  return stamp;
}

export async function currentBuild() {
  const stamp = JSON.parse(await readFile(buildStamp, 'utf8'));

  if (stamp.version !== 1 || stamp.inputs !== await buildInputs()) throw new Error('stale_build_inputs: run npm run frontend:build');

  if (JSON.stringify(stamp.assets) !== JSON.stringify(await assetHashes())) throw new Error('stale_build_assets: run npm run frontend:build');

  return stamp;
}
