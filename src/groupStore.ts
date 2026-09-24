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
  GroupSnapshot,
  SyncGroupCommand,
  SyncGroupResponse,
} from './domain/sync';
import type {
  GroupPersistence,
  GroupRepository,
  StoredGroupState,
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
        | 'member_id_exists';
    };

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

      const requestJson = JSON.stringify({
        group_id: command.group_id,
        identity_id: command.identity_id,
        join_id: command.join_id,
        preferred_member: command.preferred_member,
      });

      const stored = persistence.findJoinOutcome(command.join_id);

      if (stored) {
        return stored.identity_id === command.identity_id &&
          stored.request_json === requestJson
          ? { ok: true, ...stored.response }
          : { ok: false, error: 'idempotency_conflict' };
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
          { kind: 'access', id: command.identity_id },
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

      if (!state || !this.accessFor(state, command.identity_id)) {
        return { ok: false, error: 'unauthorized' };
      }

      const revisionBefore = state.revision;

      const outcomes = command.commands.map((groupCommand) =>
        this.processCommand(
          persistence,
          state,
          command.identity_id,
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
