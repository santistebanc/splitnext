import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import app from '../src/app';
import { MemoryClientStorage, SplitnextClient, SplitnextSyncClient, type ClientDiagnosticEvent } from '../src/client';
import { applyTestMigrations, createDeviceSecret } from './harness';

beforeAll(applyTestMigrations);

const logLineSchema = z.record(z.string(), z.json());

/** Runs work against the Worker with request logs on and returns their lines. */
async function logged(work: (loggingEnv: Env) => Promise<void>) {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((line) => { lines.push(String(line)); });

  try {
    await work({ ...env, LOG_REQUESTS: 'true' });
  } finally {
    spy.mockRestore();
  }

  return { text: lines.join('\n'), entries: lines.map((line) => logLineSchema.parse(JSON.parse(line))) };
}

describe('request logs', () => {
  it('log each request under the id in the client diagnostics, with outcomes but no secrets or names', async () => {
    const secret = createDeviceSecret();
    const events: ClientDiagnosticEvent[] = [];
    let groupId = '';
    let identityId = '';
    let token = '';

    const { text, entries } = await logged(async (loggingEnv) => {
      const api = new SplitnextClient({
        baseUrl: 'https://splitnext.test',
        fetch: async (input, init) => app.fetch(new Request(input, init), loggingEnv),
        webSocket: () => ({ close: () => undefined }),
      });

      const client = new SplitnextSyncClient({ api, storage: new MemoryClientStorage(), device_secret: secret });

      client.observeDiagnostics((event) => events.push(event));
      await client.initializeIdentity();
      const created = await client.createGroup({ name: 'Secret trip', creator_member_name: 'Private Ana' });

      groupId = created.group_id;
      identityId = created.session?.identity.id ?? '';
      token = created.projected_snapshot?.invite.token ?? '';
      await client.submit(groupId, { type: 'member.create', payload: { display_name: 'Private Ben' } });
    });

    const sync = events.find((event) => event.kind === 'response' && event.operation === 'syncGroup');

    if (sync?.kind !== 'response') throw new Error('missing sync diagnostics');

    expect(entries.find((entry) => entry.request_id === sync.request_id)).toMatchObject({
      event: 'request',
      method: 'POST',
      route: '/groups/:groupId/sync',
      status: 200,
      error: null,
      group_id: groupId,
      identity_id: identityId,
      revision: 2,
      outcomes: [{ command_id: sync.command_ids[0] ?? 'missing', type: 'member.create', status: 'applied', reason: null }],
    });

    for (const hidden of [secret, token, 'Secret trip', 'Private Ana', 'Private Ben']) expect(text).not.toContain(hidden);
  });

  it('log failures with their error code and replace an unusable request id', async () => {
    let echoed: string | null = null;

    const { entries } = await logged(async (loggingEnv) => {
      const response = await app.fetch(
        new Request(`https://splitnext.test/groups/${'g'.repeat(22)}/sync`, {
          method: 'POST',
          headers: { 'x-request-id': 'not a usable id', 'content-type': 'application/json' },
          body: JSON.stringify({ known_revision: null, commands: [] }),
        }),
        loggingEnv,
      );

      echoed = response.headers.get('x-request-id');
    });

    expect(echoed).toMatch(/^[0-9a-f-]{36}$/);
    expect(entries).toEqual([expect.objectContaining({ request_id: echoed, status: 401, error: 'unauthorized', route: '/groups/:groupId/sync' })]);
  });
});
