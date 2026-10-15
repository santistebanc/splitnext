import { MemoryClientStorage, SplitnextSyncClient, type ClientGroupSummary, type ClientReplicaState } from '@splitnext/client';
import { serializeClientDocument } from '../../../../src/client/storage';
import { AppController } from '../model/controller';
import { fixtureGroupId, scenarioPresence, scenarioReplica, type Connection, type MemberListScenario } from './memberListFixture';
import { memoryTransport } from './memoryTransport';
import type { Log } from './stories';

export type FakeApp = AppController;

export type FakeAppOptions = {
  scenario: MemberListScenario;
  connection: Connection;
  latency: number;
  /** Injected server failure; offline commands still enter the real outbox. */
  failure: string;
  log: Log;
  groups?: ClientGroupSummary[];
  notices?: ClientReplicaState['notices'];
  hidden?: boolean;
  /** An invite holder without permanent access to the fixture group. */
  visitor?: boolean;
  lastYouName?: string;
};

/** An isolated installation with real replicas, commands, and server transitions. */
export async function createWorkbenchApp(options: FakeAppOptions): Promise<AppController> {
  function fixture(summary?: ClientGroupSummary): ClientReplicaState {
    const replica = scenarioReplica(options.scenario);
    const snapshot = replica.confirmed_snapshot;

    if (!snapshot) throw new Error('missing_fixture');
    replica.group_id = summary?.group_id ?? fixtureGroupId;
    replica.hidden = summary?.status === 'left' || Boolean(options.hidden);
    replica.notices = options.notices ?? [];
    snapshot.group.id = replica.group_id;
    snapshot.group.name = summary?.name ?? snapshot.group.name;
    const self = snapshot.access_grants[0];

    if (replica.hidden && self) {
      self.hidden_at = snapshot.group.created_at;
      self.preferred_member_id = null;
    }

    if (options.visitor) snapshot.access_grants = snapshot.access_grants.slice(1);

    return replica;
  }

  const replicas = options.groups?.length ? options.groups.map(fixture) : [fixture()];
  const initial = replicas[0];

  if (!initial?.session) throw new Error('missing_fixture_session');
  const transport = await memoryTransport(initial.session, options.groups?.length === 0 ? [] : replicas, options);
  const local = options.visitor || options.groups?.length === 0 ? [] : replicas;

  const storage = new MemoryClientStorage(serializeClientDocument({
    schema_version: 2, session: initial.session,
    groups: local.flatMap((replica) => replica.confirmed_snapshot ? [{
      group_id: replica.group_id, revision: replica.revision ?? 1,
      snapshot: replica.confirmed_snapshot, outbox: [], notices: replica.notices,
      last_synced_at: replica.last_synced_at,
    }] : []),
    pending_group_creations: [], pending_joins: [], pending_invites: [], group_directory: [],
  }));

  const client = new SplitnextSyncClient({ api: transport.api, storage, device_secret: 'w'.repeat(43) });

  // Presence is transient scenario input; all ledger behavior uses the SDK.
  client.presence = (groupId) => scenarioPresence({
    ...options.scenario,
    connection: client.isOnline() && options.connection === 'online' ? 'online' : 'offline',
  }, { ...initial, projected_snapshot: transport.inspect(groupId) ?? null });
  let lastGroup: string | null = options.groups || options.visitor ? null : initial.group_id;
  let lastName = options.lastYouName ?? null;

  const app = new AppController(client, {
    lastGroup: () => lastGroup,
    rememberGroup: (id) => { lastGroup = id; },
    lastYouName: () => lastName,
    rememberYouName: (name) => { lastName = name; },
  });

  await app.start(false);

  if (!options.groups && !options.visitor && !app.snapshot().group) await app.openGroup(initial.group_id);

  if (options.connection !== 'offline') {
    try {
      await app.setOnline(true);
    } catch {
      app.setReachable(false);
    }
  }

  return app;
}

