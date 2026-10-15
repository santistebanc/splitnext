import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MemoryClientStorage,
  SplitnextClient,
  SplitnextSyncClient,
  type ClientReplicaState,
} from '../src/client';
import { createIdentifier } from '../src/domain/ids';
import {
  applyTestMigrations,
  joinThroughInvite,
  randomDeviceSecret,
} from './harness';

beforeAll(async () => {
  await applyTestMigrations();
});

describe('merging members added concurrently with the same name', () => {
  it('treats an offline addition of an existing name as already satisfied', async () => {
    const { groupId, offline, online } = await createSharedGroup();

    offline.client.setOnline(false);

    const queued = await offline.client.submit(groupId, { type: 'member.create', payload: { display_name: 'Juan' } });
    const localJuan = memberNamed(queued, 'Juan');

    await offline.client.submit(groupId, { type: 'preference.set', payload: { member_id: localJuan } });

    const current = await online.client.submit(groupId, { type: 'member.create', payload: { display_name: 'juan' } });
    const serverJuan = memberNamed(current, 'juan');

    offline.client.setOnline(true);

    const synchronized = await offline.client.syncGroup(groupId);

    expect(synchronized.notices).toEqual([]);
    expect(synchronized.outbox).toEqual([]);
    expect(
      synchronized.confirmed_snapshot?.members.map(({ id }) => id),
    ).not.toContain(localJuan);
    expect(preferredMemberOf(synchronized, offline.identityId)).toBe(serverJuan);
  });

  it('resolves the merged id in later synchronizations', async () => {
    const { groupId, offline, online, api } = await createSharedGroup();
    const current = await online.client.submit(groupId, { type: 'member.create', payload: { display_name: 'Juan' } });
    const serverJuan = memberNamed(current, 'Juan');
    const device = api.forDevice(offline.secret);
    const aliasId = createIdentifier();

    const merged = await device.syncGroup(groupId, {
      known_revision: current.revision,
      commands: [
        {
          command_id: createIdentifier(),
          type: 'member.create',
          payload: { member_id: aliasId, display_name: 'JUAN' },
        },
      ],
    });

    expect(merged.revision).toBe(current.revision);
    expect(merged.outcomes).toMatchObject([
      {
        status: 'no_effect',
        reason: 'member_merged',
        target: { kind: 'member', id: aliasId },
        server_state: { member: { id: serverJuan } },
      },
    ]);

    const renamed = await device.syncGroup(groupId, {
      known_revision: merged.revision,
      commands: [
        {
          command_id: createIdentifier(),
          type: 'member.rename',
          payload: {
            member_id: aliasId,
            expected_display_name: 'Juan',
            display_name: 'Juan P.',
          },
        },
        {
          command_id: createIdentifier(),
          type: 'member.create',
          payload: { member_id: aliasId, display_name: 'Someone else' },
        },
      ],
    });

    expect(renamed.outcomes).toMatchObject([
      {
        status: 'applied',
        target: { kind: 'member', id: serverJuan },
        server_state: { member: { id: serverJuan, display_name: 'Juan P.' } },
      },
      { status: 'rejected', reason: 'member_id_exists' },
    ]);
  });

  it('points commands queued during the merging synchronization at the existing member', async () => {
    let holdNextSync = false;
    let releaseResponse = () => {};

    let responseReached = () => {};

    const responseStarted = new Promise<void>((resolve) => {
      responseReached = resolve;
    });

    const responseReleased = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    const { groupId, offline, online } = await createSharedGroup({
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

    offline.client.setOnline(false);

    const localJuan = memberNamed(
      await offline.client.submit(groupId, { type: 'member.create', payload: { display_name: 'Juan' } }),
      'Juan',
    );

    const serverJuan = memberNamed(
      await online.client.submit(groupId, { type: 'member.create', payload: { display_name: 'Juan' } }),
      'Juan',
    );

    offline.client.setOnline(true);
    holdNextSync = true;

    const synchronization = offline.client.syncGroup(groupId);

    await responseStarted;
    offline.client.setOnline(false);
    await offline.client.submit(groupId, { type: 'preference.set', payload: { member_id: localJuan } });
    releaseResponse();
    await synchronization;

    const replica = await offline.client.inspect(groupId);

    expect(replica.outbox.map(({ command }) => command.payload)).toEqual([
      { member_id: serverJuan },
    ]);
    expect(preferredMemberOf(replica, offline.identityId)).toBe(serverJuan);
  });
});

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function createSharedGroup(
  options: { fetch?: Fetch } = {},
) {
  const api = new SplitnextClient({
    baseUrl: 'https://splitnext.test',
    fetch: options.fetch ?? ((input, init) => exports.default.fetch(input, init)),
  });

  const offline = await createDevice(api);
  const online = await createDevice(api);

  const created = await offline.client.createGroup({
    name: 'Berlin flat',
    creator_member_name: 'Santi',
  });

  await joinThroughInvite(offline.client, online.client, created.group_id, {
    kind: 'new',
    display_name: 'Robin',
  });

  return { api, groupId: created.group_id, offline, online };
}

async function createDevice(api: SplitnextClient) {
  const secret = randomDeviceSecret();

  const client = new SplitnextSyncClient({
    api,
    device_secret: secret,
    storage: new MemoryClientStorage(),
  });

  const session = await client.initializeIdentity();

  return { secret, client, identityId: session.identity.id };
}

function memberNamed(state: ClientReplicaState, displayName: string): string {
  const member = state.projected_snapshot?.members.find(
    (candidate) => candidate.display_name === displayName,
  );

  if (!member) throw new Error(`member_missing_${displayName}`);

  return member.id;
}

function preferredMemberOf(
  state: ClientReplicaState,
  identityId: string,
): string | null | undefined {
  return state.projected_snapshot?.access_grants.find(
    (grant) => grant.identity_id === identityId,
  )?.preferred_member_id;
}
