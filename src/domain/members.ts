import { z } from 'zod';

const identifierSchema = z.uuid();

export const memberNameSchema = z.string().trim().min(1).max(100);

export const ledgerMemberSchema = z.object({
  id: identifierSchema,
  display_name: z.string(),
  status: z.enum(['active', 'archived']),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const createMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal('member.create'),
  payload: z.object({
    member_id: identifierSchema,
    display_name: memberNameSchema,
  }),
});

export const renameMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal('member.rename'),
  payload: z.object({
    member_id: identifierSchema,
    expected_display_name: memberNameSchema,
    display_name: memberNameSchema,
  }),
});

export const archiveMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal('member.archive'),
  payload: z.object({
    member_id: identifierSchema,
  }),
});

export const memberCommandSchema = z.discriminatedUnion('type', [
  createMemberCommandSchema,
  renameMemberCommandSchema,
  archiveMemberCommandSchema,
]);

export type LedgerMember = z.output<typeof ledgerMemberSchema>;

export type CreateMemberCommand = z.output<typeof createMemberCommandSchema>;

export type RenameMemberCommand = z.output<typeof renameMemberCommandSchema>;

export type ArchiveMemberCommand = z.output<typeof archiveMemberCommandSchema>;

export type MemberCommand = z.output<typeof memberCommandSchema>;

export type MemberCreationDecision =
  | { kind: 'apply'; member: LedgerMember }
  | {
      kind: 'supersede';
      reason: 'member_name_taken';
      current: LedgerMember;
    }
  | {
      kind: 'reject';
      reason: 'member_id_exists';
      current: LedgerMember;
    };

export type MemberRenameDecision =
  | { kind: 'apply'; before: LedgerMember; member: LedgerMember }
  | { kind: 'no_effect'; current: LedgerMember }
  | {
      kind: 'supersede';
      reason: 'member_changed' | 'member_name_taken';
      current: LedgerMember;
    }
  | {
      kind: 'reject';
      reason: 'member_archived';
      current: LedgerMember;
    }
  | { kind: 'reject'; reason: 'member_not_found'; current: null };

export type MemberArchiveDecision =
  | {
      kind: 'apply';
      before: LedgerMember;
      member: LedgerMember;
      orphaned_identity_ids: string[];
    }
  | { kind: 'no_effect'; current: LedgerMember }
  | { kind: 'reject'; reason: 'member_not_found'; current: null };

export function decideMemberCreation(
  command: CreateMemberCommand,
  members: readonly LedgerMember[],
  appliedAt: string,
): MemberCreationDecision {
  const memberWithId = members.find(
    (member) => member.id === command.payload.member_id,
  );

  if (memberWithId) {
    return {
      kind: 'reject',
      reason: 'member_id_exists',
      current: memberWithId,
    };
  }

  const requestedNameKey = memberNameKey(command.payload.display_name);

  const memberWithName = members.find(
    (member) =>
      member.status === 'active' &&
      memberNameKey(member.display_name) === requestedNameKey,
  );

  if (memberWithName) {
    return {
      kind: 'supersede',
      reason: 'member_name_taken',
      current: memberWithName,
    };
  }

  return {
    kind: 'apply',
    member: {
      id: command.payload.member_id,
      display_name: command.payload.display_name,
      status: 'active',
      created_at: appliedAt,
      updated_at: appliedAt,
    },
  };
}

export function decideMemberRename(
  command: RenameMemberCommand,
  members: readonly LedgerMember[],
  appliedAt: string,
): MemberRenameDecision {
  const current = members.find(
    (member) => member.id === command.payload.member_id,
  );

  if (!current) {
    return { kind: 'reject', reason: 'member_not_found', current: null };
  }

  if (current.status === 'archived') {
    return { kind: 'reject', reason: 'member_archived', current };
  }

  if (current.display_name === command.payload.display_name) {
    return { kind: 'no_effect', current };
  }

  if (current.display_name !== command.payload.expected_display_name) {
    return { kind: 'supersede', reason: 'member_changed', current };
  }

  const requestedNameKey = memberNameKey(command.payload.display_name);

  const nameIsTaken = members.some(
    (member) =>
      member.id !== current.id &&
      member.status === 'active' &&
      memberNameKey(member.display_name) === requestedNameKey,
  );

  if (nameIsTaken) {
    return { kind: 'supersede', reason: 'member_name_taken', current };
  }

  return {
    kind: 'apply',
    before: current,
    member: {
      ...current,
      display_name: command.payload.display_name,
      updated_at: appliedAt,
    },
  };
}

export function decideMemberArchive(
  command: ArchiveMemberCommand,
  members: readonly LedgerMember[],
  accessGrants: readonly {
    identity_id: string;
    preferred_member_id: string | null;
  }[],
  appliedAt: string,
): MemberArchiveDecision {
  const current = members.find(
    (member) => member.id === command.payload.member_id,
  );

  if (!current) {
    return { kind: 'reject', reason: 'member_not_found', current: null };
  }

  if (current.status === 'archived') {
    return { kind: 'no_effect', current };
  }

  return {
    kind: 'apply',
    before: current,
    member: {
      ...current,
      status: 'archived',
      updated_at: appliedAt,
    },
    orphaned_identity_ids: accessGrants.flatMap((grant) =>
      grant.preferred_member_id === current.id ? [grant.identity_id] : [],
    ),
  };
}

export function memberNameKey(displayName: string): string {
  return displayName.normalize('NFKC').toLowerCase();
}
