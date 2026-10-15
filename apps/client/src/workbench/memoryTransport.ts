import { groupFailureStatus } from '../../../../src/groupTransport';
import { deviceSecretSchema } from '../../../../src/domain/identities';
import { joinGroupRequestSchema } from '../../../../src/domain/access';
import { syncGroupRequestSchema } from '../../../../src/domain/sync';
import type { IdentitySession } from '../../../../src/domain/identities';
import {
  SplitnextRequestError,
  SplitnextNetworkError,
  type ClientReplicaState,
  type SyncTransport,
  type SyncDeviceTransport,
} from '@splitnext/client';
import { createGroupRequestSchema, initializeGroup } from '../../../../src/domain/groups';
import { createIdentifier } from '../../../../src/domain/ids';
import { hashInviteToken, inviteLinkInputSchema, previewInviteRequestSchema } from '../../../../src/domain/invites';
import { MemoryGroupRepository } from '../../../../src/memoryGroupRepository';
import { GroupStore } from '../../../../src/groupStore';
import type { Log } from './stories';

export type TransportControls = {
  latency: number;
  failure: string;
  connection: 'online' | 'offline' | 'unreachable';
  log: Log;
};

/** The production group engine behind an isolated transport; no network or browser storage. */
export async function memoryTransport(session: IdentitySession, replicas: ClientReplicaState[], controls: TransportControls) {
  const repositories = new Map<string, MemoryGroupRepository>();
  const now = () => new Date().toISOString();

  for (const replica of replicas) {
    const snapshot = replica.confirmed_snapshot;

    if (!snapshot) continue;
    const repository = new MemoryGroupRepository();
    const store = new GroupStore(repository);

    const initial = initializeGroup({
      group_id: replica.group_id, creator_identity_id: session.identity.id,
      member_id: snapshot.members[0]?.id ?? createIdentifier(),
      creator_member_name: snapshot.members[0]?.display_name ?? 'Fixture',
      name: snapshot.group.name, invite_id: snapshot.invite.id,
      invite_token: snapshot.invite.token, invite_token_hash: await hashInviteToken(snapshot.invite.token),
      created_at: snapshot.group.created_at,
    });

    store.create(initial);
    repository.transaction((persistence) => {
      const state = persistence.loadState();

      if (!state) throw new Error('missing_workbench_group');
      persistence.saveState({ ...state, revision: replica.revision ?? 1, snapshot, next_actor_number: snapshot.access_grants.length + 1 });
    });
    repositories.set(replica.group_id, repository);
  }

  function requireStore(groupId: string): GroupStore {
    const repository = repositories.get(groupId);

    if (!repository) throw new SplitnextRequestError(404, { error: 'group_not_found' });

    return new GroupStore(repository);
  }

  async function request(name: string, detail: string, mutation = true): Promise<void> {
    controls.log(name, detail);

    if (controls.connection === 'unreachable') throw new SplitnextNetworkError(new TypeError('network_unavailable'));

    if (!mutation) return;
    await new Promise((resolve) => setTimeout(resolve, controls.latency));

    if (controls.failure !== 'none') throw new SplitnextRequestError(409, { error: controls.failure });
  }

  function deviceFor(session: IdentitySession): SyncDeviceTransport {
    return {
    currentIdentity: async () => {
      await request('currentIdentity', '', false);

      return session;
    },
    listGroups: async () => {
      await request('listGroups', '', false);

      return { groups: [...repositories.entries()].flatMap(([groupId, repository]) => {
        const snapshot = new GroupStore(repository).inspect()?.snapshot;
        const access = snapshot?.access_grants.find((grant) => grant.identity_id === session.identity.id);

        return snapshot && access ? [{ group_id: groupId, name: snapshot.group.name,
          status: access.hidden_at ? 'left' as const : 'active' as const,
          granted_at: access.granted_at, left_at: access.hidden_at }] : [];
      }) };
    },
    createGroup: async (raw) => {
      const input = createGroupRequestSchema.parse(raw);
      await request('createGroup', `${input.name} as ${input.creator_member_name}`);
      const repository = repositories.get(input.group_id) ?? new MemoryGroupRepository();

      const result = new GroupStore(repository).create(initializeGroup({
        group_id: input.group_id, creator_identity_id: session.identity.id,
        member_id: createIdentifier(), name: input.name, creator_member_name: input.creator_member_name,
        invite_id: input.invite.invite_id, invite_token: input.invite.token,
        invite_token_hash: await hashInviteToken(input.invite.token), created_at: now(),
      }));

      if (!result.ok) throw new SplitnextRequestError(groupFailureStatus.create(result.error), { error: result.error });
      repositories.set(input.group_id, repository);

      return result.created;
    },
    syncGroup: async (groupId, raw) => {
      const input = syncGroupRequestSchema.parse(raw);
      await request('syncGroup', input.commands.map((command) => command.type).join(', '), input.commands.length > 0);
      const store = new GroupStore(repositories.get(groupId) ?? new MemoryGroupRepository());
      const result = store.sync({ ...input, group_id: groupId, identity_id: session.identity.id }, now());

      if (!result.ok) throw new SplitnextRequestError(groupFailureStatus.sync(result.error), { error: result.error });

      return result.response;
    },
    joinGroup: async (groupId, raw) => {
      const input = joinGroupRequestSchema.parse(raw);
      await request('joinGroup', groupId);

      const result = requireStore(groupId).join({
        ...input, group_id: groupId, identity_id: session.identity.id,
        invite_token_hash: input.invite_token ? await hashInviteToken(input.invite_token) : null,
        joined_at: now(),
      });

      if (!result.ok) throw new SplitnextRequestError(groupFailureStatus.join(result.error), { error: result.error });

      return { revision: result.revision, snapshot: result.snapshot, access: result.access };
    },
    previewInvite: async (groupId, token) => {
      previewInviteRequestSchema.parse({ token });
      await request('previewInvite', groupId);
      const result = requireStore(groupId).previewInvite(await hashInviteToken(token));

      if (!result.ok) throw new SplitnextRequestError(groupFailureStatus.preview(result.error), { error: result.error });

      return result.preview;
    },
    regenerateInvite: async (groupId, raw) => {
      const input = inviteLinkInputSchema.parse(raw);
      await request('regenerateInvite', groupId);

      const result = requireStore(groupId).regenerateInvite({
        ...input, group_id: groupId, identity_id: session.identity.id,
        token_hash: await hashInviteToken(input.token), created_at: now(),
      });

      if (!result.ok) throw new SplitnextRequestError(groupFailureStatus.invite(result.error), { error: result.error });

      return { revision: result.revision, invite: result.invite };
    },
    openRealtime: () => ({ close: () => undefined }),
  };

  }

  const sessions = new Map<string, IdentitySession>();

  function sessionFor(secret: string): IdentitySession {
    deviceSecretSchema.parse(secret);
    let stored = sessions.get(secret);

    if (!stored) {
      stored = sessions.size === 0 ? session : {
        identity: { id: createIdentifier(), created_at: now() },
        device: { id: createIdentifier(), created_at: now() },
      };
      sessions.set(secret, stored);
    }

    return stored;
  }

  const api: SyncTransport = {
    createAnonymousIdentity: async (secret) => {
      await request('createAnonymousIdentity', '', false);

      return sessionFor(secret);
    },
    forDevice: (secret) => deviceFor(sessionFor(secret)),
  };

  return {
    api,
    inspect: (groupId: string) => requireStore(groupId).inspect()?.snapshot,
    /** Everything the server recorded for a group, including outcomes and audit history. */
    repository: (groupId: string) => repositories.get(groupId)?.inspect() ?? null,
  };
}
