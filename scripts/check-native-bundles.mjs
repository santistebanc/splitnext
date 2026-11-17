import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Check the actual Metro module graph, not just platform-specific source names.
for (const platform of ['android', 'ios']) {
  const directory = new URL(`../apps/client/native-dist/_expo/static/js/${platform}/`, import.meta.url);
  const maps = (await readdir(directory)).filter((name) => name.endsWith('.map'));

  assert.equal(maps.length, 1, `${platform}: expected one bundle source map`);
  const { sources } = JSON.parse(await readFile(new URL(maps[0], directory), 'utf8'));

  for (const required of ['entry.native.ts', 'ui/platform.native.ts', 'native/storage.ts', 'ui/ScreenModal.native.tsx'])
    assert.ok(sources.some((source) => source.endsWith(required)), `${platform}: missing ${required}`);

  const browser = sources.filter((source) => /react-dom|\/ui\/browserPlatform\.|\/model\/browser\.|\/src\/lab\//.test(source));

  assert.deepEqual(browser, [], `${platform}: browser-only modules in native app`);
}

console.log(JSON.stringify({ status: 'passed', platforms: ['android', 'ios'], browserModules: 0 }));
