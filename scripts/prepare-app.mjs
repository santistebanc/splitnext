import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const assets = join(root, '.wrangler', 'app-assets');

const server = join(root, 'src', 'generated', 'expo-server');

// Only generated build outputs are replaced; sources and local D1 stay intact.
for (const target of [assets, server]) {
  if (!target.startsWith(root + '/') && !target.startsWith(root + '\\')) {
    throw new Error('Build output escaped the repository');
  }

  await mkdir(target, { recursive: true });

  // A running Windows dev server may hold the output directory open.
  // Replace its contents while keeping the directory itself available.
  for (const entry of await readdir(target)) {
    await rm(join(target, entry), { recursive: true, force: true });
  }
}

await cp(join(root, 'apps', 'client', 'dist', 'client'), assets, {
  recursive: true,
});

await cp(join(root, 'apps', 'client', 'dist', 'server'), server, {
  recursive: true,
  filter: (source) => !source.endsWith('.map'),
});

const serializedManifest = await readFile(
  join(server, '_expo', 'routes.json'),
  'utf8',
);

const manifest = JSON.parse(serializedManifest);

const publicAssets = [
  '/assets/instrument-sans.woff2',
  '/assets/geist-mono.woff2',
  '/icon.svg',
  '/manifest.webmanifest',
];

// A font or icon replacement must invalidate the shell cache too, even
// when the JavaScript bundle and route manifest have not changed.
const releaseHash = createHash('sha256').update(serializedManifest);

for (const path of publicAssets) {
  releaseHash.update(path).update(await readFile(join(assets, path.slice(1))));
}

const release = releaseHash.digest('hex').slice(0, 16);

const precache = [
  '/',
  '/app',
  ...publicAssets,
  ...(manifest.assets?.js ?? []),
  ...(manifest.assets?.css ?? []),
];

const serviceWorker = await readFile(
  new URL('./service-worker.js', import.meta.url),
  'utf8',
);

await writeFile(
  join(assets, 'service-worker.js'),
  `const cacheName = ${JSON.stringify('splitnext-app-shell-' + release)};\nconst appAssets = ${JSON.stringify(precache)};\n${serviceWorker}`,
);

console.log('Prepared Expo server modules and app assets.');
