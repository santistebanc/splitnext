import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MemoryClientStorage,
  SplitnextClient,
  SplitnextSyncClient,
  type ClientReplicaState,
  type RealtimeSocketHandlers,
  type SyncTransport,
} from '../src/client';
import { RealtimeSubscriptions } from '../src/client/realtime';
import { createIdentifier } from '../src/domain/ids';
import {
  realtimeProtocols,
  revisionAnnouncementSchema,
} from '../src/domain/realtime';
import {
  applyTestMigrations,
  randomDeviceSecret,
  workerWebSocket,
} from './harness';

beforeAll(async () => {
  await applyTestMigrations();
});

describe('realtime revision announcements', () => {
  it('announces the current revision on connect and after applied changes only', async () => {
    const { groupId, creator, joiner } = await createSharedGroup();
    const subscription = await subscribe(groupId, creator.secret);

    expect(subscription.response.status).toBe(101);
    expect(subscription.response.headers.get('sec-websocket-protocol')).toBe(
      'splitnext.v1',
    );
    await expect.poll(() => subscription.revisions).toEqual([2]);

    await joiner.client.syncGroup(groupId);
    await joiner.client.addMember(groupId, 'Taylor');

    await expect.poll(() => subscription.revisions).toEqual([2, 3]);
    subscription.close();
  });

  it('refuses subscriptions without current group access', async () => {
    const { groupId, creator } = await createSharedGroup();
    const outsider = await createIdentity();

    const withoutCredential = await upgrade(groupId, ['splitnext.v1']);

    const withoutProtocol = await upgrade(
      groupId,
      realtimeProtocols(creator.secret).slice(1),
    );

    const outsiderUpgrade = await upgrade(
      groupId,
      realtimeProtocols(outsider.secret),
    );

    const unknownGroup = await upgrade(
      createIdentifier(),
      realtimeProtocols(creator.secret),
    );

    const plainRequest = await exports.default.fetch(
      `https://splitnext.test/groups/${groupId}/realtime`,
      { headers: { authorization: `Bearer v1.${creator.secret}` } },
    );

    expect(withoutCredential.status).toBe(401);
    expect(withoutProtocol.status).toBe(401);
    expect(outsiderUpgrade.status).toBe(401);
    expect(unknownGroup.status).toBe(404);
    expect(plainRequest.status).toBe(426);
  });

  it('closes the subscription of an identity that leaves', async () => {
    const { groupId, joiner } = await createSharedGroup();
    const subscription = await subscribe(groupId, joiner.secret);

    await expect.poll(() => subscription.revisions).toEqual([2]);
    await joiner.client.leaveGroup(groupId);

    await expect.poll(() => subscription.closeCodes).toEqual([4403]);
    expect((await upgrade(groupId, realtimeProtocols(joiner.secret))).status).toBe(
      403,
    );
  });
});

describe('realtime client synchronization', () => {
  it('converges a watching replica without a manual synchronization', async () => {
    const backgroundSyncs: ClientReplicaState[] = [];

    const { groupId, creator, joiner } = await createSharedGroup({
      onCreatorBackgroundSync: (state) => backgroundSyncs.push(state),
    });

    creator.client.watchGroup(groupId);
    await joiner.client.renameGroup(groupId, 'Announced name');

    await expect
      .poll(async () => groupName(await creator.client.inspect(groupId)))
      .toBe('Announced name');
    expect(backgroundSyncs.at(-1)?.revision).toBe(3);
    creator.client.unwatchGroup(groupId);
  });

  it('catches up on announcements missed while offline', async () => {
    const { groupId, creator, joiner } = await createSharedGroup();

    creator.client.watchGroup(groupId);
    creator.client.setOnline(false);
    await joiner.client.renameGroup(groupId, 'Missed name');
    creator.client.setOnline(true);

    await expect
      .poll(async () => groupName(await creator.client.inspect(groupId)))
      .toBe('Missed name');
    creator.client.unwatchGroup(groupId);
  });

  it('turns a burst of announcements into one synchronization', async () => {
    const sockets: RealtimeSocketHandlers[] = [];
    let syncRequests = 0;

    const { groupId, creator, joiner } = await createSharedGroup({
      creatorTransport: (api) => ({
        createAnonymousIdentity: (secret) => api.createAnonymousIdentity(secret),
        forDevice: (secret) => {
          const device = api.forDevice(secret);

          return {
            createGroup: (input) => device.createGroup(input),
            joinGroup: (id, input) => device.joinGroup(id, input),
            syncGroup: (id, input) => {
              syncRequests += 1;

              return device.syncGroup(id, input);
            },
            openRealtime: (_id, handlers) => {
              sockets.push(handlers);

              return { close: () => undefined };
            },
          };
        },
      }),
    });

    await joiner.client.addMember(groupId, 'Taylor');
    creator.client.watchGroup(groupId);

    const socket = sockets[0];

    if (!socket) throw new Error('subscription_not_opened');

    for (let index = 0; index < 5; index += 1) {
      socket.message(JSON.stringify({ type: 'revision', revision: 3 }));
    }

    await expect
      .poll(async () => (await creator.client.inspect(groupId)).revision)
      .toBe(3);
    expect(syncRequests).toBe(1);
  });

  it('stops watching a group after leaving it', async () => {
    const { groupId, joiner } = await createSharedGroup();

    joiner.client.watchGroup(groupId);
    await joiner.client.leaveGroup(groupId);

    expect(joiner.client.isWatching(groupId)).toBe(false);
  });
});

describe('realtime subscriptions', () => {
  it('reconnects after a dropped connection but not after being hidden', async () => {
    const connections: RealtimeSocketHandlers[] = [];

    const subscriptions = new RealtimeSubscriptions({
      connect: (_groupId, handlers) => {
        connections.push(handlers);

        return { close: () => undefined };
      },
      onAnnouncement: () => undefined,
      reconnectDelayMs: () => 0,
    });

    subscriptions.watch('group');
    connections[0]?.close(1006, 'network_error');

    await expect.poll(() => connections.length).toBe(2);

    connections[1]?.close(4403, 'group_hidden');

    expect(subscriptions.isWatching('group')).toBe(false);
  });

  it('disconnects while offline and reconnects immediately when online', () => {
    const connections: RealtimeSocketHandlers[] = [];
    let closed = 0;

    const subscriptions = new RealtimeSubscriptions({
      connect: (_groupId, handlers) => {
        connections.push(handlers);

        return {
          close: () => {
            closed += 1;
          },
        };
      },
      onAnnouncement: () => undefined,
      reconnectDelayMs: () => 60_000,
    });

    subscriptions.watch('group');
    subscriptions.setOnline(false);
    subscriptions.watch('other');
    subscriptions.setOnline(true);

    expect(closed).toBe(1);
    expect(connections).toHaveLength(3);
    subscriptions.unwatch('group');
    subscriptions.unwatch('other');
  });
});

type SharedGroupOptions = {
  creatorTransport?: (api: SplitnextClient) => SyncTransport;
  onCreatorBackgroundSync?: (state: ClientReplicaState) => void;
};

async function createSharedGroup(options: SharedGroupOptions = {}) {
  const api = new SplitnextClient({
    baseUrl: 'https://splitnext.test',
    fetch: (input, init) => exports.default.fetch(input, init),
    webSocket: workerWebSocket,
  });

  const creator = createClient(
    options.creatorTransport?.(api) ?? api,
    options.onCreatorBackgroundSync,
  );

  const joiner = createClient(api);

  await creator.client.initializeIdentity();
  await joiner.client.initializeIdentity();

  const created = await creator.client.createGroup({
    name: 'Berlin flat',
    currency_code: 'EUR',
    creator_member_name: 'Santi',
  });

  await joiner.client.joinGroup(created.group_id, {
    kind: 'new',
    display_name: 'Robin',
  });

  return { groupId: created.group_id, creator, joiner };
}

function createClient(
  api: SyncTransport,
  onBackgroundSync?: (state: ClientReplicaState) => void,
) {
  const secret = randomDeviceSecret();

  const client = new SplitnextSyncClient({
    api,
    device_secret: secret,
    storage: new MemoryClientStorage(),
    realtime_reconnect_delay_ms: () => 10,
    on_background_sync: onBackgroundSync ?? (() => undefined),
  });

  return { secret, client };
}

async function createIdentity() {
  const secret = randomDeviceSecret();

  const response = await exports.default.fetch(
    'https://splitnext.test/identities/anonymous',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_secret: secret }),
    },
  );

  expect(response.status).toBe(201);

  return { secret };
}

function upgrade(groupId: string, protocols: string[]) {
  return exports.default.fetch(
    `https://splitnext.test/groups/${groupId}/realtime`,
    {
      headers: {
        upgrade: 'websocket',
        'sec-websocket-protocol': protocols.join(', '),
      },
    },
  );
}

async function subscribe(groupId: string, secret: string) {
  const response = await upgrade(groupId, realtimeProtocols(secret));
  const socket = response.webSocket;

  if (!socket) throw new Error(`subscription_refused_${response.status}`);

  const revisions: number[] = [];
  const closeCodes: number[] = [];

  const subscription = {
    response,
    revisions,
    closeCodes,
    close: () => socket.close(1000, 'done'),
  };

  socket.accept();
  socket.addEventListener('message', (event) => {
    revisions.push(
      revisionAnnouncementSchema.parse(JSON.parse(String(event.data))).revision,
    );
  });
  socket.addEventListener('close', (event) => {
    closeCodes.push(event.code);
  });

  return subscription;
}

function groupName(state: ClientReplicaState): string | undefined {
  return state.projected_snapshot?.group.name;
}
