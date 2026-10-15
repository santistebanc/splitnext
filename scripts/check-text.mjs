// Fails when a tracked text file contains UTF-8 that was decoded as
// Windows-1252 and encoded again, such as "â€¦" for "…" or "Â·" for "·".
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const garbled = /â€|Â[ -¿]|Ã[\u0080-¿]/;

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => /\.(ts|tsx|js|mjs|cjs|json|jsonc|md|html|css|sql)$/.test(file))
  .filter((file) => file !== 'package-lock.json');

const findings = files.flatMap((file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, index) => (garbled.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])),
);

if (findings.length) {
  console.error(`Garbled UTF-8 text:\n${findings.join('\n')}`);
  process.exit(1);
}
