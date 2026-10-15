// Fails when a tracked text file contains UTF-8 that was decoded as
// Windows-1252 and encoded again, which turns an ellipsis or a middle dot
// into two or three Latin characters.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const char = (code) => String.fromCodePoint(code);

// Lead bytes of common two- and three-byte UTF-8 sequences, read as Windows-1252.
const garbled = new RegExp(
  [
    `${char(0xe2)}${char(0x20ac)}`,
    `${char(0xc2)}[${char(0xa0)}-${char(0xbf)}]`,
    `${char(0xc3)}[${char(0x80)}-${char(0xbf)}]`,
  ].join('|'),
);

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
