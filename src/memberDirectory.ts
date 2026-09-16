import { z } from 'zod';
import { deviceUserIdSchema } from './accessCredential';
import { type MemberAccess, type PreparedCredentialIssue } from './memberAccess';

export const memberDisplayNameSchema = z.string().trim().min(1).max(100);

export const memberVersionSchema = z.number().int().positive();

export const memberSchema = z.object({
  id: z.uuid(),
  version: memberVersionSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
  display_name: memberDisplayNameSchema,
});

export type Member = z.infer<typeof memberSchema>;

export const claimableMemberSchema = memberSchema.pick({
  id: true,
  display_name: true,
});

export type ClaimableMember = z.infer<typeof claimableMemberSchema>;

export const createMemberInputSchema = z
  .object({ display_name: memberDisplayNameSchema })
  .strict();

export type CreateMemberInput = z.infer<typeof createMemberInputSchema>;

export const updateMemberInputSchema = z
  .object({
    expected_version: memberVersionSchema,
    display_name: memberDisplayNameSchema,
  })
  .strict();

export type UpdateMemberInput = z.infer<typeof updateMemberInputSchema>;

export const deleteMemberInputSchema = z
  .object({ expected_version: memberVersionSchema })
  .strict();

export type DeleteMemberInput = z.infer<typeof deleteMemberInputSchema>;

export type MemberReadResult =
  | { ok: true; member: Member }
  | { ok: false; error: 'member_not_found' | 'member_deleted' };

export type MemberMutationResult =
  | { ok: true; member: Member }
  | {
      ok: false;
      error: 'member_not_found' | 'member_deleted' | 'version_conflict';
    };

export type MemberClaimResult =
  | { ok: true; member: Member; access_token: string }
  | {
      ok: false;
      error: 'member_not_found' | 'member_deleted' | 'member_claimed';
    };

type PreparedMemberWithAccess = {
  displayName: string;
  credential: PreparedCredentialIssue;
};

type CreatedMemberWithAccess = {
  member: Member;
  access_token: string;
};

type MemberChanges = {
  displayName?: string | undefined;
  deleted?: boolean | undefined;
};

const memberWithAccessInputSchema = z
  .object({
    display_name: memberDisplayNameSchema,
    device_user_id: deviceUserIdSchema,
  })
  .strict();

/**
 * Owns members. Member access is its own module; this one issues it when a
 * member is created or claimed and revokes it when a member is deleted.
 */
export class MemberDirectory {
  constructor(
    private readonly sql: SqlStorage,
    private readonly access: MemberAccess,
  ) {}

  /**
   * Web Crypto is asynchronous while SQLite transactions are synchronous, so
   * expensive token preparation happens before the caller opens its transaction.
   */
  async prepareMemberWithAccess(
    rawInput: z.input<typeof memberWithAccessInputSchema>,
  ): Promise<PreparedMemberWithAccess> {
    const input = memberWithAccessInputSchema.parse(rawInput);

    return {
      displayName: input.display_name,
      credential: await this.access.prepareIssue(input.device_user_id),
    };
  }

  /** Creates the member and its first credential as one storage operation. */
  createWithAccess(
    prepared: PreparedMemberWithAccess,
  ): CreatedMemberWithAccess {
    const member = this.insert(prepared.displayName);

    const accessToken = this.access.issue(
      prepared.credential,
      member.id,
      member.created_at,
    );

    return { member, access_token: accessToken };
  }

  create(input: CreateMemberInput): Member {
    return this.insert(input.display_name);
  }

  listActive(): Member[] {
    return this.sql
      .exec<Member>(
        `SELECT id, version, created_at, updated_at, deleted_at, display_name
         FROM members
         WHERE deleted_at IS NULL
         ORDER BY created_at, id`,
      )
      .toArray();
  }

  /** Who an invite may offer. Reads the same definition redemption enforces. */
  listClaimable(): ClaimableMember[] {
    const claimable: ClaimableMember[] = [];

    for (const member of this.listActive()) {
      if (this.isClaimable(member)) {
        claimable.push({ id: member.id, display_name: member.display_name });
      }
    }

    return claimable;
  }

  retrieve(memberId: string): MemberReadResult {
    const member = this.read(memberId);

    if (!member) return { ok: false, error: 'member_not_found' };

    return member.deleted_at === null
      ? { ok: true, member }
      : { ok: false, error: 'member_deleted' };
  }

  rename(memberId: string, input: UpdateMemberInput): MemberMutationResult {
    const resolved = this.resolveMutation(memberId, input.expected_version);

    if (!resolved.ok) return resolved;

    if (resolved.member.display_name === input.display_name) return resolved;

    return this.commit(resolved.member, { displayName: input.display_name });
  }

  remove(memberId: string, input: DeleteMemberInput): MemberMutationResult {
    const resolved = this.resolveMutation(memberId, input.expected_version);

    if (!resolved.ok) return resolved;

    return this.commit(resolved.member, { deleted: true });
  }

  claimWithAccess(
    memberId: string,
    prepared: PreparedCredentialIssue,
  ): MemberClaimResult {
    const member = this.read(memberId);

    if (!member) return { ok: false, error: 'member_not_found' };

    // Report the more specific refusal first; whether the member may be
    // claimed at all is decided by isClaimable alone.
    if (member.deleted_at !== null) {
      return { ok: false, error: 'member_deleted' };
    }

    if (!this.isClaimable(member)) {
      return { ok: false, error: 'member_claimed' };
    }

    return {
      ok: true,
      member,
      access_token: this.access.issue(
        prepared,
        member.id,
        new Date().toISOString(),
      ),
    };
  }

  /**
   * CONTEXT.md: an active member who has never received member access. The
   * only statement of that rule; listing and claiming both read it.
   */
  private isClaimable(member: Member): boolean {
    return member.deleted_at === null && !this.access.hasBeenIssued(member.id);
  }

  private insert(displayName: string): Member {
    const memberId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO members
        (id, version, created_at, updated_at, deleted_at, display_name)
       VALUES (?, 1, ?, ?, NULL, ?)`,
      memberId,
      createdAt,
      createdAt,
      displayName,
    );

    const member = this.read(memberId);

    if (!member) throw new Error('member_insert_failed');

    return member;
  }

  private resolveMutation(
    memberId: string,
    expectedVersion: number,
  ): MemberMutationResult {
    const member = this.read(memberId);

    if (!member) return { ok: false, error: 'member_not_found' };

    if (member.deleted_at !== null) {
      return { ok: false, error: 'member_deleted' };
    }

    return member.version === expectedVersion
      ? { ok: true, member }
      : { ok: false, error: 'version_conflict' };
  }

  private commit(member: Member, changes: MemberChanges): MemberMutationResult {
    const at = new Date().toISOString();
    const deletedAt = changes.deleted === true ? at : member.deleted_at;

    this.sql.exec(
      `UPDATE members
       SET version = version + 1,
           updated_at = ?,
           display_name = ?,
           deleted_at = ?
       WHERE id = ?`,
      at,
      changes.displayName ?? member.display_name,
      deletedAt,
      member.id,
    );

    if (changes.deleted === true) {
      this.access.revokeMember(member.id, at);
    }

    const mutated = this.read(member.id);

    if (!mutated) throw new Error('member_mutation_failed');

    return { ok: true, member: mutated };
  }

  private read(memberId: string): Member | null {
    const member = this.sql
      .exec<Member>(
        `SELECT id, version, created_at, updated_at, deleted_at, display_name
         FROM members
         WHERE id = ?`,
        memberId,
      )
      .toArray()[0];

    return member ?? null;
  }
}
