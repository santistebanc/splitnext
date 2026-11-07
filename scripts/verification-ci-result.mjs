// Dependency-free so failed npm installation still leaves sanitized evidence.
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { sourceIdentity } from '../verification/provenance.mjs';
import { ciReports, failureLines } from '../verification/ci-summary.mjs';

export function ciResult(job, outcome, steps, source) {
  const required = { check: ['install', 'contracts', 'checks'], browser: ['install', 'doctor', 'build', 'browsers'] }[job];

  if (!required) throw new Error('unknown_ci_job');
  const statuses = { success: 'passed', failure: 'failed', cancelled: 'blocked', skipped: 'not-run' };
  const checks = required.map((id) => ({ id, status: statuses[steps[id]?.outcome] ?? 'not-run' }));

  const status = outcome === 'success' && checks.every((check) => check.status === 'passed') ? 'passed'
    : checks.some((check) => check.status === 'failed') ? 'failed' : 'blocked';

  return { version: 1, kind: 'ci-job', runId: randomUUID(), job, status, checks,
    source: { commit: source.commit, fingerprint: source.fingerprint, patchHash: source.patchHash, dirty: source.dirty } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = await sourceIdentity();
  let steps;

  try { steps = JSON.parse(process.env.VERIFICATION_STEPS ?? '{}'); } catch { steps = {}; }

  const result = ciResult(process.env.VERIFICATION_JOB, process.env.VERIFICATION_OUTCOME, steps, source);
  const summaries = await ciReports(process.env.VERIFICATION_JOB, steps, source);

  const inconsistentSuccess = process.env.VERIFICATION_OUTCOME === 'success' && (result.status !== 'passed' || !summaries.passed);

  if (inconsistentSuccess) result.status = 'blocked';

  await mkdir('.wrangler/verification/public', { recursive: true });
  await writeFile(`.wrangler/verification/public/${result.runId}.ci.json`, JSON.stringify({ ...result, ...summaries }, null, 2));

  for (const line of failureLines(summaries.reports)) console.log(line);
  console.log(JSON.stringify({ ...result, ...summaries }));

  if (inconsistentSuccess) process.exitCode = 1;
}
