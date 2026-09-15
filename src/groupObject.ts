import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

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

type AccessRow = {
  revoked_at: string | null;
};

type CreateGroupStorageResult =
  | { ok: true; group: Group }
  | { ok: false; error: 'group_exists' };

type CreateGroupResult =
  | { ok: true; group: Group; access_token: string }
  | { ok: false; error: 'group_exists' };

type GetGroupResult =
  | { ok: true; group: Group }
  | { ok: false; error: 'unauthorized' };

type MutateGroupResult =
  | { ok: true; group: Group }
  | { ok: false; error: 'unauthorized' | 'version_conflict' };

/**
 * The per-group SQLite Durable Object. Each instance owns exactly one group's
 * state and serializes all access checks and writes to that private database.
 *
 * Storage is provisioned by the first write, not by construction, so merely
 * addressing a group id leaves nothing behind.
 */
export class GroupObject extends DurableObject<Env> {
  async health(): Promise<{ ok: true; storage: 'sqlite'; ready: boolean }> {
    return { ok: true, storage: 'sqlite', ready: this.isStorageReachable() };
  }

  async createGroup(input: CreateGroupInput): Promise<CreateGroupResult> {
    const groupId = this.ctx.id.name;

    if (!groupId) throw new Error('named_group_object_required');

    const accessToken = generateAccessToken();
    const tokenHash = await hashAccessToken(accessToken);
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
          `INSERT INTO access_tokens
            (token_hash, device_user_id, created_at, revoked_at)
           VALUES (?, ?, ?, NULL)`,
          tokenHash,
          input.device_user_id,
          createdAt,
        );

        const group = this.readGroup();

        if (!group) throw new Error('group_insert_failed');

        return { ok: true, group };
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
  async getGroup(accessToken: string, deviceUserId: string): Promise<GetGroupResult> {
    const tokenHash = await hashAccessToken(accessToken);

    return this.ctx.storage.transactionSync((): GetGroupResult => {
      if (!this.isProvisioned()) return { ok: false, error: 'unauthorized' };

      if (!this.hasAccess(tokenHash, deviceUserId)) {
        return { ok: false, error: 'unauthorized' };
      }

      const group = this.readGroup();

      // A live capability without group state breaks the invariant that both
      // are written in one transaction, so it is a fault, not a refusal.
      if (!group) throw new Error('group_state_missing');

      if (group.deleted_at !== null) return { ok: false, error: 'unauthorized' };

      return { ok: true, group };
    });
  }

  async updateGroup(
    accessToken: string,
    deviceUserId: string,
    input: UpdateGroupInput,
  ): Promise<MutateGroupResult> {
    const tokenHash = await hashAccessToken(accessToken);

    return this.ctx.storage.transactionSync((): MutateGroupResult => {
      if (!this.isProvisioned() || !this.hasAccess(tokenHash, deviceUserId)) {
        return { ok: false, error: 'unauthorized' };
      }

      const group = this.readGroup();

      if (!group) throw new Error('group_state_missing');

      if (group.deleted_at !== null) return { ok: false, error: 'unauthorized' };

      if (group.version !== input.expected_version) {
        return { ok: false, error: 'version_conflict' };
      }

      const updatedAt = new Date().toISOString();

      this.ctx.storage.sql.exec(
        `UPDATE group_state
         SET version = version + 1, updated_at = ?, name = ?, currency_label = ?
         WHERE singleton = 1`,
        updatedAt,
        input.name ?? group.name,
        input.currency_label ?? group.currency_label,
      );

      const updated = this.readGroup();

      if (!updated) throw new Error('group_update_failed');

      return { ok: true, group: updated };
    });
  }

  async deleteGroup(
    accessToken: string,
    deviceUserId: string,
    input: DeleteGroupInput,
  ): Promise<MutateGroupResult> {
    const tokenHash = await hashAccessToken(accessToken);

    return this.ctx.storage.transactionSync((): MutateGroupResult => {
      if (!this.isProvisioned() || !this.hasAccess(tokenHash, deviceUserId)) {
        return { ok: false, error: 'unauthorized' };
      }

      const group = this.readGroup();

      if (!group) throw new Error('group_state_missing');

      if (group.deleted_at !== null) return { ok: false, error: 'unauthorized' };

      if (group.version !== input.expected_version) {
        return { ok: false, error: 'version_conflict' };
      }

      const deletedAt = new Date().toISOString();

      this.ctx.storage.sql.exec(
        `UPDATE group_state
         SET version = version + 1, updated_at = ?, deleted_at = ?
         WHERE singleton = 1`,
        deletedAt,
        deletedAt,
      );

      const deleted = this.readGroup();

      if (!deleted) throw new Error('group_delete_failed');

      return { ok: true, group: deleted };
    });
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
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS access_tokens (
      token_hash TEXT PRIMARY KEY,
      device_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
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

  private hasAccess(tokenHash: string, deviceUserId: string): boolean {
    const access = this.ctx.storage.sql
      .exec<AccessRow>(
        `SELECT revoked_at
         FROM access_tokens
         WHERE token_hash = ? AND device_user_id = ?`,
        tokenHash,
        deviceUserId,
      )
      .toArray()[0];

    return access?.revoked_at === null;
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
