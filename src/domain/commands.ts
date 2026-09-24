import { z } from 'zod';
import {
  leaveGroupCommandSchema,
  setPreferredMemberCommandSchema,
} from './access';
import {
  renameGroupCommandSchema,
  type GroupAccessGrant,
} from './groups';
import {
  archiveMemberCommandSchema,
  createMemberCommandSchema,
  decideMemberArchive,
  decideMemberCreation,
  decideMemberRename,
  renameMemberCommandSchema,
} from './members';
import type { GroupSnapshot } from './sync';

export const groupCommandSchema = z.discriminatedUnion('type', [
  renameGroupCommandSchema,
  createMemberCommandSchema,
  renameMemberCommandSchema,
  archiveMemberCommandSchema,
  setPreferredMemberCommandSchema,
  leaveGroupCommandSchema,
]);

export type GroupCommand = z.output<typeof groupCommandSchema>;

export type CommandReason =
  | 'access_not_found'
  | 'group_changed'
  | 'idempotency_conflict'
  | 'member_archived'
  | 'member_changed'
  | 'member_id_exists'
  | 'member_name_taken'
  | 'member_not_found';

export type CommandTarget =
  | { kind: 'group'; id: string }
  | { kind: 'member'; id: string }
  | { kind: 'access'; id: string };

export type CommandServerState =
  | { kind: 'group'; group: GroupSnapshot['group'] }
  | { kind: 'member'; member: GroupSnapshot['members'][number] }
  | { kind: 'access'; access: GroupAccessGrant };

export type CommandTransition = {
  snapshot: GroupSnapshot;
  status: 'applied' | 'no_effect' | 'superseded' | 'rejected';
  reason: CommandReason | null;
  target: CommandTarget;
  serverState: CommandServerState | null;
  audit: {
    action: string;
    before: unknown;
    after: unknown;
  } | null;
};

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

  return {
    snapshot,
    status: decision.kind === 'supersede' ? 'superseded' : 'rejected',
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
