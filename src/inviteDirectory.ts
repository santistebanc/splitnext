import { z } from 'zod';
import { generateSecretToken, hashSecretToken } from './secretToken.internal';

const DEFAULT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const INVITE_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export const inviteTokenSchema = z.string().regex(INVITE_TOKEN_PATTERN);

export const inviteStatusSchema = z.enum(['active', 'expired', 'revoked']);

export const groupInviteSchema = z.object({
  id: z.uuid(),
  kind: z.literal('group'),
  created_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  revoked_at: z.iso.datetime().nullable(),
  status: inviteStatusSchema,
}).strict();

export type GroupInvite = z.infer<typeof groupInviteSchema>;

export const createGroupInviteInputSchema = z
  .object({ expires_at: z.iso.datetime().optional() })
  .strict();

export type CreateGroupInviteInput = z.infer<
  typeof createGroupInviteInputSchema
>;

export type CreatedGroupInvite = {
  invite: GroupInvite;
  invite_token: string;
};

export type InviteReadResult =
  | { ok: true; invite: GroupInvite }
  | { ok: false; error: 'invite_not_found' };

type StoredGroupInvite = Omit<GroupInvite, 'status'>;

type PreparedGroupInvite = {
  stored: StoredGroupInvite;
  tokenHash: string;
  inviteToken: string;
};

/** Owns temporary invitations stored inside one group's database. */
export class InviteDirectory {
  constructor(private readonly sql: SqlStorage) {}

  /**
   * Token hashing is asynchronous, so preparation happens before the caller's
   * synchronous storage transaction. A null result means the expiry is not in
   * the future.
   */
  async prepareGroupInvite(
    input: CreateGroupInviteInput,
  ): Promise<PreparedGroupInvite | null> {
    const createdAtMs = Date.now();

    const expiresAtMs = input.expires_at
      ? Date.parse(input.expires_at)
      : createdAtMs + DEFAULT_LIFETIME_MS;

    if (expiresAtMs <= createdAtMs) return null;

    const inviteToken = generateSecretToken();

    return {
      stored: {
        id: crypto.randomUUID(),
        kind: 'group',
        created_at: new Date(createdAtMs).toISOString(),
        expires_at: new Date(expiresAtMs).toISOString(),
        revoked_at: null,
      },
      tokenHash: await hashSecretToken(inviteToken),
      inviteToken,
    };
  }

  /** Inserts a prepared invite and returns its secret exactly once. */
  createGroupInvite(prepared: PreparedGroupInvite): CreatedGroupInvite {
    const { stored } = prepared;

    this.sql.exec(
      `INSERT INTO invites
        (id, kind, token_hash, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      stored.id,
      stored.kind,
      prepared.tokenHash,
      stored.created_at,
      stored.expires_at,
    );

    return {
      invite: this.present(stored),
      invite_token: prepared.inviteToken,
    };
  }

  list(): GroupInvite[] {
    return this.sql
      .exec<StoredGroupInvite>(
        `SELECT id, kind, created_at, expires_at, revoked_at
         FROM invites
         WHERE kind = 'group'
         ORDER BY created_at, id`,
      )
      .toArray()
      .map((invite) => this.present(invite));
  }

  /** Disabling is idempotent: a second request returns the same tombstone. */
  revoke(inviteId: string): InviteReadResult {
    const invite = this.read(inviteId);

    if (!invite) return { ok: false, error: 'invite_not_found' };

    if (invite.revoked_at === null) {
      this.sql.exec(
        'UPDATE invites SET revoked_at = ? WHERE id = ?',
        new Date().toISOString(),
        inviteId,
      );
    }

    const revoked = this.read(inviteId);

    if (!revoked) throw new Error('invite_revocation_failed');

    return { ok: true, invite: this.present(revoked) };
  }

  private read(inviteId: string): StoredGroupInvite | null {
    const invite = this.sql
      .exec<StoredGroupInvite>(
        `SELECT id, kind, created_at, expires_at, revoked_at
         FROM invites
         WHERE id = ? AND kind = 'group'`,
        inviteId,
      )
      .toArray()[0];

    return invite ?? null;
  }

  private present(invite: StoredGroupInvite): GroupInvite {
    const status = invite.revoked_at
      ? 'revoked'
      : Date.parse(invite.expires_at) <= Date.now()
        ? 'expired'
        : 'active';

    return { ...invite, status };
  }
}
