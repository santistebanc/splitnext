import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryClientStorage, SplitnextClient, SplitnextSyncClient, SplitnextNetworkError, type SyncTransport } from '../src/client';
import { createIdentifier } from '../src/domain/ids';
import { createInviteToken } from '../src/domain/invites';
import { memoryTransport } from '../apps/client/src/workbench/memoryTransport';
import { applyTestMigrations, randomDeviceSecret } from './harness';

beforeAll(applyTestMigrations);

const transports = {
  HTTP: async () => new SplitnextClient({ baseUrl: 'https://splitnext.test', fetch: (input, init) => exports.default.fetch(input, init), webSocket: () => ({ close: () => undefined }) }),
  memory: async () => (await memoryTransport({
    identity: { id: createIdentifier(), created_at: new Date().toISOString() },
    device: { id: createIdentifier(), created_at: new Date().toISOString() },
  }, [], { connection: 'online', latency: 0, failure: 'none', log: () => undefined })).api,
} satisfies Record<string, () => Promise<SyncTransport>>;

for (const [name, createApi] of Object.entries(transports)) {
  describe(`${name} transport contract`, () => {
    it('shares validation, access failures, invite replacement and retry-safe creation', async () => {
      const api = await createApi();
      const secret = randomDeviceSecret();
      const outsider = randomDeviceSecret();

      await api.createAnonymousIdentity(secret);
      await api.createAnonymousIdentity(outsider);
      const owner = api.forDevice(secret);
      const visitor = api.forDevice(outsider);
      const input = { group_id: createIdentifier(), name: 'Contracts', creator_member_name: 'Ana', invite: { invite_id: createIdentifier(), token: createInviteToken() } };
      const created = await owner.createGroup(input);

      expect(await owner.createGroup(input)).toEqual(created);
      await expect(owner.createGroup({ ...input, name: 'Changed' })).rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' });
      await expect(owner.createGroup({ ...input, name: '' })).rejects.toMatchObject({ name: 'ZodError' });
      await expect(visitor.syncGroup(input.group_id, { known_revision: null, commands: [] })).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
      await expect(visitor.syncGroup(createIdentifier(), { known_revision: null, commands: [] })).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
      const join = { join_id: createIdentifier(), preferred_member: { kind: 'existing' as const, member_id: created.member.id } };

      await expect(visitor.joinGroup(input.group_id, join)).rejects.toMatchObject({ status: 403, code: 'invite_required' });
      await expect(visitor.joinGroup(createIdentifier(), join)).rejects.toMatchObject({ status: 404, code: 'group_not_found' });
      const replacement = await owner.regenerateInvite(input.group_id, { invite_id: createIdentifier(), token: createInviteToken() });

      await expect(visitor.previewInvite(input.group_id, input.invite.token)).rejects.toMatchObject({ status: 403, code: 'invite_replaced' });
      await expect(visitor.regenerateInvite(input.group_id, { invite_id: createIdentifier(), token: createInviteToken() })).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
      const joined = await visitor.joinGroup(input.group_id, { ...join, invite_token: replacement.invite.token });

      expect(joined.access.preferred_member_id).toBe(created.member.id);
      expect((await visitor.listGroups()).groups).toMatchObject([{ group_id: input.group_id, status: 'active' }]);
    });

    it('retains a lost sync response and retries the original command exactly once', async () => {
      const api = await createApi();
      const secret = randomDeviceSecret();
      const device = api.forDevice(secret);
      const sync = device.syncGroup.bind(device);
      let lose = false;
      const ids: string[] = [];

      device.syncGroup = async (groupId, input) => {
        ids.push(...input.commands.map((command) => command.command_id));
        const response = await sync(groupId, input);

        if (lose) { lose = false; throw new SplitnextNetworkError(new Error('response_lost')); }

        return response;
      };

      const intercepted: SyncTransport = { createAnonymousIdentity: (secret) => api.createAnonymousIdentity(secret), forDevice: () => device };
      const client = new SplitnextSyncClient({ api: intercepted, device_secret: secret, storage: new MemoryClientStorage() });

      await client.initializeIdentity();
      const created = await client.createGroup({ name: 'Retry', creator_member_name: 'Ana' });

      lose = true;
      const pending = await client.submit(created.group_id, { type: 'member.create', payload: { display_name: 'Ben' } });

      expect(pending.outbox).toHaveLength(1);
      const settled = await client.syncGroup(created.group_id);

      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
      expect(settled.outbox).toHaveLength(0);
      expect(settled.projected_snapshot?.members.map((member) => member.display_name)).toEqual(['Ana', 'Ben']);
      expect(settled.revision).toBe(2);
    });
  });
}
