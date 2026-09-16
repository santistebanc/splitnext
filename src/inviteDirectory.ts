import { z } from 'zod';
import { deviceUserIdSchema } from './accessCredential';
import { groupSchema, type Group } from './groupState';
import {
  claimableMemberSchema,
  memberDisplayNameSchema,
  type Member,
  MemberDirectory,
} from './memberDirectory';
import { type MemberAccess, type PreparedCredentialIssue } from './memberAccess';
import {
  generateSecretToken,
  hashSecretToken,
  SECRET_TOKEN_PATTERN,
} from './secretToken.internal';

const DEFAULT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export const inviteTokenSchema = z
  .string()
  .regex(new RegExp(`^${SECRET_TOKEN_PATTERN}$`));

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

const redemptionMemberSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('new'),
      display_name: memberDisplayNameSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('existing'),
      member_id: z.uuid(),
    })
    .strict(),
]);

export const redeemGroupInviteInputSchema = z
  .object({
    invite_token: inviteTokenSchema,
    device_user_id: deviceUserIdSchema,
    member: redemptionMemberSchema,
  })
  .strict();

export type RedeemGroupInviteInput = z.infer<
  typeof redeemGroupInviteInputSchema
>;

export const inviteContextInputSchema = z
  .object({ invite_token: inviteTokenSchema })
  .strict();

export type InviteContextInput = z.infer<typeof inviteContextInputSchema>;

export const inviteContextSchema = z
  .object({
    group: groupSchema.pick({
      id: true,
      name: true,
      currency_label: true,
    }),
    claimable_members: z.array(claimableMemberSchema),
  })
  .strict();

export type InviteContext = z.infer<typeof inviteContextSchema>;

export type CreatedGroupInvite = {
  invite: GroupInvite;
  invite_token: string;
};

export type InviteReadResult =
  | { ok: true; invite: GroupInvite }
  | { ok: false; error: 'invite_not_found' };

export type InviteRedemptionResult =
  | { ok: true; member: Member; access_token: string }
  | {
      ok: false;
      error:
        | 'invite_invalid'
        | 'invite_expired'
        | 'invite_revoked'
        | 'member_not_found'
        | 'member_deleted'
        | 'member_claimed';
    };

export type InviteContextResult =
  | { ok: true; context: InviteContext }
  | {
      ok: false;
      error: 'invite_invalid' | 'invite_expired' | 'invite_revoked';
    };

type StoredGroupInvite = Omit<GroupInvite, 'status'>;

type PreparedGroupInvite = {
  stored: StoredGroupInvite;
  tokenHash: string;
  inviteToken: string;
};

type PreparedMemberWithAccess = Awaited<
  ReturnType<MemberDirectory['prepareMemberWithAccess']>
>;

type PreparedRedemptionMember =
  | { kind: 'new'; member: PreparedMemberWithAccess }
  | { kind: 'existing'; memberId: string; access: PreparedCredentialIssue };

type PreparedInviteRedemption = {
  tokenHash: string;
  member: PreparedRedemptionMember;
};

type ActiveInviteResult =
  | { ok: true; invite: StoredGroupInvite }
  | {
      ok: false;
      error: 'invite_invalid' | 'invite_expired' | 'invite_revoked';
    };

/** Owns temporary invitations stored inside one group's database. */
export class InviteDirectory {
  constructor(
    private readonly sql: SqlStorage,
    private readonly members: MemberDirectory,
    private readonly access: MemberAccess,
  ) {}

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

  /** Prepares both secrets before the caller opens its SQLite transaction. */
  async prepareRedemption(
    input: RedeemGroupInviteInput,
  ): Promise<PreparedInviteRedemption> {
    if (input.member.kind === 'new') {
      const [tokenHash, member] = await Promise.all([
        hashSecretToken(input.invite_token),
        this.members.prepareMemberWithAccess({
          display_name: input.member.display_name,
          device_user_id: input.device_user_id,
        }),
      ]);

      return { tokenHash, member: { kind: 'new', member } };
    }

    const [tokenHash, access] = await Promise.all([
      hashSecretToken(input.invite_token),
      this.access.prepareIssue(input.device_user_id),
    ]);

    return {
      tokenHash,
      member: {
        kind: 'existing',
        memberId: input.member.member_id,
        access,
      },
    };
  }

  async prepareContext(input: InviteContextInput): Promise<string> {
    return hashSecretToken(input.invite_token);
  }

  previewGroupInvite(tokenHash: string, group: Group): InviteContextResult {
    const resolved = this.resolveActiveInvite(tokenHash);

    if (!resolved.ok) return resolved;

    return {
      ok: true,
      context: {
        group: {
          id: group.id,
          name: group.name,
          currency_label: group.currency_label,
        },
        claimable_members: this.members.listClaimable(),
      },
    };
  }

  /** Validates, creates permanent access, and records use in one transaction. */
  redeemGroupInvite(
    prepared: PreparedInviteRedemption,
  ): InviteRedemptionResult {
    const resolved = this.resolveActiveInvite(prepared.tokenHash);

    if (!resolved.ok) return resolved;

    const created = prepared.member.kind === 'new'
      ? { ok: true as const, ...this.members.createWithAccess(prepared.member.member) }
      : this.members.claimWithAccess(
          prepared.member.memberId,
          prepared.member.access,
        );

    if (!created.ok) return created;

    this.sql.exec(
      `INSERT INTO invite_redemptions (member_id, invite_id, redeemed_at)
       VALUES (?, ?, ?)`,
      created.member.id,
      resolved.invite.id,
      new Date().toISOString(),
    );

    return created;
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

  private readByTokenHash(tokenHash: string): StoredGroupInvite | null {
    const invite = this.sql
      .exec<StoredGroupInvite>(
        `SELECT id, kind, created_at, expires_at, revoked_at
         FROM invites
         WHERE token_hash = ? AND kind = 'group'`,
        tokenHash,
      )
      .toArray()[0];

    return invite ?? null;
  }

  private resolveActiveInvite(tokenHash: string): ActiveInviteResult {
    const invite = this.readByTokenHash(tokenHash);

    if (!invite) return { ok: false, error: 'invite_invalid' };

    const status = statusOf(invite);

    if (status === 'revoked') return { ok: false, error: 'invite_revoked' };

    if (status === 'expired') return { ok: false, error: 'invite_expired' };

    return { ok: true, invite };
  }

  private present(invite: StoredGroupInvite): GroupInvite {
    return { ...invite, status: statusOf(invite) };
  }
}

/**
 * The one judgement of where an invite stands. Refusing a redemption and
 * reporting a status both read this, so they cannot disagree. Revocation
 * outranks expiry, because a disabled invite stays disabled whatever its date.
 */
function statusOf(invite: StoredGroupInvite): GroupInvite['status'] {
  if (invite.revoked_at !== null) return 'revoked';

  return Date.parse(invite.expires_at) <= Date.now() ? 'expired' : 'active';
}
