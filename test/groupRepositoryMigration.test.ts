import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createIdentifier } from '../src/domain/ids';
import { DurableObjectGroupRepository } from '../src/groupRepository';

describe('group storage migrations', () => {
  it('removes time limits while preserving active and revoked invite records', async () => {
    const stub = env.GROUPS.get(env.GROUPS.idFromName(createIdentifier()));

    await runInDurableObject(stub, (_instance, state) => {
      // Seed the previous persisted schema, including a link whose former
      // deadline has passed. Its revoked state, not its age, must survive.
      state.storage.sql.exec(
        `ALTER TABLE group_invites ADD COLUMN expires_at TEXT NOT NULL
           DEFAULT '2020-01-01T00:00:00.000Z';
         UPDATE group_metadata SET value = '1' WHERE key = 'schema_version';
         INSERT INTO group_invites (
           id, token_hash, created_by_identity_id, created_at, revoked_at
         ) VALUES
           ('active', 'active-hash', 'creator', '2019-01-01T00:00:00.000Z', NULL),
           ('revoked', 'revoked-hash', 'creator', '2019-01-01T00:00:00.000Z', '2019-02-01T00:00:00.000Z');`,
      );

      const repository = new DurableObjectGroupRepository(state.storage);

      repository.transaction((persistence) => {
        expect(persistence.findInvite('active')).toEqual({
          id: 'active',
          token_hash: 'active-hash',
          created_by_identity_id: 'creator',
          created_at: '2019-01-01T00:00:00.000Z',
          revoked_at: null,
        });
        expect(persistence.findInvite('revoked')?.revoked_at).toBe('2019-02-01T00:00:00.000Z');
      });

      // Reopening must not repeat a destructive schema operation.
      const reopened = new DurableObjectGroupRepository(state.storage);

      reopened.transaction((persistence) => {
        expect(persistence.findInvite('active')).not.toBeNull();
        expect(persistence.findInvite('revoked')?.revoked_at).toBe('2019-02-01T00:00:00.000Z');
      });
    });
  });
});
