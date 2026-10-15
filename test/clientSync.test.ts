import type { ClientStorageUpdate } from '../src/client/storage';
import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ClientStorageError,
  MemoryClientStorage,
  SplitnextClient,
  SplitnextSyncClient,
  type ClientTransportEvent,
} from '../src/client';
import { createGroupRequestSchema } from '../src/domain/groups';
import { hashInviteToken } from '../src/domain/invites';
import { applyTestMigrations, joinThroughInvite } from './harness';
import { createdGroupSchema } from '../src/domain/groups';

beforeAll(async () => {
  await applyTestMigrations();
});

describe('stateful offline client SDK', () => {
  it('classifies storage read failures during initialization without marking them as network failures', async () => {
    const storage = new MemoryClientStorage();

    vi.spyOn(storage, 'read').mockRejectedValue(new Error('disk_unavailable'));
    const client = createSyncClient('b', storage);

    await expect(client.initializeIdentity()).rejects.toMatchObject({ name: 'ClientStorageError', code: 'storage_unavailable', cause: expect.any(Error) });
  });

  it('reads installation summaries, notice counts and requested replicas with one storage read', async () => {
    const storage = new MemoryClientStorage();
    const client = createSyncClient('b', storage);

    await client.initializeIdentity();
    const created = await client.createGroup({ name: 'Batch read', creator_member_name: 'Ana' });

    client.setOnline(false);
    await client.submit(created.group_id, { type: 'group.rename', payload: { name: 'Offline name' } });
    const read = vi.spyOn(storage, 'read');
    const installation = await client.installationState([created.group_id, created.group_id]);

    expect(read).toHaveBeenCalledTimes(1);
    expect(installation.groups).toMatchObject([{ name: 'Offline name', pending_commands: 1 }]);
    expect(installation.notice_counts[created.group_id]).toBe(0);
    expect(installation.replicas).toHaveLength(1);
    expect(installation.replicas[0]?.projected_snapshot?.group.name).toBe('Offline name');
    expect(installation.replicas[0]?.outbox).toHaveLength(1);
  });

  it('retries a rename through a merged member alias using the current real member', async () => {
    const editor = createSyncClient('e');
    const other = createSyncClient('f');

    await editor.initializeIdentity();
    await other.initializeIdentity();
    const created = await editor.createGroup({ name: 'Alias retries', creator_member_name: 'Ana' });

    await joinThroughInvite(editor, other, created.group_id, { kind: 'new', display_name: 'Visitor' });
    await editor.syncGroup(created.group_id);
    editor.setOnline(false);
    const local = await editor.submit(created.group_id, { type: 'member.create', payload: { display_name: 'Shared' } });
    const alias = local.projected_snapshot?.members.find((member) => member.display_name === 'Shared');

    if (!alias) throw new Error('missing alias');
    await editor.submit(created.group_id, { type: 'member.rename', payload: { member_id: alias.id, display_name: 'Taken' } });
    await other.submit(created.group_id, { type: 'member.create', payload: { display_name: 'Shared' } });
    const competing = await other.submit(created.group_id, { type: 'member.create', payload: { display_name: 'Taken' } });
    const taken = competing.projected_snapshot?.members.find((member) => member.display_name === 'Taken');

    if (!taken) throw new Error('missing competing member');
    editor.setOnline(true);
    const conflict = await editor.syncGroup(created.group_id);
    const notice = conflict.notices[0];

    if (!notice) throw new Error('missing notice');
    expect(notice.command).toMatchObject({ type: 'member.rename', payload: { member_id: alias.id } });
    expect(conflict.projected_snapshot?.members.some((member) => member.id === alias.id)).toBe(false);
    await other.submit(created.group_id, { type: 'member.archive', payload: { member_id: taken.id } });
    await editor.syncGroup(created.group_id);
    const retried = await editor.retryNotice(created.group_id, notice.command.command_id);

    expect(retried.notices).toHaveLength(0);
    expect(retried.confirmed_snapshot?.members.filter((member) => member.status === 'active' && member.display_name === 'Taken')).toHaveLength(1);
  });

  it('retains a notice on storage failure and retries it once across client instances offline', async () => {
    class FailingStorage extends MemoryClientStorage {
      fail = false;

      override async update<T>(change: (current: string | null) => ClientStorageUpdate<T>): Promise<T> {
        if (this.fail) throw new Error('disk_full');

        return super.update(change);
      }
    }

    const storage = new FailingStorage();
    const editor = createSyncClient('c', storage);
    const other = createSyncClient('d');

    await editor.initializeIdentity();
    await other.initializeIdentity();
    const created = await editor.createGroup({ name: 'Original', creator_member_name: 'Ana' });

    await joinThroughInvite(editor, other, created.group_id, { kind: 'new', display_name: 'Ben' });
    await other.submit(created.group_id, { type: 'group.rename', payload: { name: 'Their name' } });
    const conflict = await editor.submit(created.group_id, { type: 'group.rename', payload: { name: 'My name', expected_name: 'Original' } });
    const notice = conflict.notices[0];

    if (!notice) throw new Error('missing notice');
    editor.setOnline(false);
    storage.fail = true;
    await expect(editor.retryNotice(created.group_id, notice.command.command_id)).rejects.toThrow('storage_unavailable');
    storage.fail = false;
    expect((await editor.inspect(created.group_id)).notices).toHaveLength(1);
    expect((await editor.inspect(created.group_id)).outbox).toHaveLength(0);
    const sameInstallation = createSyncClient('c', storage);

    sameInstallation.setOnline(false);
    await sameInstallation.initializeIdentity();

    const retries = await Promise.allSettled([
      editor.retryNotice(created.group_id, notice.command.command_id),
      sameInstallation.retryNotice(created.group_id, notice.command.command_id),
    ]);

    expect(retries.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const queued = await sameInstallation.inspect(created.group_id);

    expect(queued.notices).toHaveLength(0);
    expect(queued.outbox).toHaveLength(1);
    expect(queued.outbox[0]?.command.command_id).not.toBe(notice.command.command_id);
    expect(queued.outbox[0]?.command).toMatchObject({
      type: 'group.rename', payload: { expected_name: 'Their name', name: 'My name' },
    });
    expect(queued.projected_snapshot?.group.name).toBe('My name');
    sameInstallation.setOnline(true);
    const applied = await sameInstallation.syncGroup(created.group_id);

    expect(applied.confirmed_snapshot?.group.name).toBe('My name');
    expect(applied.notices).toHaveLength(0);
  });

  it('projects offline commands and reconciles them through the outbox', async () => {
    const client = createSyncClient('M');

    await client.initializeIdentity();

    const created = await client.createGroup({
      name: 'Berlin flat',
      creator_member_name: 'Santi',
    });

    client.setOnline(false);
    const offline = await client.submit(created.group_id, { type: 'member.create', payload: { display_name: 'Robin' } });

    expect(offline.revision).toBe(1);
    expect(offline.outbox).toHaveLength(1);
    expect(offline.confirmed_snapshot?.members).toHaveLength(1);
    expect(offline.projected_snapshot?.members).toMatchObject([
      { display_name: 'Santi' },
      { display_name: 'Robin' },
    ]);

    client.setOnline(true);
    const synchronized = await client.syncGroup(created.group_id);

    expect(synchronized.revision).toBe(2);
    expect(synchronized.outbox).toEqual([]);
    expect(synchronized.confirmed_snapshot?.members).toHaveLength(2);
  });

  it('preserves the creation invite when sync arrives before creation confirmation', async () => {
    const api = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      fetch: async (input, init) => {
        const response = await exports.default.fetch(input, init);

        if (new URL(input).pathname === '/groups' && init?.method === 'POST') {
          const created = createdGroupSchema.parse(
            await response.clone().json(),
          );

          // Background discovery can synchronize a group while its creation
          // response is still on the way to the creating installation.
          await client.syncGroup(created.group.id);
        }

        return response;
      },
    });

    const client = new SplitnextSyncClient({
      api,
      device_secret: 'b'.repeat(43),
      storage: new MemoryClientStorage(),
    });

    await client.initializeIdentity();

    const created = await client.createGroup({
      name: 'Background discovery',
      creator_member_name: 'Santi',
    });

    expect(created.projected_snapshot?.invite).not.toBeNull();
    expect(created.projected_snapshot?.invite.id).toBe(
      created.confirmed_snapshot?.invite?.id,
    );

    if (!created.projected_snapshot?.invite)
      throw new Error('Expected the creation invite');

    const preview = await client.previewInvite(
      created.group_id,
      created.projected_snapshot.invite.token,
    );

    expect(preview.group.name).toBe('Background discovery');
  });

  it('retains simultaneous offline commands', async () => {
    const client = createSyncClient('S');

    await client.initializeIdentity();

    const created = await client.createGroup({
      name: 'Berlin flat',
      creator_member_name: 'Santi',
    });

    client.setOnline(false);

    await Promise.all([
      client.submit(created.group_id, { type: 'member.create', payload: { display_name: 'Robin' } }),
      client.submit(created.group_id, { type: 'member.create', payload: { display_name: 'Taylor' } }),
    ]);

    const replica = await client.inspect(created.group_id);

    expect(replica.outbox).toHaveLength(2);
    expect(
      replica.projected_snapshot?.members.map((member) => member.display_name),
    ).toEqual(['Santi', 'Robin', 'Taylor']);
  });

  it('retains a command queued while synchronization is in flight', async () => {
    let holdNextSync = false;
    let releaseResponse = () => {};

    let responseReached = () => {};

    const responseStarted = new Promise<void>((resolve) => {
      responseReached = resolve;
    });

    const responseReleased = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    const api = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      fetch: async (input, init) => {
        const response = await exports.default.fetch(input, init);

        if (holdNextSync && new URL(input).pathname.endsWith('/sync')) {
          holdNextSync = false;
          responseReached();
          await responseReleased;
        }

        return response;
      },
    });

    const client = new SplitnextSyncClient({
      api,
      device_secret: 'T'.repeat(43),
      storage: new MemoryClientStorage(),
    });

    await client.initializeIdentity();

    const created = await client.createGroup({
      name: 'Berlin flat',
      creator_member_name: 'Santi',
    });

    holdNextSync = true;
    const synchronization = client.syncGroup(created.group_id);

    await responseStarted;
    client.setOnline(false);
    await client.submit(created.group_id, { type: 'member.create', payload: { display_name: 'Robin' } });
    releaseResponse();
    await synchronization;

    const replica = await client.inspect(created.group_id);

    expect(replica.outbox).toHaveLength(1);
    expect(replica.projected_snapshot?.members).toMatchObject([
      { display_name: 'Santi' },
      { display_name: 'Robin' },
    ]);
  });

  it('supersedes a rename based on a name that changed while editing', async () => {
    const editor = createSyncClient('X');
    const other = createSyncClient('Y');

    await editor.initializeIdentity();
    await other.initializeIdentity();

    const created = await editor.createGroup({
      name: 'Berlin flat',
      creator_member_name: 'Santi',
    });

    await joinThroughInvite(editor, other, created.group_id, {
      kind: 'new',
      display_name: 'Robin',
    });

    const seen = created.projected_snapshot?.group.name;

    await other.submit(created.group_id, { type: 'group.rename', payload: { name: 'Their name' } });
    await editor.syncGroup(created.group_id);

    const renamed = await editor.submit(created.group_id, { type: 'group.rename', payload: { name: 'My name', expected_name: seen } });

    expect(renamed.projected_snapshot?.group.name).toBe('Their name');
    expect(renamed.notices).toMatchObject([
      { outcome: { status: 'superseded', reason: 'group_changed' } },
    ]);
  });

  it('turns a concurrent offline conflict into a local notice', async () => {
    const first = createSyncClient('N');
    const second = createSyncClient('O');

    await first.initializeIdentity();
    await second.initializeIdentity();

    const created = await first.createGroup({
      name: 'Berlin flat',
      creator_member_name: 'Santi',
    });

    await joinThroughInvite(first, second, created.group_id, {
      kind: 'new',
      display_name: 'Robin',
    });

    first.setOnline(false);
    second.setOnline(false);
    await first.submit(created.group_id, { type: 'group.rename', payload: { name: 'Summer trip' } });
    await second.submit(created.group_id, { type: 'group.rename', payload: { name: 'Winter trip' } });

    first.setOnline(true);
    await first.syncGroup(created.group_id);
    second.setOnline(true);
    const reconciled = await second.syncGroup(created.group_id);

    expect(reconciled.projected_snapshot?.group.name).toBe('Summer trip');
    expect(reconciled.outbox).toEqual([]);
    expect(reconciled.notices).toMatchObject([
      {
        command: {
          type: 'group.rename',
          payload: {
            expected_name: 'Berlin flat',
            name: 'Winter trip',
          },
        },
        outcome: {
          command_type: 'group.rename',
          status: 'superseded',
          reason: 'group_changed',
        },
      },
    ]);
  });

  it('owns preferred-member selection, removal, leaving, and rejoining', async () => {
    const client = createSyncClient('R');

    await client.initializeIdentity();

    const created = await client.createGroup({
      name: 'Berlin flat',
      creator_member_name: 'Santi',
    });

    const withRobin = await client.submit(created.group_id, { type: 'member.create', payload: { display_name: 'Robin' } });

    const robin = withRobin.projected_snapshot?.members.find(
      (member) => member.display_name === 'Robin',
    );

    const santi = withRobin.projected_snapshot?.members.find(
      (member) => member.display_name === 'Santi',
    );

    expect(robin).toBeDefined();
    expect(santi).toBeDefined();

    if (!robin || !santi) throw new Error('expected_members_missing');

    const preferred = await client.submit(created.group_id, {
      type: 'preference.set',
      payload: { member_id: robin.id },
    });

    expect(preferred.projected_snapshot?.access_grants[0]).toMatchObject({
      preferred_member_id: robin.id,
    });

    const removed = await client.submit(created.group_id, { type: 'member.archive', payload: { member_id: robin.id } });

    expect(
      removed.projected_snapshot?.members.find(
        (member) => member.id === robin.id,
      ),
    ).toMatchObject({ status: 'archived' });
    expect(removed.projected_snapshot?.access_grants[0]).toMatchObject({
      preferred_member_id: null,
    });

    const left = await client.submit(created.group_id, { type: 'group.leave', payload: {} });

    expect(left.hidden).toBe(true);

    const rejoined = await client.joinGroup(created.group_id, {
      kind: 'existing',
      member_id: santi.id,
    });

    expect(rejoined.hidden).toBe(false);
    expect(rejoined.projected_snapshot?.access_grants[0]).toMatchObject({
      preferred_member_id: santi.id,
      hidden_at: null,
    });
  });

  it('retries the same command after the server response is lost', async () => {
    let loseNextSyncResponse = false;

    const api = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      fetch: async (input, init) => {
        const response = await exports.default.fetch(input, init);

        if (loseNextSyncResponse && new URL(input).pathname.endsWith('/sync')) {
          loseNextSyncResponse = false;
          throw new Error('simulated_response_loss');
        }

        return response;
      },
    });

    const client = new SplitnextSyncClient({
      api,
      device_secret: 'P'.repeat(43),
      storage: new MemoryClientStorage(),
    });

    await client.initializeIdentity();

    const created = await client.createGroup({
      name: 'Berlin flat',
      creator_member_name: 'Santi',
    });

    loseNextSyncResponse = true;

    const queued = await client.submit(created.group_id, { type: 'member.create', payload: { display_name: 'Robin' } });

    expect(queued.outbox).toHaveLength(1);
    expect(queued.projected_snapshot?.members).toHaveLength(2);

    const retried = await client.syncGroup(created.group_id);

    expect(retried.outbox).toEqual([]);
    expect(retried.revision).toBe(2);
    expect(retried.projected_snapshot?.members).toHaveLength(2);

    // Leaving starts only online, but a lost response is not a failure: the
    // group shows as left and the queued leave completes on the next sync.
    loseNextSyncResponse = true;
    const leaving = await client.submit(created.group_id, { type: 'group.leave', payload: {} });

    expect(leaving.hidden).toBe(true);
    expect(leaving.outbox).toHaveLength(1);
    const left = await client.refreshGroup(created.group_id);

    expect(left.outbox).toEqual([]);
    expect(left.hidden).toBe(true);
    expect(left.confirmed_snapshot?.access_grants[0]?.hidden_at).not.toBeNull();
    client.setOnline(false);
    await expect(client.submit(created.group_id, { type: 'group.leave', payload: {} })).rejects.toMatchObject({ name: 'ClientOfflineError' });
  });

  it('reuses the group id and usable initial link after a lost response and reload', async () => {
    let loseCreationResponse = false;

    const requests: {
      group_id: string;
      invite_id: string;
      token_hash: string;
    }[] = [];

    const diagnostics: ClientTransportEvent[] = [];
    const storage = new MemoryClientStorage();

    const api = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      observer: (event) => diagnostics.push(event),
      fetch: async (input, init) => {
        if (new URL(input).pathname === '/groups' && init?.method === 'POST') {
          const body = createGroupRequestSchema.parse(
            JSON.parse(await new Request(input, init).text()),
          );

          requests.push({
            group_id: body.group_id,
            invite_id: body.invite.invite_id,
            token_hash: await hashInviteToken(body.invite.token),
          });
        }

        const response = await exports.default.fetch(input, init);

        if (loseCreationResponse && new URL(input).pathname === '/groups') {
          loseCreationResponse = false;
          throw new Error('simulated_creation_response_loss');
        }

        return response;
      },
    });

    const client = new SplitnextSyncClient({
      api,
      device_secret: 'Q'.repeat(43),
      storage,
    });

    const input = {
      name: 'Retry group',
      creator_member_name: 'Santi',
    };

    await client.initializeIdentity();
    loseCreationResponse = true;

    await expect(client.createGroup(input)).rejects.toThrow(
      'simulated_creation_response_loss',
    );

    const reloaded = new SplitnextSyncClient({
      api,
      device_secret: 'Q'.repeat(43),
      storage,
    });

    const recovered = await reloaded.createGroup(input);

    expect(recovered.revision).toBe(1);
    expect(recovered.projected_snapshot?.group.name).toBe('Retry group');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(recovered.projected_snapshot?.invite).not.toBeNull();

    if (!recovered.projected_snapshot?.invite)
      throw new Error('initial_invite_missing');

    const preview = await reloaded.previewInvite(
      recovered.group_id,
      recovered.projected_snapshot.invite.token,
    );

    expect(preview.members).toHaveLength(1);
    expect(
      JSON.stringify(diagnostics).includes(
        recovered.projected_snapshot.invite.token,
      ),
    ).toBe(false);
  });

  it('retains concurrent commands from two clients sharing storage', async () => {
    const storage = new MemoryClientStorage();
    const first = createSyncClient('U', storage);
    const second = createSyncClient('U', storage);

    await first.initializeIdentity();

    const created = await first.createGroup({
      name: 'Shared replica',
      creator_member_name: 'Santi',
    });

    first.setOnline(false);
    second.setOnline(false);

    await Promise.all([
      first.submit(created.group_id, { type: 'member.create', payload: { display_name: 'Robin' } }),
      second.submit(created.group_id, { type: 'member.create', payload: { display_name: 'Taylor' } }),
    ]);

    const replica = await first.inspect(created.group_id);

    expect(replica.outbox).toHaveLength(2);
    expect(
      replica.projected_snapshot?.members.map((member) => member.display_name),
    ).toEqual(['Santi', 'Robin', 'Taylor']);
  });

  it('rejects malformed and unsupported persisted documents', async () => {
    const malformed = createSyncClient(
      'V',
      new MemoryClientStorage('{not-json'),
    );

    const unsupported = createSyncClient(
      'W',
      new MemoryClientStorage(JSON.stringify({ schema_version: 999 })),
    );

    await expect(malformed.initializeIdentity()).rejects.toEqual(
      expect.objectContaining<Partial<ClientStorageError>>({
        code: 'corrupt_document',
      }),
    );
    await expect(unsupported.initializeIdentity()).rejects.toEqual(
      expect.objectContaining<Partial<ClientStorageError>>({
        code: 'unsupported_schema_version',
      }),
    );
  });
});

function createSyncClient(seed: string, storage = new MemoryClientStorage()) {
  const api = new SplitnextClient({
    baseUrl: 'https://splitnext.test',
    fetch: (input, init) => exports.default.fetch(input, init),
  });

  return new SplitnextSyncClient({
    api,
    device_secret: seed.repeat(43),
    storage,
  });
}
