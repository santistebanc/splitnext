import type { JoinGroupCommand } from './domain/access';
import {
  AuditHistory,
  type AuditChange,
  type AuditEvent,
} from './domain/audit';
import {
  applyGroupCommand,
  applyGroupJoin,
  commandOutcomeSchema,
  commandTarget,
  resolveMemberAliases,
  type CommandOutcome,
  type CommandTarget,
  type GroupCommand,
} from './domain/commands';
import {
  createdGroupSchema,
  type CreatedGroup,
  type GroupAccessGrant,
  type InitialGroupState,
} from './domain/groups';
import { createIdentifier } from './domain/ids';
import type {
  CreateInviteCommand,
  GroupInvite,
  InviteFailure,
  InvitePreview,
  InviteRecord,
} from './domain/invites';
import type {
  GroupSnapshot,
  SyncGroupCommand,
  SyncGroupResponse,
} from './domain/sync';
import type {
  GroupPersistence,
  GroupRepository,
  StoredGroupState,
  StoredInvite,
} from './groupRepository';

export type CreateStoredGroupResult =
  | { ok: true; created: CreatedGroup }
  | { ok: false; error: 'group_exists' | 'idempotency_conflict' };

export type SyncStoredGroupResult =
  | { ok: true; response: SyncGroupResponse }
  | { ok: false; error: 'unauthorized' };

export type JoinStoredGroupResult =
  | {
      ok: true;
      revision: number;
      snapshot: GroupSnapshot;
      access: GroupAccessGrant;
    }
  | {
      ok: false;
      error:
        | 'group_not_found'
        | 'idempotency_conflict'
        | 'member_not_found'
        | 'member_archived'
        | 'member_name_taken'
        | 'member_id_exists'
        | InviteFailure;
    };

export type CreateStoredInviteResult =
  | { ok: true; revision: number; invite: GroupInvite }
  | {
      ok: false;
      error: 'group_not_found' | 'unauthorized' | 'idempotency_conflict';
    };

export type RevokeStoredInviteResult =
  | { ok: true; revision: number; changed: boolean }
  | {
      ok: false;
      error: 'group_not_found' | 'unauthorized' | 'invite_not_found';
    };

export type PreviewStoredInviteResult =
  | { ok: true; preview: InvitePreview }
  | { ok: false; error: 'group_not_found' | InviteFailure };

export type SubscriptionAccessResult =
  | { ok: true; revision: number }
  | { ok: false; error: 'group_not_found' | 'unauthorized' | 'group_hidden' };

export type GroupInspection = {
  revision: number;
  snapshot: GroupSnapshot;
};

export class GroupStore {
  constructor(
    private readonly repository: GroupRepository,
    private readonly createId: () => string = createIdentifier,
  ) {}

  create(initial: InitialGroupState): CreateStoredGroupResult {
    return this.repository.transaction((persistence) => {
      const existing = persistence.loadState();

      if (existing) return this.resolveCreateRetry(existing, initial.view);

      const state = this.createState(initial);
      const { group, member, access } = initial.view;

      persistence.saveState(state);
      this.auditHistory(persistence).record(
        { action: 'group.created', before: null, after: initial.view },
        {
          revision: group.revision,
          command_id: null,
          actor_identity_id: access.identity_id,
          actor_handle: access.actor_handle,
          actor_member_name: member.display_name,
          target: { kind: 'group', id: group.id },
          occurred_at: group.created_at,
        },
      );

      return { ok: true, created: initial.view };
    });
  }

  join(command: JoinGroupCommand): JoinStoredGroupResult {
    return this.repository.transaction((persistence) => {
      const state = persistence.loadState();

      if (!state) return { ok: false, error: 'group_not_found' };

      const identityId = command.identity_id;

      const requestJson = JSON.stringify({
        group_id: command.group_id,
        identity_id: identityId,
        join_id: command.join_id,
        preferred_member: command.preferred_member,
      });

      const stored = persistence.findJoinOutcome(command.join_id);

      if (stored) {
        return stored.identity_id === identityId &&
          stored.request_json === requestJson
          ? { ok: true, ...stored.response }
          : { ok: false, error: 'idempotency_conflict' };
      }

      // Access is permanent, so an identity that left rejoins without a link.
      if (!this.accessFor(state, identityId)) {
        const failure = inviteFailure(
          persistence,
          command.invite_token_hash,
          command.joined_at,
        );

        if (failure) return { ok: false, error: failure };
      }

      const transition = applyGroupJoin(
        state.snapshot,
        state.next_actor_number,
        command,
      );

      if (!transition.ok) return transition;

      if (transition.changed && transition.audit) {
        state.next_actor_number = transition.nextActorNumber;

        const actorMemberName =
          transition.snapshot.members.find(
            (member) => member.id === transition.access.preferred_member_id,
          )?.display_name ?? null;

        this.commitTransition(
          persistence,
          state,
          transition.snapshot,
          transition.audit,
          transition.access,
          actorMemberName,
          { kind: 'access', id: identityId },
          null,
          command.joined_at,
        );
        persistence.saveState(state);
      }

      const response = {
        revision: state.revision,
        snapshot: structuredClone(state.snapshot),
        access: transition.access,
      };

      persistence.recordJoinOutcome({
        join_id: command.join_id,
        identity_id: command.identity_id,
        request_json: requestJson,
        response,
      });

      return { ok: true, ...response };
    });
  }

  sync(command: SyncGroupCommand, appliedAt: string): SyncStoredGroupResult {
    return this.repository.transaction((persistence) => {
      const state = persistence.loadState();
      const identityId = command.identity_id;

      if (!state) {
        return { ok: false, error: 'unauthorized' };
      }

      const access = this.accessFor(state, identityId);

      if (!access) return { ok: false, error: 'unauthorized' };

      const revisionBefore = state.revision;

      const outcomes = command.commands.map((groupCommand) =>
        this.processCommand(
          persistence,
          state,
          identityId,
          groupCommand,
          appliedAt,
        ),
      );

      if (state.revision !== revisionBefore) persistence.saveState(state);

      const synchronizedState =
        command.commands.length > 0 ||
        command.known_revision !== state.revision
          ? {
              kind: 'snapshot' as const,
              snapshot: structuredClone(state.snapshot),
            }
          : { kind: 'unchanged' as const };

      return {
        ok: true,
        response: {
          revision: state.revision,
          outcomes,
          state: synchronizedState,
        },
      };
    });
  }

  /**
   * Creates the group's current invite link, revoking any previous one.
   * Repeating a creation with the same id and token returns the same link.
   */
  createInvite(command: CreateInviteCommand): CreateStoredInviteResult {
    return this.repository.transaction((persistence) => {
      const state = persistence.loadState();

      if (!state) return { ok: false, error: 'group_not_found' };

      const identityId = command.identity_id;
      const actor = this.accessFor(state, identityId);

      if (!actor || actor.hidden_at) return { ok: false, error: 'unauthorized' };

      const existing =
        persistence.findInvite(command.invite_id) ??
        persistence.findInviteByTokenHash(command.token_hash);

      if (existing) {
        return existing.id === command.invite_id &&
          existing.token_hash === command.token_hash &&
          existing.created_by_identity_id === identityId
          ? { ok: true, revision: state.revision, invite: inviteView(existing) }
          : { ok: false, error: 'idempotency_conflict' };
      }

      const previous = state.snapshot.invite;

      const created: StoredInvite = {
        id: command.invite_id,
        token_hash: command.token_hash,
        created_by_identity_id: identityId,
        created_at: command.created_at,
        expires_at: command.expires_at,
        revoked_at: null,
      };

      if (previous) persistence.revokeInvite(previous.id, command.created_at);

      persistence.recordInvite(created);

      const invite = inviteView(created);

      this.commitTransition(
        persistence,
        state,
        { ...state.snapshot, invite },
        {
          action: 'invite.created',
          before: previous ? { ...previous, revoked_at: command.created_at } : null,
          after: { ...invite, revoked_at: null },
        },
        actor,
        this.memberNameFor(state, actor),
        { kind: 'invite', id: invite.id },
        null,
        command.created_at,
      );
      persistence.saveState(state);

      return { ok: true, revision: state.revision, invite };
    });
  }

  /** Revoking stops new joins through the link; granted access remains. */
  revokeInvite(
    identityId: string,
    inviteId: string,
    revokedAt: string,
  ): RevokeStoredInviteResult {
    return this.repository.transaction((persistence) => {
      const state = persistence.loadState();

      if (!state) return { ok: false, error: 'group_not_found' };

      const actor = this.accessFor(state, identityId);

      if (!actor || actor.hidden_at) return { ok: false, error: 'unauthorized' };

      const current = state.snapshot.invite;

      if (current?.id !== inviteId) {
        return persistence.findInvite(inviteId)
          ? { ok: true, revision: state.revision, changed: false }
          : { ok: false, error: 'invite_not_found' };
      }

      const before: InviteRecord = { ...current, revoked_at: null };

      persistence.revokeInvite(inviteId, revokedAt);
      this.commitTransition(
        persistence,
        state,
        { ...state.snapshot, invite: null },
        {
          action: 'invite.revoked',
          before,
          after: { ...before, revoked_at: revokedAt },
        },
        actor,
        this.memberNameFor(state, actor),
        { kind: 'invite', id: inviteId },
        null,
        revokedAt,
      );
      persistence.saveState(state);

      return { ok: true, revision: state.revision, changed: true };
    });
  }

  /** Lets a link holder see the group and choose who they are before joining. */
  previewInvite(tokenHash: string, at: string): PreviewStoredInviteResult {
    return this.repository.transaction((persistence) => {
      const state = persistence.loadState();

      if (!state) return { ok: false, error: 'group_not_found' };

      const failure = inviteFailure(persistence, tokenHash, at);

      if (failure) return { ok: false, error: failure };

      const invite = persistence.findInviteByTokenHash(tokenHash);

      if (!invite) return { ok: false, error: 'invite_invalid' };

      const { group, members } = state.snapshot;

      return {
        ok: true,
        preview: {
          group: {
            id: group.id,
            name: group.name,
            currency_code: group.currency_code,
          },
          members: members.flatMap((member) =>
            member.status === 'active'
              ? [{ id: member.id, display_name: member.display_name }]
              : [],
          ),
          expires_at: invite.expires_at,
        },
      };
    });
  }

  /** Only identities that can currently see the group receive announcements. */
  subscriptionAccess(identityId: string): SubscriptionAccessResult {
    return this.repository.transaction((persistence) => {
      const state = persistence.loadState();

      if (!state) return { ok: false, error: 'group_not_found' };

      const access = this.accessFor(state, identityId);

      if (!access) return { ok: false, error: 'unauthorized' };

      if (access.hidden_at) return { ok: false, error: 'group_hidden' };

      return { ok: true, revision: state.revision };
    });
  }

  inspect(): GroupInspection | null {
    return this.repository.transaction((persistence) => {
      const state = persistence.loadState();

      return state
        ? {
            revision: state.revision,
            snapshot: structuredClone(state.snapshot),
          }
        : null;
    });
  }

  history(): AuditEvent[] {
    return this.repository.transaction((persistence) =>
      this.auditHistory(persistence).read(),
    );
  }

  private createState(initial: InitialGroupState): StoredGroupState {
    const { group, member, access } = initial.view;

    return {
      revision: group.revision,
      next_actor_number: 2,
      creation: {
        creator_identity_id: access.identity_id,
        request: {
          group_id: group.id,
          name: group.name,
          currency_code: group.currency_code,
          creator_member_name: member.display_name,
        },
        response: initial.view,
      },
      snapshot: {
        group: {
          id: group.id,
          name: group.name,
          currency_code: group.currency_code,
          created_at: group.created_at,
        },
        members: [member],
        access_grants: [access],
        invite: null,
      },
    };
  }

  private resolveCreateRetry(
    state: StoredGroupState,
    requested: CreatedGroup,
  ): CreateStoredGroupResult {
    const stored = state.creation;

    if (stored.creator_identity_id !== requested.access.identity_id) {
      return { ok: false, error: 'group_exists' };
    }

    const sameInput =
      stored.request.group_id === requested.group.id &&
      stored.request.name === requested.group.name &&
      stored.request.currency_code === requested.group.currency_code &&
      stored.request.creator_member_name === requested.member.display_name;

    if (!sameInput) return { ok: false, error: 'idempotency_conflict' };

    return {
      ok: true,
      created: createdGroupSchema.parse(stored.response),
    };
  }

  private processCommand(
    persistence: GroupPersistence,
    state: StoredGroupState,
    identityId: string,
    command: GroupCommand,
    appliedAt: string,
  ): CommandOutcome {
    const commandJson = JSON.stringify(command);
    const stored = persistence.findCommandOutcome(command.command_id);

    if (stored) {
      if (
        stored.identity_id === identityId &&
        stored.command_json === commandJson
      ) {
        return commandOutcomeSchema.parse(stored.outcome);
      }

      return {
        command_id: command.command_id,
        command_type: command.type,
        status: 'rejected',
        reason: 'idempotency_conflict',
        audit_id: null,
        target: commandTarget(state.snapshot, identityId, command),
        server_state: null,
      };
    }

    const actor = this.accessFor(state, identityId);

    if (!actor) throw new Error('actor_missing_inside_transaction');

    const actorMemberName = this.memberNameFor(state, actor);

    const transition = applyGroupCommand(
      state.snapshot,
      identityId,
      resolveMemberAliases(command, persistence.memberAliases()),
      appliedAt,
    );

    if (transition.memberAlias) {
      persistence.recordMemberAlias(transition.memberAlias);
    }

    let auditId: string | null = null;

    if (transition.status === 'applied' && transition.audit) {
      auditId = this.commitTransition(
        persistence,
        state,
        transition.snapshot,
        transition.audit,
        actor,
        actorMemberName,
        transition.target,
        command.command_id,
        appliedAt,
      );
    }

    const outcome: CommandOutcome = {
      command_id: command.command_id,
      command_type: command.type,
      status: transition.status,
      reason: transition.reason,
      audit_id: auditId,
      target: transition.target,
      server_state: transition.serverState,
    };

    persistence.recordCommandOutcome({
      command_id: command.command_id,
      identity_id: identityId,
      command_json: commandJson,
      outcome,
    });

    return outcome;
  }

  private commitTransition(
    persistence: GroupPersistence,
    state: StoredGroupState,
    snapshot: GroupSnapshot,
    audit: AuditChange,
    actor: GroupAccessGrant,
    actorMemberName: string | null,
    target: CommandTarget,
    commandId: string | null,
    occurredAt: string,
  ): string {
    state.snapshot = snapshot;
    state.revision += 1;

    return this.auditHistory(persistence).record(audit, {
      revision: state.revision,
      command_id: commandId,
      actor_identity_id: actor.identity_id,
      actor_handle: actor.actor_handle,
      actor_member_name: actorMemberName,
      target,
      occurred_at: occurredAt,
    }).id;
  }

  private auditHistory(persistence: GroupPersistence): AuditHistory {
    return new AuditHistory(persistence, this.createId);
  }

  private accessFor(
    state: StoredGroupState,
    identityId: string,
  ): GroupAccessGrant | null {
    return (
      state.snapshot.access_grants.find(
        (grant) => grant.identity_id === identityId,
      ) ?? null
    );
  }

  private memberNameFor(
    state: StoredGroupState,
    access: GroupAccessGrant,
  ): string | null {
    if (!access.preferred_member_id) return null;

    return (
      state.snapshot.members.find(
        (member) => member.id === access.preferred_member_id,
      )?.display_name ?? null
    );
  }
}

function inviteFailure(
  persistence: GroupPersistence,
  tokenHash: string | null,
  at: string,
): InviteFailure | null {
  if (!tokenHash) return 'invite_required';

  const invite = persistence.findInviteByTokenHash(tokenHash);

  if (!invite) return 'invite_invalid';

  if (invite.revoked_at) return 'invite_revoked';

  return Date.parse(invite.expires_at) <= Date.parse(at)
    ? 'invite_expired'
    : null;
}

function inviteView(invite: StoredInvite): GroupInvite {
  return {
    id: invite.id,
    created_by_identity_id: invite.created_by_identity_id,
    created_at: invite.created_at,
    expires_at: invite.expires_at,
  };
}
