import { describe, expect, it } from 'vitest';
import { initializeGroup } from '../src/domain/groups';
import { createIdentifier } from '../src/domain/ids';
import { MemoryGroupRepository } from '../src/memoryGroupRepository';
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
        creator_member_name: 'Santi',
        invite_id: createIdentifier(),
        invite_token_hash: 'initial-invite-hash',
        invite_token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
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
    expect(JSON.stringify(store.history())).not.toContain(
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    );
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
        creator_member_name: 'Santi',
        invite_id: createIdentifier(),
        invite_token_hash: 'initial-invite-hash',
        invite_token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
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
      invites: [],
    });
  });
});
