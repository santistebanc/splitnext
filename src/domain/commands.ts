import { z } from 'zod';
import type { AuditChange } from './audit';
import type { JoinGroupCommand, PreferredMemberChoice } from './access';
import {
  groupAccessGrantSchema,
  groupDetailsSchema,
  groupNameSchema,
  type GroupAccessGrant,
} from './groups';
import { identifierSchema } from './ids';
import {
  ledgerMemberSchema,
  memberNameKey,
  memberNameSchema,
  type LedgerMember,
} from './members';
import type { GroupSnapshot } from './sync';

export const groupCommandTypes = {
  renameGroup: 'group.rename',
  createMember: 'member.create',
  renameMember: 'member.rename',
  archiveMember: 'member.archive',
  setPreference: 'preference.set',
  leaveGroup: 'group.leave',
} as const;

export const groupCommandTypeSchema = z.enum(groupCommandTypes);

export const renameGroupCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.renameGroup),
  payload: z.object({
    expected_name: groupNameSchema,
    name: groupNameSchema,
  }),
});

export const createMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.createMember),
  payload: z.object({
    member_id: identifierSchema,
    display_name: memberNameSchema,
  }),
});

export const renameMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.renameMember),
  payload: z.object({
    member_id: identifierSchema,
    expected_display_name: memberNameSchema,
    display_name: memberNameSchema,
  }),
});

export const archiveMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.archiveMember),
  payload: z.object({
    member_id: identifierSchema,
  }),
});

export const setPreferredMemberCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.setPreference),
  payload: z.object({ member_id: identifierSchema }),
});

export const leaveGroupCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.leaveGroup),
  payload: z.object({}),
});

export const groupCommandSchema = z.discriminatedUnion('type', [
  renameGroupCommandSchema,
  createMemberCommandSchema,
  renameMemberCommandSchema,
  archiveMemberCommandSchema,
  setPreferredMemberCommandSchema,
  leaveGroupCommandSchema,
]);

export type GroupCommand = z.output<typeof groupCommandSchema>;

export type CreateMemberCommand = z.output<typeof createMemberCommandSchema>;

export type RenameMemberCommand = z.output<typeof renameMemberCommandSchema>;

export type ArchiveMemberCommand = z.output<typeof archiveMemberCommandSchema>;

export const commandReasons = {
  accessNotFound: 'access_not_found',
  groupChanged: 'group_changed',
  idempotencyConflict: 'idempotency_conflict',
  memberArchived: 'member_archived',
  memberChanged: 'member_changed',
  memberIdExists: 'member_id_exists',
  memberMerged: 'member_merged',
  memberNameTaken: 'member_name_taken',
  memberNotFound: 'member_not_found',
} as const;

export const commandReasonSchema = z.enum(commandReasons);

export type CommandReason = z.output<typeof commandReasonSchema>;

export const commandTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('group'), id: identifierSchema }),
  z.object({ kind: z.literal('member'), id: identifierSchema }),
  z.object({ kind: z.literal('access'), id: identifierSchema }),
]);

export type CommandTarget = z.output<typeof commandTargetSchema>;

export const commandServerStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('group'), group: groupDetailsSchema }),
  z.object({ kind: z.literal('member'), member: ledgerMemberSchema }),
  z.object({ kind: z.literal('access'), access: groupAccessGrantSchema }),
]);

export type CommandServerState = z.output<typeof commandServerStateSchema>;

export const commandOutcomeSchema = z.object({
  command_id: identifierSchema,
  command_type: groupCommandTypeSchema,
  status: z.enum(['applied', 'no_effect', 'superseded', 'rejected']),
  reason: commandReasonSchema.nullable(),
  audit_id: identifierSchema.nullable(),
  target: commandTargetSchema,
  server_state: commandServerStateSchema.nullable(),
});

export type CommandOutcome = z.output<typeof commandOutcomeSchema>;

export type CommandTransition = {
  snapshot: GroupSnapshot;
  status: 'applied' | 'no_effect' | 'superseded' | 'rejected';
  reason: CommandReason | null;
  target: CommandTarget;
  serverState: CommandServerState | null;
  audit: AuditChange | null;
  /** A merged creation's member id, to be resolved to the existing member. */
  memberAlias?: MemberAlias;
};

export type JoinTransition =
  | {
      ok: true;
      changed: boolean;
      snapshot: GroupSnapshot;
      access: GroupAccessGrant;
      nextActorNumber: number;
      audit: CommandTransition['audit'];
    }
  | {
      ok: false;
      error:
        | 'member_not_found'
        | 'member_archived'
        | 'member_name_taken'
        | 'member_id_exists';
    };

type PreferredMemberResult =
  | { ok: true; member: LedgerMember; created: boolean }
  | {
      ok: false;
      error:
        | 'member_not_found'
        | 'member_archived'
        | 'member_name_taken'
        | 'member_id_exists';
    };

type MemberCreationDecision =
  | { kind: 'apply'; member: LedgerMember }
  | { kind: 'merge'; current: LedgerMember }
  | {
      kind: 'reject';
      reason: 'member_id_exists';
      current: LedgerMember;
    };

type MemberRenameDecision =
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

type MemberArchiveDecision =
  | {
      kind: 'apply';
      before: LedgerMember;
      member: LedgerMember;
      orphaned_identity_ids: string[];
    }
  | { kind: 'no_effect'; current: LedgerMember }
  | { kind: 'reject'; reason: 'member_not_found'; current: null };

export function applyGroupJoin(
  snapshot: GroupSnapshot,
  nextActorNumber: number,
  command: JoinGroupCommand,
): JoinTransition {
  const preferred = resolvePreferredMember(
    command.preferred_member,
    snapshot.members,
    command.joined_at,
  );

  if (!preferred.ok) return preferred;

  const previousAccess = snapshot.access_grants.find(
    (grant) => grant.identity_id === command.identity_id,
  );

  const access = previousAccess
    ? {
        ...previousAccess,
        preferred_member_id: preferred.member.id,
        hidden_at: null,
      }
    : {
        identity_id: command.identity_id,
        actor_handle: `User ${nextActorNumber}`,
        preferred_member_id: preferred.member.id,
        granted_at: command.joined_at,
        hidden_at: null,
      };

  const changed =
    preferred.created ||
    !previousAccess ||
    previousAccess.preferred_member_id !== access.preferred_member_id ||
    previousAccess.hidden_at !== null;

  const members = preferred.created
    ? [...snapshot.members, preferred.member]
    : snapshot.members;

  const accessGrants = previousAccess
    ? snapshot.access_grants.map((grant) =>
        grant.identity_id === access.identity_id ? access : grant,
      )
    : [...snapshot.access_grants, access];

  return {
    ok: true,
    changed,
    snapshot: {
      ...snapshot,
      members,
      access_grants: accessGrants,
    },
    access,
    nextActorNumber: previousAccess ? nextActorNumber : nextActorNumber + 1,
    audit: !changed
      ? null
      : previousAccess
        ? {
            action: 'group.rejoined',
            before: previousAccess,
            after: {
              access,
              created_member: preferred.created ? preferred.member : null,
            },
          }
        : {
            action: 'group.joined',
            before: null,
            after: {
              access,
              created_member: preferred.created ? preferred.member : null,
            },
          },
  };
}

export function applyGroupCommand(
  snapshot: GroupSnapshot,
  identityId: string,
  command: GroupCommand,
  appliedAt: string,
): CommandTransition {
  switch (command.type) {
    case 'group.rename':
      return applyGroupRename(snapshot, command);
    case 'member.create':
      return applyMemberCreate(snapshot, command, appliedAt);
    case 'member.rename':
      return applyMemberRename(snapshot, command, appliedAt);
    case 'member.archive':
      return applyMemberArchive(snapshot, command, appliedAt);
    case 'preference.set':
      return applyPreferredMember(snapshot, identityId, command.payload.member_id);
    case 'group.leave':
      return applyGroupLeave(snapshot, identityId, appliedAt);
  }
}

/**
 * A member id a client generated for a creation that merged into an existing
 * member. Commands that name the alias act on that member instead.
 */
export type MemberAlias = {
  alias_id: string;
  member_id: string;
};

/** Rewrites a command's member reference through recorded aliases. */
export function resolveMemberAliases(
  command: GroupCommand,
  aliases: ReadonlyMap<string, string>,
): GroupCommand {
  switch (command.type) {
    case 'member.create':
      return withResolvedMember(command, aliases);
    case 'member.rename':
      return withResolvedMember(command, aliases);
    case 'member.archive':
      return withResolvedMember(command, aliases);
    case 'preference.set':
      return withResolvedMember(command, aliases);
    case 'group.rename':
    case 'group.leave':
      return command;
  }
}

function withResolvedMember<
  TCommand extends { payload: { member_id: string } },
>(command: TCommand, aliases: ReadonlyMap<string, string>): TCommand {
  const memberId = aliases.get(command.payload.member_id);

  return memberId
    ? { ...command, payload: { ...command.payload, member_id: memberId } }
    : command;
}

export function commandTarget(
  snapshot: GroupSnapshot,
  identityId: string,
  command: GroupCommand,
): CommandTarget {
  switch (command.type) {
    case 'group.rename':
      return { kind: 'group', id: snapshot.group.id };
    case 'member.create':
    case 'member.rename':
    case 'member.archive':
      return { kind: 'member', id: command.payload.member_id };
    case 'preference.set':
    case 'group.leave':
      return { kind: 'access', id: identityId };
  }
}

function applyGroupRename(
  snapshot: GroupSnapshot,
  command: Extract<GroupCommand, { type: 'group.rename' }>,
): CommandTransition {
  const target = { kind: 'group' as const, id: snapshot.group.id };

  if (snapshot.group.name === command.payload.name) {
    return unchanged(snapshot, target, {
      kind: 'group',
      group: snapshot.group,
    });
  }

  if (snapshot.group.name !== command.payload.expected_name) {
    return {
      snapshot,
      status: 'superseded',
      reason: 'group_changed',
      target,
      serverState: { kind: 'group', group: snapshot.group },
      audit: null,
    };
  }

  const group = { ...snapshot.group, name: command.payload.name };

  return {
    snapshot: { ...snapshot, group },
    status: 'applied',
    reason: null,
    target,
    serverState: { kind: 'group', group },
    audit: { action: 'group.renamed', before: snapshot.group, after: group },
  };
}

function applyMemberCreate(
  snapshot: GroupSnapshot,
  command: Extract<GroupCommand, { type: 'member.create' }>,
  appliedAt: string,
): CommandTransition {
  const target = { kind: 'member' as const, id: command.payload.member_id };
  const decision = decideMemberCreation(command, snapshot.members, appliedAt);

  if (decision.kind === 'apply') {
    return {
      snapshot: {
        ...snapshot,
        members: [...snapshot.members, decision.member],
      },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'member', member: decision.member },
      audit: {
        action: 'member.created',
        before: null,
        after: decision.member,
      },
    };
  }

  if (decision.kind === 'merge') {
    return {
      snapshot,
      status: 'no_effect',
      reason: 'member_merged',
      target,
      serverState: { kind: 'member', member: decision.current },
      audit: null,
      memberAlias: {
        alias_id: command.payload.member_id,
        member_id: decision.current.id,
      },
    };
  }

  return {
    snapshot,
    status: 'rejected',
    reason: decision.reason,
    target,
    serverState: { kind: 'member', member: decision.current },
    audit: null,
  };
}

function applyMemberRename(
  snapshot: GroupSnapshot,
  command: Extract<GroupCommand, { type: 'member.rename' }>,
  appliedAt: string,
): CommandTransition {
  const target = { kind: 'member' as const, id: command.payload.member_id };
  const decision = decideMemberRename(command, snapshot.members, appliedAt);

  if (decision.kind === 'apply') {
    return {
      snapshot: {
        ...snapshot,
        members: snapshot.members.map((member) =>
          member.id === decision.member.id ? decision.member : member,
        ),
      },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'member', member: decision.member },
      audit: {
        action: 'member.renamed',
        before: decision.before,
        after: decision.member,
      },
    };
  }

  return {
    snapshot,
    status:
      decision.kind === 'no_effect'
        ? 'no_effect'
        : decision.kind === 'supersede'
          ? 'superseded'
          : 'rejected',
    reason: decision.kind === 'no_effect' ? null : decision.reason,
    target,
    serverState: decision.current
      ? { kind: 'member', member: decision.current }
      : null,
    audit: null,
  };
}

function applyMemberArchive(
  snapshot: GroupSnapshot,
  command: Extract<GroupCommand, { type: 'member.archive' }>,
  appliedAt: string,
): CommandTransition {
  const target = { kind: 'member' as const, id: command.payload.member_id };

  const decision = decideMemberArchive(
    command,
    snapshot.members,
    snapshot.access_grants,
    appliedAt,
  );

  if (decision.kind === 'apply') {
    const accessGrants = snapshot.access_grants.map((grant) =>
      grant.preferred_member_id === decision.member.id
        ? { ...grant, preferred_member_id: null }
        : grant,
    );

    return {
      snapshot: {
        ...snapshot,
        members: snapshot.members.map((member) =>
          member.id === decision.member.id ? decision.member : member,
        ),
        access_grants: accessGrants,
      },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'member', member: decision.member },
      audit: {
        action: 'member.archived',
        before: {
          member: decision.before,
          preferred_by: decision.orphaned_identity_ids,
        },
        after: { member: decision.member, preferred_by: [] },
      },
    };
  }

  return {
    snapshot,
    status: decision.kind === 'no_effect' ? 'no_effect' : 'rejected',
    reason: decision.kind === 'no_effect' ? null : decision.reason,
    target,
    serverState: decision.current
      ? { kind: 'member', member: decision.current }
      : null,
    audit: null,
  };
}

function applyPreferredMember(
  snapshot: GroupSnapshot,
  identityId: string,
  memberId: string,
): CommandTransition {
  const target = { kind: 'access' as const, id: identityId };

  const access = snapshot.access_grants.find(
    (candidate) => candidate.identity_id === identityId,
  );

  if (!access) return rejected(snapshot, target, 'access_not_found');

  const member = snapshot.members.find((candidate) => candidate.id === memberId);

  if (!member) return rejected(snapshot, target, 'member_not_found');

  if (member.status === 'archived') {
    return rejected(snapshot, target, 'member_archived');
  }

  if (access.preferred_member_id === member.id) {
    return unchanged(snapshot, target, { kind: 'access', access });
  }

  const updated = { ...access, preferred_member_id: member.id };

  return {
    snapshot: replaceAccess(snapshot, updated),
    status: 'applied',
    reason: null,
    target,
    serverState: { kind: 'access', access: updated },
    audit: {
      action: 'preference.changed',
      before: access,
      after: updated,
    },
  };
}

function applyGroupLeave(
  snapshot: GroupSnapshot,
  identityId: string,
  appliedAt: string,
): CommandTransition {
  const target = { kind: 'access' as const, id: identityId };

  const access = snapshot.access_grants.find(
    (candidate) => candidate.identity_id === identityId,
  );

  if (!access) return rejected(snapshot, target, 'access_not_found');

  if (access.hidden_at !== null && access.preferred_member_id === null) {
    return unchanged(snapshot, target, { kind: 'access', access });
  }

  const updated = {
    ...access,
    preferred_member_id: null,
    hidden_at: appliedAt,
  };

  return {
    snapshot: replaceAccess(snapshot, updated),
    status: 'applied',
    reason: null,
    target,
    serverState: { kind: 'access', access: updated },
    audit: { action: 'group.left', before: access, after: updated },
  };
}

function decideMemberCreation(
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

  // Active names are unique, so the same name means the same person: the
  // intent is already satisfied by the member another device added.
  if (memberWithName) return { kind: 'merge', current: memberWithName };

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

function decideMemberRename(
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

function decideMemberArchive(
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

function resolvePreferredMember(
  choice: PreferredMemberChoice,
  members: readonly LedgerMember[],
  joinedAt: string,
): PreferredMemberResult {
  if (choice.kind === 'existing') {
    const member = members.find(
      (candidate) => candidate.id === choice.member_id,
    );

    if (!member) return { ok: false, error: 'member_not_found' };

    return member.status === 'active'
      ? { ok: true, member, created: false }
      : { ok: false, error: 'member_archived' };
  }

  if (members.some((member) => member.id === choice.member_id)) {
    return { ok: false, error: 'member_id_exists' };
  }

  const requestedNameKey = memberNameKey(choice.display_name);

  const nameIsTaken = members.some(
    (member) =>
      member.status === 'active' &&
      memberNameKey(member.display_name) === requestedNameKey,
  );

  if (nameIsTaken) return { ok: false, error: 'member_name_taken' };

  return {
    ok: true,
    created: true,
    member: {
      id: choice.member_id,
      display_name: choice.display_name,
      status: 'active',
      created_at: joinedAt,
      updated_at: joinedAt,
    },
  };
}

function replaceAccess(
  snapshot: GroupSnapshot,
  access: GroupAccessGrant,
): GroupSnapshot {
  return {
    ...snapshot,
    access_grants: snapshot.access_grants.map((candidate) =>
      candidate.identity_id === access.identity_id ? access : candidate,
    ),
  };
}

function unchanged(
  snapshot: GroupSnapshot,
  target: CommandTarget,
  serverState: CommandServerState,
): CommandTransition {
  return {
    snapshot,
    status: 'no_effect',
    reason: null,
    target,
    serverState,
    audit: null,
  };
}

function rejected(
  snapshot: GroupSnapshot,
  target: CommandTarget,
  reason: CommandReason,
): CommandTransition {
  return {
    snapshot,
    status: 'rejected',
    reason,
    target,
    serverState: null,
    audit: null,
  };
}
