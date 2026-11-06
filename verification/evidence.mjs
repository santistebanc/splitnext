import { z } from 'zod';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { digest } from './provenance.mjs';

const hash = z.string().regex(/^[a-f0-9]{64}$/);

export const publicEvidenceSchema = z.object({
  version: z.literal(1), runId: z.uuid(), scenario: z.literal('expense-recovery'),
  status: z.enum(['passed', 'failed', 'blocked', 'not-run']),
  source: z.object({ commit: z.string().regex(/^[a-f0-9]{40,64}$/), fingerprint: hash, patchHash: hash, dirty: z.boolean() }).strict(),
  environment: z.object({ node: z.string(), platform: z.string(), browser: z.string().nullable() }).strict(),
  build: z.object({ inputs: hash, assetsHash: hash, node: z.string() }).strict().nullable(),
  data: z.object({ environmentId: z.uuid(), fixture: z.literal('expense-recovery-v1'), storesInspected: z.number().int().nonnegative(), clientsInspected: z.number().int().nonnegative() }).strict(),
  checks: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]*$/), status: z.enum(['passed', 'failed', 'not-run']) }).strict()),
  oracleControlsRejected: z.array(z.string()),
  negativeControl: z.object({ id: z.literal('lost-outbox'), injected: z.boolean(), expectedCheck: z.literal('outbox-survives-reload') }).strict().nullable(),
  failure: z.object({ category: z.enum(['product', 'harness', 'environment']), check: z.string().regex(/^[a-z][a-z0-9-]*$/) }).strict().nullable(),
  cleanup: z.enum(['completed', 'failed', 'not-started']), limits: z.array(z.string()),
}).strict();

/** Publish an allowlist, never redact-and-upload raw traces, profiles, errors or state. */
export function publicEvidence(run, feature, raw, failure) {
  const completed = new Set(raw?.checkpoints ?? []);
  const failedCheck = failure?.check ?? null;

  if ((raw?.controls ?? []).some((label) => !feature.oracleControls.includes(label))) throw new Error('unrecognized_oracle_control_label');

  return publicEvidenceSchema.parse({
    version: 1, runId: run.id, scenario: feature.id, status: run.status,
    source: { commit: run.source.commit, fingerprint: run.source.fingerprint, patchHash: run.source.patchHash, dirty: run.source.dirty },
    environment: { node: process.version, platform: process.platform, browser: raw?.browser ?? null },
    build: run.build ? { inputs: run.build.inputs, assetsHash: digest(JSON.stringify(run.build.assets)), node: run.build.node } : null,
    data: { environmentId: run.id, fixture: 'expense-recovery-v1', storesInspected: raw?.stores?.length ?? 0, clientsInspected: raw?.clients?.length ?? 0 },
    checks: [...new Set([...feature.expected, ...(failedCheck ? [failedCheck] : [])])].map((id) => ({
      id, status: id === failedCheck ? 'failed' : completed.has(id) ? 'passed' : 'not-run',
    })),
    oracleControlsRejected: raw?.controls ?? [], negativeControl: raw?.negativeControl ?? null,
    failure, cleanup: raw?.cleanup ?? 'not-started', limits: feature.limits,
  });
}

export async function publish(run, feature, raw, failure) {
  const evidence = publicEvidence(run, feature, raw, failure);

  if (evidence.status === 'passed' && (evidence.checks.length === 0 || evidence.checks.some((check) => check.status !== 'passed') || evidence.cleanup !== 'completed'))
    throw new Error('incomplete_evidence_cannot_pass');

  if (evidence.status === 'passed' && (!evidence.build || evidence.data.clientsInspected !== 2 || evidence.data.storesInspected < 1))
    throw new Error('missing_observations_cannot_pass');

  if (evidence.status === 'passed' && JSON.stringify(evidence.oracleControlsRejected) !== JSON.stringify(feature.oracleControls))
    throw new Error('missing_oracle_controls_cannot_pass');
  await mkdir('.wrangler/verification/public', { recursive: true });
  await writeFile(path.join('.wrangler/verification/public', `${run.id}.json`), JSON.stringify(evidence, null, 2));

  return evidence;
}

export async function readPrivate(run) {
  try { return JSON.parse(await readFile(path.join(run.stateDirectory, 'evidence.json'), 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
