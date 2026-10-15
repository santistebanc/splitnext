import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MemoryClientStorage,
  SplitnextClient,
  SplitnextSyncClient,
  type RealtimeSocketFactory,
} from '../src/client';
import {
  AppController,
  type AppPreferences,
} from '../apps/client/src/model/controller';
import { applyTestMigrations, randomDeviceSecret } from './harness';
import { parseClientDocument } from '../src/client/storage';
import { createIdentifier } from '../src/domain/ids';

beforeAll(applyTestMigrations);

const quietSocket: RealtimeSocketFactory = () => ({ close: () => undefined });

function createApp(
  secret = randomDeviceSecret(),
  storage = new MemoryClientStorage(),
  preferences = createPreferences(),
): AppController {
  return new AppController(
    new SplitnextSyncClient({
      api: new SplitnextClient({
        baseUrl: 'https://splitnext.test',
        fetch: (input, init) => exports.default.fetch(input, init),
        webSocket: quietSocket,
      }),
      device_secret: secret,
      storage,
    }),
    preferences,
  );
}

function createPreferences(): AppPreferences {
  let last: string | null = null;
  let name: string | null = null;

  return {
    lastGroup: () => last,
    rememberGroup: (groupId) => {
      last = groupId;
    },
    lastYouName: () => name,
    rememberYouName: (youName) => {
      name = youName;
    },
  };
}

describe('user-facing app flows', () => {
  it('opens the already joined invite target without changing its member selection or rejoining a left group', async () => {
    const app = createApp();

    await app.start(true);
    await app.createGroup({
      name: 'Invite target',
      creator_member_name: 'Santi',
    });
    const target = app.snapshot().group;

    if (!target) throw new Error('Expected the invite target');

    const originalAccess = target.projected_snapshot?.access_grants;
    await app.createGroup({
      name: 'Other group',
      creator_member_name: 'Santi',
    });

    expect(await app.openJoinedGroup(target.group_id)).toBe(true);
    expect(app.snapshot().group?.group_id).toBe(target.group_id);
    expect(app.snapshot().group?.revision).toBe(target.revision);
    expect(app.snapshot().group?.projected_snapshot?.access_grants).toEqual(
      originalAccess,
    );
    expect(await app.openJoinedGroup(createIdentifier())).toBe(false);
    expect(app.snapshot().group?.group_id).toBe(target.group_id);

    app.showGroups();
    const readGroups = app.client.knownGroups.bind(app.client);
    let release: () => void = () => undefined;

    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });

    app.client.knownGroups = async () => {
      await delayed;

      return readGroups();
    };

    let current = true;
    const obsolete = app.openJoinedGroup(target.group_id, () => current);
    current = false;
    release();
    expect(await obsolete).toBe(false);
    expect(app.snapshot().group).toBeNull();
    app.client.knownGroups = readGroups;
    await app.openGroup(target.group_id);

    await app.leaveGroup();
    expect(await app.openJoinedGroup(target.group_id)).toBe(false);
    expect(app.snapshot().group).toBeNull();
    app.dispose();
  });

  it('opens a saved group after upgrading pre-shared-invite storage without losing offline edits', async () => {
    const storage = new MemoryClientStorage();
    const secret = randomDeviceSecret();
    const preferences = createPreferences();
    const first = createApp(secret, storage, preferences);

    await first.start(true);
    await first.createGroup({
      name: 'Saved trip',
      creator_member_name: 'Santi',
    });
    await first.setOnline(false);
    await first.addPerson('Robin');
    first.dispose();

    const saved = parseClientDocument(await storage.read());

    const legacy = {
      ...saved,
      schema_version: 1,
      own_invites: [],
      groups: saved.groups.map((group) => ({
        ...group,
        snapshot: {
          ...group.snapshot,
          invite: {
            id: group.snapshot.invite.id,
            created_by_identity_id:
              group.snapshot.invite.created_by_identity_id,
            created_at: group.snapshot.invite.created_at,
          },
        },
      })),
    };

    await storage.update(() => ({
      serialized: JSON.stringify(legacy),
      result: undefined,
    }));
    const reloaded = createApp(secret, storage, preferences);

    await reloaded.start(true);

    expect(reloaded.snapshot().ready).toBe(true);
    expect(reloaded.snapshot().group?.projected_snapshot?.group.name).toBe(
      'Saved trip',
    );
    expect(
      reloaded
        .snapshot()
        .group?.projected_snapshot?.members.map(
          (member) => member.display_name,
        ),
    ).toContain('Robin');
    expect(reloaded.snapshot().group?.projected_snapshot?.invite.token).toBe(
      saved.groups[0]?.snapshot.invite.token,
    );
    expect(parseClientDocument(await storage.read()).schema_version).toBe(2);
    reloaded.dispose();
  });

  it('opens the last saved group before a stalled online refresh completes', async () => {
    const storage = new MemoryClientStorage();
    const preferences = createPreferences();
    const secret = randomDeviceSecret();
    const first = createApp(secret, storage, preferences);

    await first.start(true);
    await first.createGroup({
      name: 'Saved trip',
      creator_member_name: 'Santi',
    });
    first.dispose();

    let release: () => void = () => undefined;

    const connection = new Promise<void>((resolve) => {
      release = resolve;
    });

    const client = new SplitnextSyncClient({
      api: new SplitnextClient({
        baseUrl: 'https://splitnext.test',
        fetch: async (input, init) => {
          await connection;

          return exports.default.fetch(input, init);
        },
        webSocket: quietSocket,
      }),
      device_secret: secret,
      storage,
    });

    const reopened = new AppController(client, preferences);

    // No response is released until the cached group is available to the UI.
    await reopened.start(true);
    expect(reopened.snapshot().ready).toBe(true);
    expect(reopened.snapshot().group?.projected_snapshot?.group.name).toBe(
      'Saved trip',
    );
    release();
    await reopened.refresh();
    reopened.dispose();
  });
  it('rereads changes made by another tab without rebroadcasting them', async () => {
    const storage = new MemoryClientStorage();
    const preferences = createPreferences();
    const secret = randomDeviceSecret();
    const first = createApp(secret, storage, preferences);
    const second = createApp(secret, storage, preferences);

    await first.start(true);
    await first.createGroup({
      name: 'Trip',
      creator_member_name: 'Santi',
    });
    await second.start(true);
    await first.setOnline(false);
    await first.addPerson('Alex');
    await second.readStorage();

    expect(second.snapshot().group?.projected_snapshot?.members).toHaveLength(
      2,
    );
    expect(second.snapshot().group?.outbox).toHaveLength(1);
    await second.refresh();
    await first.readStorage();
    expect(first.snapshot().group?.outbox).toHaveLength(0);
    first.dispose();
    second.dispose();
  });

  it('marks a conflicting group and applies a fresh intent against its current name', async () => {
    const first = createApp();
    const second = createApp();

    await first.start(true);
    await first.createGroup({
      name: 'Trip',
      creator_member_name: 'Santi',
    });
    await first.regenerateInvite();
    const group = first.snapshot().group;
    const person = group?.projected_snapshot?.members[0];

    if (!group?.projected_snapshot?.invite || !person)
      throw new Error('Expected a group invite');

    await second.start(true);
    await second.joinGroup(
      group.group_id,
      { kind: 'existing', member_id: person.id },
      group.projected_snapshot.invite.token,
    );
    await first.setOnline(false);
    await second.setOnline(false);

    await first.renameGroup('Rome', 'Trip');
    await second.renameGroup('Berlin', 'Trip');

    await second.setOnline(true);
    await first.setOnline(true);
    const notice = first.snapshot().group?.notices[0];

    expect(notice?.outcome.status).toBe('superseded');
    expect(first.snapshot().reviewGroups).toContain(group.group_id);

    if (!notice) throw new Error('Expected a conflict notice');

    await first.applyAgain(notice.command.command_id);
    const result = first.snapshot().group?.projected_snapshot?.group;

    expect(result?.name).toBe('Rome');

    expect(first.snapshot().group?.notices).toHaveLength(0);
    expect(first.snapshot().reviewGroups).not.toContain(group.group_id);
    first.dispose();
    second.dispose();
  });
  it('opens a newly created group with the creator and restores it offline after a reload', async () => {
    const storage = new MemoryClientStorage();
    const preferences = createPreferences();
    const secret = randomDeviceSecret();
    const app = createApp(secret, storage, preferences);

    await app.start(true);
    await app.createGroup({
      name: 'Lisbon weekend',
      creator_member_name: 'Santi',
    });

    const created = app.snapshot().group;

    expect(created?.projected_snapshot?.members).toMatchObject([
      { display_name: 'Santi' },
    ]);
    expect(app.snapshot().groups).toHaveLength(1);
    app.dispose();

    const reopened = createApp(secret, storage, preferences);

    await reopened.start(false);
    expect(reopened.snapshot().group?.group_id).toBe(created?.group_id);
    expect(reopened.snapshot().group?.projected_snapshot?.group.name).toBe(
      'Lisbon weekend',
    );
    reopened.dispose();
  });

  it('lets people be added offline, then synchronizes the saved intent on reconnect', async () => {
    const app = createApp();

    await app.start(true);
    await app.createGroup({
      name: 'Weekend',
      creator_member_name: 'Santi',
    });
    await app.setOnline(false);
    await app.addPerson('Alex');

    expect(app.snapshot().group?.outbox).toHaveLength(1);
    expect(app.snapshot().group?.projected_snapshot?.members).toHaveLength(2);
    await app.setOnline(true);
    expect(app.snapshot().group?.outbox).toHaveLength(0);
    expect(app.snapshot().group?.confirmed_snapshot?.members).toHaveLength(2);
    app.dispose();
  });

  it('shares a group invite without creating a member and lets another installation select an existing name', async () => {
    const creator = createApp();
    const visitor = createApp();

    await creator.start(true);
    await creator.createGroup({
      name: 'Trip',
      creator_member_name: 'Santi',
    });
    expect(creator.snapshot().group?.projected_snapshot?.invite).not.toBeNull();
    expect(
      creator.snapshot().group?.projected_snapshot?.invite.token,
    ).toBeTruthy();
    await creator.addPerson('Alex');

    const group = creator.snapshot().group;

    expect(group?.projected_snapshot?.members).toHaveLength(2);
    expect(group?.projected_snapshot?.access_grants).toHaveLength(1);

    if (!group?.projected_snapshot?.invite)
      throw new Error('Expected a shareable invitation');

    await visitor.start(true);

    const preview = await visitor.client.previewInvite(
      group.group_id,
      group.projected_snapshot.invite.token,
    );

    const alex = preview.members.find(
      (member) => member.display_name === 'Alex',
    );

    if (!alex) throw new Error('Expected Alex in invitation preview');

    await visitor.joinGroup(
      group.group_id,
      { kind: 'existing', member_id: alex.id },
      group.projected_snapshot.invite.token,
    );
    await creator.refresh();
    expect(creator.snapshot().group?.projected_snapshot?.members).toHaveLength(
      2,
    );
    expect(
      creator.snapshot().group?.projected_snapshot?.access_grants,
    ).toHaveLength(2);
    creator.dispose();
    visitor.dispose();
  });

  it('moves a left group out of the active view and permits rejoining without an invite', async () => {
    const app = createApp();

    await app.start(true);
    await app.createGroup({
      name: 'Trip',
      creator_member_name: 'Santi',
    });
    const group = app.snapshot().group;
    const person = group?.projected_snapshot?.members[0];

    if (!group || !person) throw new Error('Expected a created group');

    await app.leaveGroup();
    expect(app.snapshot().group).toBeNull();
    expect(app.snapshot().groups[0]?.status).toBe('left');
    await app.openGroup(group.group_id);
    await app.joinGroup(group.group_id, {
      kind: 'existing',
      member_id: person.id,
    });
    expect(app.snapshot().group?.hidden).toBe(false);
    expect(app.snapshot().groups[0]?.status).toBe('active');
    app.dispose();
  });
});
