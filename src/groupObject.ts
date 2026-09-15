import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import {
  type CreateMemberInput,
  type DeleteMemberInput,
  type Member,
  type UpdateMemberInput,
} from './member';

/**
 * The shape of a group, declared once because the group owns it. The storage
 * row type, the HTTP response schema behind OpenAPI, and the tests are all
 * derived from this, so none of them can drift from the others.
 */
export const groupSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
  name: z.string(),
  currency_label: z.string(),
});

export type Group = z.infer<typeof groupSchema>;

/**
 * A group capability: the 32 random bytes minted at creation, rendered as
 * lowercase hex. Declared here because the group is what issues and verifies
 * it, and derived by the route that parses it and the tests that assert on it.
 */
export const ACCESS_TOKEN_PATTERN = '[a-f0-9]{64}';

export const accessTokenSchema = z
  .string()
  .regex(new RegExp(`^${ACCESS_TOKEN_PATTERN}$`));

export type CreateGroupInput = {
  name: string;
  currency_label: string;
  device_user_id: string;
  creator_display_name: string;
};

export type UpdateGroupInput = {
  expected_version: number;
  name?: string | undefined;
  currency_label?: string | undefined;
};

export type DeleteGroupInput = {
  expected_version: number;
};

/**
 * Stamped into each group's storage at provisioning so a later version of this
 * class can tell what it is looking at. Deliberately not a readiness input.
 */
const SCHEMA_VERSION = '1';

type TableRow = { name: string };

type ProbeRow = { ok: number };

type MemberAccessRow = { member_id: string };

type CreateGroupStorageResult =
  | { ok: true; group: Group; member: Member }
  | { ok: false; error: 'group_exists' };

type CreateGroupResult =
  | { ok: true; group: Group; member: Member; access_token: string }
  | { ok: false; error: 'group_exists' };

/** Why a caller may not act on this group at all. */
type GroupRefusal = { ok: false; error: 'unauthorized' | 'group_deleted' };

type ResolvedGroup = { ok: true; group: Group } | GroupRefusal;

type MutateGroupResult = ResolvedGroup | { ok: false; error: 'version_conflict' };

type CreateMemberResult = { ok: true; member: Member } | GroupRefusal;

type ListMembersResult = { ok: true; members: Member[] } | GroupRefusal;

type GetMemberResult =
  | { ok: true; member: Member }
  | GroupRefusal
  | { ok: false; error: 'member_not_found' | 'member_deleted' };

type MutateMemberResult =
  | { ok: true; member: Member }
  | GroupRefusal
  | {
      ok: false;
      error: 'member_not_found' | 'member_deleted' | 'version_conflict';
    };

/** The columns a mutation may change; anything absent keeps its current value. */
type GroupChanges = {
  name?: string | undefined;
  currency_label?: string | undefined;
  deleted?: boolean | undefined;
};

type MemberChanges = {
  display_name?: string | undefined;
  deleted?: boolean | undefined;
};

/**
 * The per-group SQLite Durable Object. Each instance owns exactly one group's
 * state and serializes all access checks and writes to that private database.
 *
 * Storage is provisioned by the first write, not by construction, so merely
 * addressing a group id leaves nothing behind.
 */
export class GroupObject extends DurableObject<Env> {
  async health(): Promise<boolean> {
    return this.isStorageReachable();
  }

  async createGroup(input: CreateGroupInput): Promise<CreateGroupResult> {
    const groupId = this.ctx.id.name;

    if (!groupId) throw new Error('named_group_object_required');

    const accessToken = generateAccessToken();
    const tokenHash = await hashAccessToken(accessToken);
    const creatorMemberId = crypto.randomUUID();
    // The group stamps its own clock, as it already does its own version.
    const createdAt = new Date().toISOString();

    const result = this.ctx.storage.transactionSync(
      (): CreateGroupStorageResult => {
        this.ensureFoundation();

        const existing = this.readGroup();

        if (existing) return { ok: false, error: 'group_exists' };

        this.ctx.storage.sql.exec(
          `INSERT INTO group_state
            (singleton, id, version, created_at, updated_at, deleted_at, name, currency_label)
           VALUES (1, ?, 1, ?, ?, NULL, ?, ?)`,
          groupId,
          createdAt,
          createdAt,
          input.name,
          input.currency_label,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO members
            (id, version, created_at, updated_at, deleted_at, display_name)
           VALUES (?, 1, ?, ?, NULL, ?)`,
          creatorMemberId,
          createdAt,
          createdAt,
          input.creator_display_name,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO member_access
            (token_hash, member_id, device_user_id, created_at, revoked_at)
           VALUES (?, ?, ?, ?, NULL)`,
          tokenHash,
          creatorMemberId,
          input.device_user_id,
          createdAt,
        );

        const group = this.readGroup();
        const member = this.readMember(creatorMemberId);

        if (!group) throw new Error('group_insert_failed');

        if (!member) throw new Error('creator_member_insert_failed');

        return { ok: true, group, member };
      },
    );

    if (!result.ok) return result;

    return { ...result, access_token: accessToken };
  }

  /**
   * A caller without a valid capability is told only that it is unauthorized.
   * Whether the group exists is itself privileged, so an unknown group and a
   * wrong token are deliberately indistinguishable.
   */
  async getGroup(accessToken: string, deviceUserId: string): Promise<ResolvedGroup> {
    return this.actOnGroup(accessToken, deviceUserId, (group): ResolvedGroup => ({
      ok: true,
      group,
    }));
  }

  async updateGroup(
    accessToken: string,
    deviceUserId: string,
    input: UpdateGroupInput,
  ): Promise<MutateGroupResult> {
    return this.actOnGroup(accessToken, deviceUserId, (group): MutateGroupResult => {
      if (group.version !== input.expected_version) {
        return { ok: false, error: 'version_conflict' };
      }

      const name = input.name ?? group.name;
      const currencyLabel = input.currency_label ?? group.currency_label;

      // A redundant edit must not advance the version, or one device's no-op
      // makes every other device's expected_version stale.
      if (name === group.name && currencyLabel === group.currency_label) {
        return { ok: true, group };
      }

      return this.commitMutation(group, { name, currency_label: currencyLabel });
    });
  }

  async deleteGroup(
    accessToken: string,
    deviceUserId: string,
    input: DeleteGroupInput,
  ): Promise<MutateGroupResult> {
    return this.actOnGroup(accessToken, deviceUserId, (group): MutateGroupResult => {
      if (group.version !== input.expected_version) {
        return { ok: false, error: 'version_conflict' };
      }

      return this.commitMutation(group, { deleted: true });
    });
  }

  async createMember(
    accessToken: string,
    deviceUserId: string,
    input: CreateMemberInput,
  ): Promise<CreateMemberResult> {
    return this.actOnGroup(accessToken, deviceUserId, (): CreateMemberResult => {
      this.ensureMemberStorage();

      const memberId = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      this.ctx.storage.sql.exec(
        `INSERT INTO members
          (id, version, created_at, updated_at, deleted_at, display_name)
         VALUES (?, 1, ?, ?, NULL, ?)`,
        memberId,
        createdAt,
        createdAt,
        input.display_name,
      );

      const member = this.readMember(memberId);

      if (!member) throw new Error('member_insert_failed');

      return { ok: true, member };
    });
  }

  async listMembers(
    accessToken: string,
    deviceUserId: string,
  ): Promise<ListMembersResult> {
    return this.actOnGroup(accessToken, deviceUserId, (): ListMembersResult => {
      this.ensureMemberStorage();

      const members = this.ctx.storage.sql
        .exec<Member>(
          `SELECT id, version, created_at, updated_at, deleted_at, display_name
           FROM members
           WHERE deleted_at IS NULL
           ORDER BY created_at, id`,
        )
        .toArray();

      return { ok: true, members };
    });
  }

  async getMember(
    accessToken: string,
    deviceUserId: string,
    memberId: string,
  ): Promise<GetMemberResult> {
    return this.actOnGroup(accessToken, deviceUserId, (): GetMemberResult => {
      this.ensureMemberStorage();

      const member = this.readMember(memberId);

      if (!member) {
        return { ok: false, error: 'member_not_found' };
      }

      if (member.deleted_at !== null) {
        return { ok: false, error: 'member_deleted' };
      }

      return { ok: true, member };
    });
  }

  async updateMember(
    accessToken: string,
    deviceUserId: string,
    memberId: string,
    input: UpdateMemberInput,
  ): Promise<MutateMemberResult> {
    return this.actOnGroup(accessToken, deviceUserId, (): MutateMemberResult => {
      this.ensureMemberStorage();

      const member = this.readMember(memberId);

      if (!member) return { ok: false, error: 'member_not_found' };

      if (member.deleted_at !== null) {
        return { ok: false, error: 'member_deleted' };
      }

      if (member.version !== input.expected_version) {
        return { ok: false, error: 'version_conflict' };
      }

      if (member.display_name === input.display_name) {
        return { ok: true, member };
      }

      return this.commitMemberMutation(member, {
        display_name: input.display_name,
      });
    });
  }

  async deleteMember(
    accessToken: string,
    deviceUserId: string,
    memberId: string,
    input: DeleteMemberInput,
  ): Promise<MutateMemberResult> {
    return this.actOnGroup(accessToken, deviceUserId, (): MutateMemberResult => {
      this.ensureMemberStorage();

      const member = this.readMember(memberId);

      if (!member) return { ok: false, error: 'member_not_found' };

      if (member.deleted_at !== null) {
        return { ok: false, error: 'member_deleted' };
      }

      if (member.version !== input.expected_version) {
        return { ok: false, error: 'version_conflict' };
      }

      return this.commitMemberMutation(member, { deleted: true });
    });
  }

  /**
   * Hashes the capability, opens the transaction and resolves the live group
   * the caller may act on, so each operation holds only its own intent.
   */
  private async actOnGroup<T>(
    accessToken: string,
    deviceUserId: string,
    act: (group: Group) => T,
  ): Promise<T | GroupRefusal> {
    const tokenHash = await hashAccessToken(accessToken);

    return this.ctx.storage.transactionSync((): T | GroupRefusal => {
      const resolved = this.resolveGroup(tokenHash, deviceUserId);

      if (!resolved.ok) return resolved;

      return act(resolved.group);
    });
  }

  /**
   * The single answer to "which live group may this caller act on". Every
   * public operation goes through here, so a new one cannot forget a guard.
   * Runs inside the caller's transaction.
   */
  private resolveGroup(tokenHash: string, deviceUserId: string): ResolvedGroup {
    if (!this.isProvisioned() || !this.hasAccess(tokenHash, deviceUserId)) {
      return { ok: false, error: 'unauthorized' };
    }

    const group = this.readGroup();

    // A live capability without group state breaks the invariant that both
    // are written in one transaction, so it is a fault, not a refusal.
    if (!group) throw new Error('group_state_missing');

    // The caller holds a valid capability, so being told nothing would
    // misinform rather than withhold.
    if (group.deleted_at !== null) return { ok: false, error: 'group_deleted' };

    return { ok: true, group };
  }

  /**
   * The only writer of group_state after creation. Advances the version,
   * stamps the clock and applies the described change in one statement, so a
   * caller describes what changed rather than holding the SQL handle.
   * Runs inside the caller's transaction.
   */
  private commitMutation(group: Group, changes: GroupChanges): MutateGroupResult {
    const at = new Date().toISOString();

    this.ctx.storage.sql.exec(
      `UPDATE group_state
       SET version = version + 1,
           updated_at = ?,
           name = ?,
           currency_label = ?,
           deleted_at = ?
       WHERE singleton = 1`,
      at,
      changes.name ?? group.name,
      changes.currency_label ?? group.currency_label,
      changes.deleted === true ? at : group.deleted_at,
    );

    const mutated = this.readGroup();

    if (!mutated) throw new Error('group_mutation_failed');

    return { ok: true, group: mutated };
  }

  /** Runs inside the caller's transaction; it does not open its own. */
  private ensureFoundation(): void {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS object_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS group_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      id TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      name TEXT NOT NULL,
      currency_label TEXT NOT NULL
    )`);
    this.ensureMemberStorage();
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS member_access (
      token_hash TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      device_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (member_id) REFERENCES members(id)
    )`);
    this.ctx.storage.sql.exec(
      `INSERT INTO object_metadata (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      'schema_version',
      SCHEMA_VERSION,
    );
  }

  private isProvisioned(): boolean {
    const table = this.ctx.storage.sql
      .exec<TableRow>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'group_state'",
      )
      .toArray()[0];

    return table !== undefined;
  }

  /**
   * Readiness is reachability and nothing more. The probe addresses a sentinel
   * object that is never created, so it has no schema to be stale about; a
   * version comparison here could only ever agree with itself.
   */
  private isStorageReachable(): boolean {
    const probe = this.ctx.storage.sql.exec<ProbeRow>('SELECT 1 AS ok').toArray()[0];

    return probe?.ok === 1;
  }

  private readGroup(): Group | null {
    const row = this.ctx.storage.sql
      .exec<Group>(
        `SELECT id, version, created_at, updated_at, deleted_at, name, currency_label
         FROM group_state
         WHERE singleton = 1`,
      )
      .toArray()[0];

    return row ?? null;
  }

  private ensureMemberStorage(): void {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      display_name TEXT NOT NULL
    )`);
  }

  private readMember(memberId: string): Member | null {
    const member = this.ctx.storage.sql
      .exec<Member>(
        `SELECT id, version, created_at, updated_at, deleted_at, display_name
         FROM members
         WHERE id = ?`,
        memberId,
      )
      .toArray()[0];

    return member ?? null;
  }

  private commitMemberMutation(
    member: Member,
    changes: MemberChanges,
  ): MutateMemberResult {
    const at = new Date().toISOString();

    this.ctx.storage.sql.exec(
      `UPDATE members
       SET version = version + 1,
           updated_at = ?,
           display_name = ?,
           deleted_at = ?
       WHERE id = ?`,
      at,
      changes.display_name ?? member.display_name,
      changes.deleted === true ? at : member.deleted_at,
      member.id,
    );

    if (changes.deleted === true) {
      this.ctx.storage.sql.exec(
        `UPDATE member_access
         SET revoked_at = ?
         WHERE member_id = ? AND revoked_at IS NULL`,
        at,
        member.id,
      );
    }

    const mutated = this.readMember(member.id);

    if (!mutated) throw new Error('member_mutation_failed');

    return { ok: true, member: mutated };
  }

  private hasAccess(tokenHash: string, deviceUserId: string): boolean {
    const access = this.ctx.storage.sql
      .exec<MemberAccessRow>(
        `SELECT access.member_id
         FROM member_access AS access
         INNER JOIN members AS member ON member.id = access.member_id
         WHERE access.token_hash = ?
           AND access.device_user_id = ?
           AND access.revoked_at IS NULL
           AND member.deleted_at IS NULL`,
        tokenHash,
        deviceUserId,
      )
      .toArray()[0];

    return access !== undefined;
  }
}

function generateAccessToken(): string {
  const bytes = new Uint8Array(32);

  crypto.getRandomValues(bytes);

  return toHex(bytes);
}

async function hashAccessToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', encoded);

  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
