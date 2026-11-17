import { readFile, writeFile } from 'node:fs/promises';
import { LEFT_S_PATH, RIGHT_S_PATH } from '../apps/client/src/design/brand.ts';
import { colors } from '../apps/client/src/design/tokens.ts';
import sharp from 'sharp';

// Static browser assets use the same paths and palette as the app's BrandMark.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="104" height="104" viewBox="0 0 104 104" fill="none">
  <defs>
    <clipPath id="l"><rect x="0" y="0" width="46" height="104"/></clipPath>
    <clipPath id="r"><rect x="58" y="0" width="46" height="104"/></clipPath>
  </defs>
  <rect x="2" y="2" width="100" height="100" rx="26" fill="${colors.ink}"/>
  <g clip-path="url(#l)"><path fill="${colors.background}" d="${LEFT_S_PATH}"/></g>
  <g clip-path="url(#r)"><path fill="${colors.background}" d="${RIGHT_S_PATH}"/></g>
  <line x1="52" y1="20" x2="52" y2="84" stroke="${colors.background}" stroke-width="7" stroke-linecap="butt" stroke-dasharray="7 9"/>
</svg>
`;

const manifest = JSON.stringify({
  name: 'Splitnext',
  short_name: 'Splitnext',
  start_url: '/app',
  scope: '/',
  display: 'standalone',
  background_color: colors.background,
  theme_color: colors.background,
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}, null, 2) + '\n';

const nativeIcon = await sharp(Buffer.from(icon)).resize(1024, 1024).flatten({ background: colors.background }).png().toBuffer();

const assets = [
  { name: 'public/icon.svg', content: Buffer.from(icon) },
  { name: 'public/manifest.webmanifest', content: Buffer.from(manifest) },
  { name: 'assets/icon.png', content: nativeIcon },
];

for (const { name, content } of assets) {
  const path = new URL(`../apps/client/${name}`, import.meta.url);

  if (process.argv.includes('--check')) {
    if (!(await readFile(path)).equals(content)) throw new Error(`${name} is stale. Run npm run assets:brand.`);
  } else {
    await writeFile(path, content);
  }
}
