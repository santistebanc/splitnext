import { describe, expect, it } from 'vitest';
import { initializeGroup } from '../src/domain/groups';
import { createIdentifier } from '../src/domain/ids';
import { MemoryGroupRepository } from '../src/groupRepository';
import { GroupStore } from '../src/groupStore';

describe('in-memory group repository adapter', () => {
  it('runs the same group engine without Cloudflare storage', () => {
    const repository = new MemoryGroupRepository();
    const store = new GroupStore(repository);
    const groupId = createIdentifier();
    const identityId = createIdentifier();
    const memberId = createIdentifier();
    const createdAt = '2026-09-23T10:00:00.000Z';

    const created = store.create(
      initializeGroup({
        group_id: groupId,
        creator_identity_id: identityId,
        member_id: memberId,
        name: 'Test group',
        currency_code: 'EUR',
        creator_member_name: 'Santi',
        created_at: createdAt,
      }),
    );

    const synced = store.sync(
      {
        group_id: groupId,
        identity_id: identityId,
        known_revision: 1,
        commands: [
          {
            command_id: createIdentifier(),
            type: 'group.rename',
            payload: { expected_name: 'Test group', name: 'Renamed group' },
          },
        ],
      },
      '2026-09-23T10:01:00.000Z',
    );

    expect(created.ok).toBe(true);
    expect(synced).toMatchObject({
      ok: true,
      response: {
        revision: 2,
        state: { snapshot: { group: { name: 'Renamed group' } } },
      },
    });

    store.sync(
      {
        group_id: groupId,
        identity_id: identityId,
        known_revision: 1,
        commands: [
          {
            command_id: createIdentifier(),
            type: 'group.rename',
            payload: {
              expected_name: 'Test group',
              name: 'Stale rename',
            },
          },
        ],
      },
      '2026-09-23T10:02:00.000Z',
    );

    expect(store.history()).toMatchObject([
      {
        sequence: 1,
        revision: 1,
        change: { action: 'group.created' },
        actor_member_name: 'Santi',
      },
      {
        sequence: 2,
        revision: 2,
        change: { action: 'group.renamed' },
        actor_member_name: 'Santi',
      },
    ]);
    expect(repository.inspect()).toMatchObject({
      state: {
        revision: 2,
        snapshot: { group: { name: 'Renamed group' } },
      },
      audit_events: [{ sequence: 1 }, { sequence: 2 }],
    });
    expect(repository.inspect().command_outcomes).toHaveLength(2);
  });

  it('keeps actor attribution as it was when each transition occurred', () => {
    const repository = new MemoryGroupRepository();
    const store = new GroupStore(repository);
    const groupId = createIdentifier();
    const identityId = createIdentifier();
    const memberId = createIdentifier();

    store.create(
      initializeGroup({
        group_id: groupId,
        creator_identity_id: identityId,
        member_id: memberId,
        name: 'Trip',
        currency_code: 'EUR',
        creator_member_name: 'Santi',
        created_at: '2026-09-23T10:00:00.000Z',
      }),
    );
    store.sync(
      {
        group_id: groupId,
        identity_id: identityId,
        known_revision: 1,
        commands: [
          {
            command_id: createIdentifier(),
            type: 'member.rename',
            payload: {
              member_id: memberId,
              expected_display_name: 'Santi',
              display_name: 'Santiago',
            },
          },
          {
            command_id: createIdentifier(),
            type: 'group.rename',
            payload: { expected_name: 'Trip', name: 'Summer trip' },
          },
        ],
      },
      '2026-09-23T10:01:00.000Z',
    );

    expect(
      store.history().map((event) => ({
        action: event.change.action,
        actor_member_name: event.actor_member_name,
      })),
    ).toEqual([
      { action: 'group.created', actor_member_name: 'Santi' },
      { action: 'member.renamed', actor_member_name: 'Santi' },
      { action: 'group.renamed', actor_member_name: 'Santiago' },
    ]);
  });

  it('merges identities without rewriting prior audit events', () => {
    const repository = new MemoryGroupRepository();
    const store = new GroupStore(repository);
    const groupId = createIdentifier();
    const accountId = createIdentifier();
    const guestId = createIdentifier();
    const guestMemberId = createIdentifier();
    const tokenHash = 'f'.repeat(64);

    store.create(
      initializeGroup({
        group_id: groupId,
        creator_identity_id: accountId,
        member_id: createIdentifier(),
        name: 'Trip',
        currency_code: 'EUR',
        creator_member_name: 'Account member',
        created_at: '2026-09-23T10:00:00.000Z',
      }),
    );
    store.createInvite({
      group_id: groupId,
      identity_id: accountId,
      invite_id: createIdentifier(),
      token_hash: tokenHash,
      created_at: '2026-09-23T10:01:00.000Z',
      expires_at: '2026-09-23T11:01:00.000Z',
    });
    store.join({
      group_id: groupId,
      identity_id: guestId,
      join_id: createIdentifier(),
      joined_at: '2026-09-23T10:02:00.000Z',
      invite_token_hash: tokenHash,
      preferred_member: {
        kind: 'new',
        member_id: guestMemberId,
        display_name: 'Guest member',
      },
    });

    const beforeMerge = store.history();

    const merged = store.mergeIdentity(
      guestId,
      accountId,
      '2026-09-23T10:03:00.000Z',
    );

    const afterMerge = store.history();

    expect(merged).toMatchObject({
      ok: true,
      changed: true,
      access: { identity_id: accountId, preferred_member_id: guestMemberId },
    });
    expect(afterMerge.slice(0, beforeMerge.length)).toEqual(beforeMerge);
    expect(afterMerge.at(-1)).toMatchObject({
      actor_identity_id: guestId,
      change: { action: 'identity.merged' },
    });
  });

  it('moves a guest-only group grant to the account identity', () => {
    const repository = new MemoryGroupRepository();
    const store = new GroupStore(repository);
    const groupId = createIdentifier();
    const guestId = createIdentifier();
    const accountId = createIdentifier();

    store.create(
      initializeGroup({
        group_id: groupId,
        creator_identity_id: guestId,
        member_id: createIdentifier(),
        name: 'Guest group',
        currency_code: 'EUR',
        creator_member_name: 'Guest',
        created_at: '2026-09-23T10:00:00.000Z',
      }),
    );

    const merged = store.mergeIdentity(
      guestId,
      accountId,
      '2026-09-23T10:01:00.000Z',
    );

    expect(merged).toMatchObject({
      ok: true,
      changed: true,
      access: { identity_id: accountId },
    });
    expect(store.inspect()?.snapshot.access_grants).toEqual([
      expect.objectContaining({ identity_id: accountId }),
    ]);

    const authorized = store.sync(
      {
        group_id: groupId,
        identity_id: accountId,
        known_revision: 2,
        commands: [],
      },
      '2026-09-23T10:02:00.000Z',
    );

    expect(authorized.ok).toBe(true);
  });

  it('repairs an old guest grant when the account next synchronizes', () => {
    const repository = new MemoryGroupRepository();
    const store = new GroupStore(repository);
    const groupId = createIdentifier();
    const guestId = createIdentifier();
    const accountId = createIdentifier();

    store.create(
      initializeGroup({
        group_id: groupId,
        creator_identity_id: guestId,
        member_id: createIdentifier(),
        name: 'Legacy merged group',
        currency_code: 'EUR',
        creator_member_name: 'Guest',
        created_at: '2026-09-23T10:00:00.000Z',
      }),
    );
    store.mergeIdentity(guestId, accountId, '2026-09-23T10:01:00.000Z');

    const legacyState = repository.inspect();
    const accountGrant = legacyState.state?.snapshot.access_grants[0];

    if (!legacyState.state || !accountGrant) throw new Error('group_state_missing');

    legacyState.state.snapshot.access_grants = [
      { ...accountGrant, identity_id: guestId },
    ];

    const restoredStore = new GroupStore(new MemoryGroupRepository(legacyState));

    const sync = restoredStore.sync(
      {
        group_id: groupId,
        identity_id: accountId,
        known_revision: legacyState.state.revision,
        commands: [],
      },
      '2026-09-23T10:02:00.000Z',
    );

    expect(sync).toMatchObject({
      ok: true,
      response: {
        state: {
          kind: 'snapshot',
          snapshot: {
            access_grants: [expect.objectContaining({ identity_id: accountId })],
          },
        },
      },
    });
  });

  it('does not commit a transaction that throws', () => {
    const repository = new MemoryGroupRepository();

    expect(() =>
      repository.transaction(() => {
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(repository.inspect()).toEqual({
      state: null,
      audit_events: [],
      command_outcomes: [],
      join_outcomes: [],
      member_aliases: [],
      invites: [],
      identity_merges: [],
    });
  });
});
