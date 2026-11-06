import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { domainImports, catalogSchema, artifactBoundary, ciSemantics } from './contracts.mjs';
import { publicEvidence, publish } from './evidence.mjs';
import { buildInputs, stampBuild, currentBuild, sourceIdentity } from './provenance.mjs';
import { ciResult } from '../scripts/verification-ci-result.mjs';
import { runOwned } from './owned-process.mjs';
import { testSummary } from './ci-summary.mjs';

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

test('test summaries expose source locations and counts, excluding raw assertion messages and private state', () => {
  const sourceFiles = { 'test/fixture.test.ts': 'digest', 'e2e/app.spec.ts': 'digest' };
  const unit = testSummary({ numTotalTests: 1, numFailedTests: 1, testResults: [{ name: path.resolve('test/fixture.test.ts'), status: 'failed', message: 'SECRET_SESSION' }] }, 'unit', sourceFiles);
  const browser = testSummary({ stats: { unexpected: 1 }, suites: [{ specs: [{ file: 'app.spec.ts', line: 42, ok: false, tests: [{ error: 'SECRET_TOKEN' }] }] }] }, 'browser', sourceFiles);

  assert.equal(unit.executed, 1);
  assert.deepEqual(browser.failed, [{ file: 'e2e/app.spec.ts', line: 42 }]);
  assert.ok(!JSON.stringify([unit, browser]).includes('SECRET'));
  assert.equal(testSummary({}, 'unit', sourceFiles).status, 'not-run');
  assert.equal(testSummary({ numTotalTests: 2, numPendingTests: 2 }, 'unit', sourceFiles).status, 'not-run');
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
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'ignore' });

  try {
    process.chdir(directory);
    git('init');
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
    // The resolved mkdtemp directory is owned by this fixture.
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
