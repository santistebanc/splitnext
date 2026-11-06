import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { open, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { catalog, checkContracts } from '../verification/contracts.mjs';
import { buildInputs, stampBuild, currentBuild, sourceIdentity } from '../verification/provenance.mjs';
import { runOwned } from '../verification/owned-process.mjs';
import { publish, readPrivate, publicEvidenceSchema } from '../verification/evidence.mjs';

const help = `Splitnext verification (local disposable state only)
  npm run verify -- discover                 Machine-readable feature map and gates
  npm run verify -- doctor                   Check Node, SQLite, browser, build and port
  npm run verify -- check                    Deterministic repository contracts
  npm run verify -- build                    Fresh frontend and source/asset stamp
  npm run verify -- run expense-recovery [--built]
  npm run verify -- controls [--built]        Inject lost work through real IndexedDB
  npm run verify -- evidence RUN_ID           Read sanitized result; validate source identity
  --json                                    JSON result (child logs stay on stderr)
--built accepts only a source- and content-verified build, not a skip-build flag.
Private logs/state: .wrangler/verification/private/RUN_ID
Publishable allowlisted JSON only: .wrangler/verification/public/RUN_ID.json
Existing required gates remain check:fast and check. Discover their scope above.`;

async function build(output = process.stderr.fd) {
  assert.ok(process.env.npm_execpath, 'invoke builds through npm run verify -- build');
  const inputs = await buildInputs();

  for (const args of [[process.env.npm_execpath, 'run', 'app:build'], ['scripts/prepare-app.mjs']]) {
    const code = await runOwned(args, { timeoutMs: 300000, output, env: { ...process.env, NODE_ENV: 'production' } });

    if (code !== 0) throw new Error('frontend_build_failed');
  }

  return stampBuild(inputs);
}

async function doctor() {
  const checks = [];

  const inspect = async (id, operation, remedy) => {
    try { await operation(); checks.push({ id, status: 'passed' }); } catch {
      checks.push({ id, status: 'blocked', remedy });
    }
  };

  await inspect('node', () => assert.ok(Number(process.versions.node.split('.')[0]) >= 24), 'Use Node from .nvmrc (24 or newer).');
  await inspect('dependencies', () => access('node_modules/.package-lock.json'), 'Run npm ci.');
  await inspect('sqlite', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');

    try { assert.equal(db.prepare('SELECT 1 AS ready').get().ready, 1); } finally { db.close(); }
  }, 'Use a Node build with node:sqlite.');
  await inspect('browser', async () => {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: true });

    await browser.close();
  }, 'Run npx playwright install chromium (Linux CI: --with-deps).');
  await inspect('port-8857', async () => {
    const probe = createServer();

    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(8857, '127.0.0.1', resolve); });
    await new Promise((resolve) => probe.close(resolve));
  }, 'Port 8857 is occupied. Stop only a process you own, or wait; verification will not reuse it.');
  let buildState = 'current';

  try { await currentBuild(); } catch { buildState = 'fresh-build-required'; }

  return { status: checks.every((check) => check.status === 'passed') ? 'ready' : 'blocked', checks, build: buildState,
    action: buildState === 'current' ? null : 'run defaults to a fresh build; --built will refuse this build' };
}

async function scenario(feature, reuse, control = false) {
  const id = randomUUID();
  const run = { id, directory: path.resolve('.wrangler/verification/private', id), source: await sourceIdentity(), build: null, status: 'not-run' };

  await mkdir(run.directory, { recursive: true });
  await writeFile(path.join(run.directory, 'source.json'), JSON.stringify(run.source, null, 2));
  const log = await open(path.join(run.directory, 'commands.log'), 'w');
  let failure = null;
  let raw = null;

  // A not-run record survives interruption or setup failure; never reuse a previous green.
  await publish(run, feature, null, null);

  try {
    run.build = reuse ? await currentBuild() : await build(log.fd);

    const config = { root: path.join(run.directory, 'environment'), build: run.build, sourceFingerprint: run.source.fingerprint,
      expected: feature.expected, negativeControl: control ? feature.negativeControl.id : null };

    const configFile = path.join(run.directory, 'scenario.json');

    await writeFile(configFile, JSON.stringify(config));
    const exitCode = await runOwned([feature.scenario, '--config', configFile], { timeoutMs: 540000, output: log.fd });

    raw = await readPrivate(run);

    if (!raw) throw new Error('missing_scenario_evidence');
    const after = await sourceIdentity();

    if (after.fingerprint !== run.source.fingerprint || after.commit !== run.source.commit || after.patchHash !== run.source.patchHash) throw new Error('source_changed_during_verification');
    await currentBuild();

    if (exitCode !== 0 || !raw.passed) {
      run.status = raw.failure?.category === 'environment' ? 'blocked' : 'failed';
      failure = raw.failure ?? { category: 'harness', check: 'scenario-execution' };
    } else run.status = 'passed';
  } catch (error) {
    await writeFile(path.join(run.directory, 'runner-error.txt'), String(error.stack ?? error));
    raw = await readPrivate(run);
    run.status = run.build ? 'failed' : 'blocked';
    failure = { category: 'harness', check: run.build ? 'scenario-execution' : 'build-prerequisite' };
  } finally { await log.close(); }

  const evidence = await publish(run, feature, raw, failure);

  return { ...evidence, privateDiagnostics: run.directory };
}

async function main(args) {
  const json = args.includes('--json');
  const reuse = args.includes('--built');
  const positional = args.filter((arg) => !['--json', '--built'].includes(arg));
  const [command = 'help', target, ...extra] = positional;

  if (positional.length === 1 && command === '--help') return console.log(help);

  if (extra.length || positional.some((arg) => arg.startsWith('-')) || (reuse && !['run', 'controls'].includes(command))) throw new Error('invalid_arguments: use npm run verify -- help');

  if (['help', '--help'].includes(command)) return console.log(help);
  const map = await catalog();
  let result;

  if (command === 'discover' && !target) result = { ...map, commands: ['doctor', 'check', 'build', 'run', 'controls', 'evidence'], evidence: { public: '.wrangler/verification/public/', private: '.wrangler/verification/private/' } };
  else if (command === 'doctor' && !target) result = await doctor();
  else if (command === 'check' && !target) result = await checkContracts();
  else if (command === 'build' && !target) result = { status: 'passed', build: await build() };
  else if (command === 'run' || command === 'controls') {
    const feature = map.features.find((item) => item.id === (command === 'controls' && !target ? 'expense-recovery' : target));

    if (!feature) throw new Error('unknown_scenario: discover lists executable scenarios; URLs and remote targets are not accepted');
    result = await scenario(feature, reuse, command === 'controls');

    if (command === 'controls') {
      const detected = result.status === 'failed' && result.failure?.category === 'product' &&
        result.failure.check === feature.negativeControl.expectedCheck && result.negativeControl?.injected === true && result.cleanup === 'completed';

      result = { status: detected ? 'passed' : 'failed', control: 'lost-outbox', detectedRun: result.runId, observedStatus: result.status,
        scope: 'Real saved outbox erased in disposable IndexedDB; a named product assertion must fail. Inner evidence remains failed.' };
    }
  } else if (command === 'evidence' && /^[a-f0-9-]{36}$/.test(target ?? '')) {
    result = publicEvidenceSchema.parse(JSON.parse(await readFile(path.join('.wrangler/verification/public', `${target}.json`), 'utf8')));
    const source = await sourceIdentity();

    result = { ...result, sourceMatches: result.source.fingerprint === source.fingerprint && result.source.commit === source.commit };

    if (!result.sourceMatches) process.exitCode = 1;
  } else throw new Error('invalid_command_or_target: use npm run verify -- help');

  console.log(JSON.stringify(result, null, json ? 0 : 2));

  if (['failed', 'blocked', 'not-run'].includes(result.status)) process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(JSON.stringify({ status: 'blocked', error: error.message, help: 'npm run verify -- help' }));
  process.exitCode = 2;
});
