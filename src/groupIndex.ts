import type {
  AccessibleGroup,
  GroupAccessGrant,
  GroupDetails,
} from './domain/groups';
import type { GroupSnapshot } from './domain/sync';

type IndexedGroup = Pick<GroupDetails, 'id' | 'name' | 'currency_code'>;

type GroupAccessRow = {
  group_id: string;
  group_name: string;
  currency_code: string;
  granted_at: string;
  hidden_at: string | null;
};

type GroupIdRow = { group_id: string };

/**
 * The D1 index of groups each identity can access. It is derived from group
 * snapshots rather than authoritative: refreshing from any snapshot the
 * identity receives corrects a stale name or a missed leave.
 */
export class GroupIndex {
  constructor(private readonly database: D1Database) {}

  /** Records an identity's view of a group taken from one of its snapshots. */
  async refreshFromSnapshot(
    identityId: string,
    snapshot: GroupSnapshot,
  ): Promise<void> {
    const access = snapshot.access_grants.find(
      (grant) => grant.identity_id === identityId,
    );

    if (access) await this.refresh(snapshot.group, access);
  }

  /** Records an identity's view of a group, writing only when it changed. */
  async refresh(group: IndexedGroup, access: GroupAccessGrant): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO identity_group_access (
           identity_id, group_id, group_name, currency_code, granted_at, hidden_at
         )
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (identity_id, group_id) DO UPDATE SET
           group_name = excluded.group_name,
           currency_code = excluded.currency_code,
           hidden_at = excluded.hidden_at
         WHERE group_name IS NOT excluded.group_name
            OR currency_code IS NOT excluded.currency_code
            OR hidden_at IS NOT excluded.hidden_at`,
      )
      .bind(
        access.identity_id,
        group.id,
        group.name,
        group.currency_code,
        access.granted_at,
        access.hidden_at,
      )
      .run();
  }

  /** Active groups first, then groups the identity has left; each by name. */
  async list(identityId: string): Promise<AccessibleGroup[]> {
    const { results } = await this.database
      .prepare(
        `SELECT group_id, group_name, currency_code, granted_at, hidden_at
         FROM identity_group_access
         WHERE identity_id = ?
         ORDER BY hidden_at IS NOT NULL, group_name COLLATE NOCASE, group_id`,
      )
      .bind(identityId)
      .all<GroupAccessRow>();

    return results.map((row) => ({
      group_id: row.group_id,
      name: row.group_name,
      currency_code: row.currency_code,
      status: row.hidden_at ? 'left' : 'active',
      granted_at: row.granted_at,
      left_at: row.hidden_at,
    }));
  }

  /** Lists every group represented in the derived identity access index. */
  async listAllGroupIds(): Promise<string[]> {
    const { results } = await this.database
      .prepare(
        `SELECT DISTINCT group_id
         FROM identity_group_access
         ORDER BY group_id COLLATE NOCASE, group_id`,
      )
      .all<GroupIdRow>();

    return results.map((row) => row.group_id);
  }

  /** Development only: forgets the whole index. */
  async clear(): Promise<void> {
    await this.database.prepare('DELETE FROM identity_group_access').run();
  }

}
