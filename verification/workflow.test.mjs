import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { domainImports, catalogSchema, artifactBoundary, ciSemantics } from './contracts.mjs';
import { publicEvidence, publish } from './evidence.mjs';
import { buildInputs, stampBuild, currentBuild, sourceIdentity } from './provenance.mjs';
import { ciResult } from '../scripts/verification-ci-result.mjs';
import { runOwned } from './owned-process.mjs';
import { failureLines, testSummary } from './ci-summary.mjs';

test('pure domain boundary catches imports that types alone allow, including exports and dynamic/type imports', () => {
  for (const source of ["import '../client/storage'", "export * from '../client/storage'", "import('@splitnext/client')", "type T = import('../client/storage').T", "import x = require('../client/storage')", 'import(moduleName)', "require('node:fs')"])
    assert.equal(domainImports('src/domain/fixture.ts', source).length, 1, source);
  assert.deepEqual(domainImports('src/domain/fixture.ts', "import {z} from 'zod'; import './money';"), []);
});

test('feature map rejects missing or empty scenarios and expected checks', async () => {
  const fixture = JSON.parse(await readFile('verification/features.json', 'utf8'));

  assert.throws(() => catalogSchema.parse({ ...fixture, features: [] }));
  fixture.features[0].expected = [];
  assert.throws(() => catalogSchema.parse(fixture));
});

test('artifact boundary rejects raw traces, private profiles, and mixed multiline upload paths', () => {
  for (const destination of ['test-results/', '.wrangler/verification/private/', '.wrangler/verification/public/\ntest-results/']) {
    const workflow = { jobs: { check: { steps: [{ uses: 'actions/upload-artifact@v4', with: { path: destination } }] } } };

    assert.equal(artifactBoundary(workflow).length, 1);
  }
});

test('CI semantics reject missing gates, unbounded jobs and duplicate heavy scenarios', async () => {
  const workflow = YAML.parse(await readFile('.github/workflows/check.yml', 'utf8'));

  assert.deepEqual(ciSemantics(workflow), []);

  for (const change of [
    (copy) => { copy.jobs.check.steps = copy.jobs.check.steps.filter((step) => step.id !== 'checks'); },
    (copy) => { delete copy.jobs.browser['timeout-minutes']; },
    (copy) => { copy.jobs.browser.steps.push({ run: 'npm run verify:expense-recovery' }); },
    (copy) => { copy.jobs.browser.steps = copy.jobs.browser.steps.filter((step) => !step.uses?.startsWith('actions/upload-artifact')); },
  ]) {
    const copy = structuredClone(workflow);

    change(copy);
    assert.ok(ciSemantics(copy).length > 0);
  }
});

test('CI summaries preserve not-run states and never publish step outputs or raw source patches', () => {
  const source = { commit: 'a'.repeat(40), fingerprint: 'b'.repeat(64), patchHash: 'c'.repeat(64), dirty: true, patch: 'SECRET_PATCH' };
  const result = ciResult('check', 'failure', { install: { outcome: 'failure', outputs: { token: 'SECRET_TOKEN' } } }, source);

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.checks.map((check) => check.status), ['failed', 'not-run', 'not-run']);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.equal(ciResult('check', 'success', {}, source).status, 'blocked');
});

// Message shapes copied from real Playwright and Vitest JSON reports, with planted secrets.
const planted = ['sk_live_TOKEN', 'INVITE_CODE', 'ana@example.com', 'https://evil.example', '\u001b', 'device_secret'];

const spec = [
  "test('opens a rename where the name already is', async ({ page }) => {",
  "  await expect(field(page, 'Name')).toHaveValue('Ana');",
  "test('times out while clicking', async ({ page }) => {",
  "  await button(page, 'Missing').click();",
  "test('throws', async () => {",
  "  throw new TypeError('kept private');",
].join('\n');

const unitSource = ['describe("realtime client synchronization", () => {', "  it('catches up on announcements missed while offline', async () => {",
  "    await expect.poll(() => name()).toBe('Missed name');", "  it('waits forever', async () => {", '  it(`interpolated ${value}`, () => {}); // eslint-disable-line'].join('\n');

const sources = { 'e2e/app.spec.ts': spec, 'test/realtime.test.ts': unitSource };

const sourceFiles = { 'e2e/app.spec.ts': 'digest', 'test/realtime.test.ts': 'digest', 'test/missing.test.ts': 'deleted' };

const read = (file) => sources[file] ?? null;

const browserError = (line, message) => ({ location: { file: path.resolve('e2e/app.spec.ts'), line, column: 3 }, message });

const browserReport = { stats: { expected: 70, unexpected: 4 }, suites: [{ specs: [
  { file: 'app.spec.ts', line: 1, title: 'opens a rename where the name already is', ok: false, tests: [{ results: [{ status: 'failed', errors: [browserError(2,
    "Error: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m).\u001b[22mtoHaveValue\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m)\u001b[22m failed\n\nLocator:  getByRole('textbox', { name: 'Name' })\nExpected: \u001b[32m\"Ana\"\u001b[39m\nReceived: \u001b[31m\"Bearer sk_live_TOKEN ana@example.com\"\u001b[39m\nTimeout:  10000ms\n\nCall log:\n  - waiting for https://evil.example/join?code=INVITE_CODE")] }] }] },
  { file: 'app.spec.ts', line: 3, title: 'times out while clicking', ok: false, tests: [{ results: [{ status: 'timedOut', errors: [
    { message: '\u001b[31mTest timeout of 1000ms exceeded.\u001b[39m' },
    browserError(4, "Error: locator.click: Test timeout of 1000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'device_secret=sk_live_TOKEN' })")] }] }] },
  { file: 'app.spec.ts', line: 5, title: 'throws', ok: false, tests: [{ results: [{ status: 'failed', errors: [browserError(6, 'TypeError: device_secret=sk_live_TOKEN\nline two \u001b[31mred\u001b[0m')] }] }] },
  { file: 'app.spec.ts', line: 900, title: 'Runtime title INVITE_CODE', ok: false, tests: [{ results: [{ status: 'failed', errors: [
    { location: { file: path.resolve('node_modules/x/index.js'), line: 1 }, message: 'something odd: sk_live_TOKEN' }] }] }] },
] }] };

const frame = (file, line) => `\n    at ${path.resolve(file).split(path.sep).join('/')}:${line}:5`;

const unitReport = { numPassedTests: 300, numFailedTests: 3, testResults: [
  { name: path.resolve('test/realtime.test.ts'), status: 'failed', assertionResults: [
    { status: 'failed', ancestorTitles: ['realtime client synchronization'], title: 'catches up on announcements missed while offline',
      failureMessages: [`Error: expected 'sk_live_TOKEN ana@example.com' to be 'Missed name' // Object.is equality${frame('node_modules/vitest/dist/chunk.js', 3748).replace('at ', 'at Proxy.__VITEST_POLL_CHAIN__ (')})${frame('test/realtime.test.ts', 3)}`] },
    { status: 'failed', ancestorTitles: ['realtime client synchronization'], title: 'waits forever', failureMessages: [`Error: STACK_TRACE_ERROR${frame('test/realtime.test.ts', 4)}`] },
    { status: 'failed', ancestorTitles: [], title: 'interpolated INVITE_CODE', failureMessages: ['\u001b[31mweird failure https://evil.example\u001b[0m'] },
    { status: 'passed', ancestorTitles: [], title: 'passes', failureMessages: [] },
  ] },
  { name: path.resolve('test/missing.test.ts'), status: 'failed', message: 'Error: device_secret leaked', assertionResults: [] },
] };

test('CI failure diagnostics locate and classify failures without publishing runtime message text', () => {
  const browser = testSummary(browserReport, 'browser', sourceFiles, read);
  const unit = testSummary(unitReport, 'unit', sourceFiles, read);
  const lines = failureLines([unit, browser]);
  const published = JSON.stringify([unit, browser]) + lines.join('\n');

  for (const secret of planted) assert.ok(!published.includes(secret), secret);
  assert.deepEqual(browser.failed[0], { file: 'e2e/app.spec.ts', line: 1, title: 'opens a rename where the name already is', kind: 'assertion', matcher: 'toHaveValue',
    action: null, errorType: null, timeoutMs: 10000, at: { file: 'e2e/app.spec.ts', line: 2 }, source: "await expect(field(page, 'Name')).toHaveValue('Ana');",
    reproduce: 'npm run frontend:build && npx playwright test e2e/app.spec.ts:1' });
  assert.deepEqual([browser.failed[1].kind, browser.failed[1].action, browser.failed[1].timeoutMs, browser.failed[1].source], ['test-timeout', 'locator.click', 1000, "await button(page, 'Missing').click();"]);
  assert.deepEqual([browser.failed[2].kind, browser.failed[2].errorType, browser.failed[2].source], ['error', 'TypeError', "throw new TypeError('kept private');"]);
  // Unrecognized messages, runtime titles and dependency frames stay explicit unknowns.
  assert.deepEqual([browser.failed[3].kind, browser.failed[3].title, browser.failed[3].at, browser.failed[3].source], ['unknown', null, null, null]);
  assert.deepEqual([unit.failed[0].matcher, unit.failed[0].at, unit.failed[0].reproduce],
    ['expect.poll', { file: 'test/realtime.test.ts', line: 3 }, 'npx vitest run test/realtime.test.ts -t "realtime client synchronization catches up on announcements missed while offline"']);
  assert.equal(unit.failed[1].kind, 'test-timeout');
  assert.deepEqual([unit.failed[2].kind, unit.failed[2].title, unit.failed[2].reproduce], ['unknown', null, 'npx vitest run test/realtime.test.ts']);
  assert.equal(unit.failed.length, 3, 'a deleted file is not published as a location');
  assert.equal(browser.failedTests, 4);
  assert.ok(lines.every((line) => !line.includes('\n')));
  assert.ok(lines.includes("::error file=e2e/app.spec.ts,line=2,title=browser test failed::browser: opens a rename where the name already is: assertion toHaveValue after 10000ms"));
});

test('CI summaries list at most twenty failures and keep zero-work reports not-run', () => {
  const many = { numPassedTests: 0, numFailedTests: 25, testResults: [{ name: path.resolve('test/realtime.test.ts'), status: 'failed',
    assertionResults: Array.from({ length: 25 }, (_, index) => ({ status: 'failed', ancestorTitles: [], title: `t${index}`, failureMessages: ['x'] })) }] };

  const summary = testSummary(many, 'unit', sourceFiles, read);

  assert.deepEqual([summary.failed.length, summary.omitted, summary.failedTests], [20, 5, 25]);
  assert.match(failureLines([summary]).at(-1), /5 more failures are only in the private report/);
  assert.equal(testSummary({}, 'unit', sourceFiles, read).status, 'not-run');
  assert.equal(testSummary({ numTotalTests: 2, numPendingTests: 2 }, 'unit', sourceFiles, read).status, 'not-run');
});

test('owned command timeout fails and actually terminates its process', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'splitnext-owned-'));
  const pidFile = path.join(directory, 'pid');

  try {
    await assert.rejects(runOwned(['-e', "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", pidFile], { timeoutMs: 2000, output: 'ignore' }), /interrupted_or_timed_out/);
    const pid = Number(await readFile(pidFile, 'utf8'));

    assert.ok(pid > 0);
    assert.throws(() => process.kill(pid, 0));
  } finally {
    // This mkdtemp directory contains only this process fixture's PID.
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('scenario public evidence is an allowlist and cannot publish incomplete success', async () => {
  const feature = JSON.parse(await readFile('verification/features.json', 'utf8')).features[0];
  const run = { id: '11111111-1111-4111-8111-111111111111', source: { commit: 'a'.repeat(40), fingerprint: 'b'.repeat(64), patchHash: 'c'.repeat(64), dirty: true, patch: 'SECRET_PATCH' }, build: null, status: 'failed' };
  const raw = { checkpoints: [], session: { device_secret: 'SECRET_CREDENTIAL' }, error: 'SECRET_ERROR', cleanup: 'completed' };
  const result = publicEvidence(run, feature, raw, { category: 'harness', check: 'fixture-setup' });

  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.throws(() => publicEvidence(run, feature, { ...raw, controls: ['SECRET_CONTROL'] }, null), /unrecognized_oracle/);
  assert.ok(result.checks.some((check) => check.status === 'not-run'));
  await assert.rejects(publish({ ...run, status: 'passed' }, feature, raw, null), /incomplete/);
  await assert.rejects(publish({ ...run, status: 'passed' }, feature, { ...raw, checkpoints: feature.expected, controls: feature.oracleControls }, null), /missing_observations/);
});

test('CLI rejects unknown scenarios, remote targets and invalid arguments without a green result', () => {
  for (const args of [['run', 'missing-fixture'], ['run', 'https://production.invalid'], ['run'], ['run', 'expense-recovery', '--target=https://production.invalid']]) {
    const result = spawnSync(process.execPath, ['scripts/verify.mjs', ...args], { encoding: 'utf8' });

    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).status, 'blocked');
  }
});

test('build stamp rejects stale source, changed assets, absent builds and zero source fixtures', async () => {
  const original = process.cwd();
  const ciScript = path.resolve('scripts/verification-ci-result.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'splitnext-provenance-'));
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
  // Git hooks (e.g. pre-push) export GIT_DIR and friends; inherited, they make
  // this fixture's git calls and source identity act on the enclosing repository.
  const inherited = Object.entries(process.env).filter(([name]) => name.startsWith('GIT_'));

  try {
    for (const [name] of inherited) delete process.env[name];
    process.chdir(directory);
    git('init', '--quiet');
    assert.equal(path.resolve(git('rev-parse', '--show-toplevel').trim()), await realpath(directory),
      'fixture git commands must not resolve to another repository');
    await mkdir('src', { recursive: true });
    await writeFile('src/app.ts', 'export const v = 1;');
    await writeFile('.gitignore', '.wrangler/\nsrc/generated/\n');
    git('add', '.');
    git('-c', 'user.name=Verification Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');

    const missingSteps = spawnSync(process.execPath, [ciScript], { cwd: directory, encoding: 'utf8',
      env: { ...process.env, VERIFICATION_JOB: 'check', VERIFICATION_OUTCOME: 'success', VERIFICATION_STEPS: '{}' } });

    assert.equal(missingSteps.status, 1, 'a claimed successful CI job with missing gates must fail');
    assert.equal(JSON.parse(missingSteps.stdout).status, 'blocked');
    await assert.rejects(currentBuild());
    await mkdir('.wrangler/app-assets', { recursive: true });
    await mkdir('src/generated/expo-server', { recursive: true });
    await writeFile('.wrangler/app-assets/app.js', 'original');
    await writeFile('src/generated/expo-server/render.js', 'original');
    const inputs = await buildInputs();

    await stampBuild(inputs);
    await currentBuild();
    const before = await sourceIdentity();

    await writeFile('src/app.ts', 'export const v = 2;');
    assert.notEqual((await sourceIdentity()).fingerprint, before.fingerprint);
    await assert.rejects(currentBuild(), /stale_build_inputs/);
    await assert.rejects(stampBuild(inputs), /source_changed/);
    await writeFile('src/app.ts', 'export const v = 1;');
    await writeFile('.wrangler/app-assets/app.js', 'stale');
    await assert.rejects(currentBuild(), /stale_build_assets/);
    await unlink('src/app.ts');
    await assert.rejects(buildInputs(), /missing_production_sources/);
  } finally {
    process.chdir(original);

    for (const [name, value] of inherited) process.env[name] = value;
    // The resolved mkdtemp directory is owned by this fixture.
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
