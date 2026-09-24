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
    expect(repository.inspect()).toMatchObject({
      revision: 2,
      snapshot: { group: { name: 'Renamed group' } },
      audit_events: [{ action: 'group.created' }, { action: 'group.renamed' }],
    });
  });

  it('does not commit a transaction that throws', () => {
    const repository = new MemoryGroupRepository();

    expect(() =>
      repository.transaction(() => {
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(repository.inspect()).toBeNull();
  });
});
