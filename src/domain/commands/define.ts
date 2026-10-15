import type { AuditChange } from '../audit';
import type { GroupAccessGrant } from '../groups';
import type { GroupSnapshot } from '../sync';
import type { CommandReason, CommandServerState, CommandTarget } from './outcomes';

/** What every group command carries on the wire. */
export type CommandBase = { command_id: string; type: string; payload: Record<string, string> };

/**
 * A member id a client generated for a creation that merged into an existing
 * member. Commands that name the alias act on that member instead.
 */
export type MemberAlias = {
  alias_id: string;
  member_id: string;
};

/** The result of applying one command to a snapshot. */
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

/**
 * A command as a person states it: the command without its identifier, with
 * the listed preconditions optional because the client fills them from the
 * state the person saw.
 */
export type IntentOf<C extends CommandBase, Filled extends keyof C['payload'] = never> = {
  type: C['type'];
  payload: Omit<C['payload'], Filled> & {
    [K in Filled]?: C['payload'][K] | undefined;
  };
};

/**
 * Everything one command means, in one place: how it applies on the server
 * and in every client projection, what it targets, how merged member ids are
 * rewritten in it, how a person's intent becomes it, and how a rejected one
 * becomes fresh intent again.
 */
export type CommandDefinition<C extends CommandBase, I> = {
  /** Commands that deliberately stop authority must start online. */
  requiresServerDecision: boolean;
  target(snapshot: GroupSnapshot, identityId: string, command: C): CommandTarget;
  resolveAliases(command: C, aliases: ReadonlyMap<string, string>): C;
  /** Completes an intent against the projection the person saw. */
  complete(commandId: string, intent: I, snapshot: GroupSnapshot, createId: () => string): C;
  /** The original intent without stale preconditions, naming members that still exist. */
  retryIntent(command: C, member: (memberId: string) => string): I;
  apply(snapshot: GroupSnapshot, identityId: string, command: C, appliedAt: string): CommandTransition;
};

export function defineCommand<C extends CommandBase, I>(definition: CommandDefinition<C, I>): CommandDefinition<C, I> {
  return definition;
}

/** Rewrites a member-targeting command through recorded aliases. */
export function withResolvedMember<C extends { payload: { member_id: string } }>(
  command: C,
  aliases: ReadonlyMap<string, string>,
): C {
  const memberId = aliases.get(command.payload.member_id);

  return memberId
    ? { ...command, payload: { ...command.payload, member_id: memberId } }
    : command;
}

export function replaceAccess(
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

export function unchanged(
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

export function rejected(
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
