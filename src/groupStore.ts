import type { JoinGroupCommand, PreferredMemberChoice } from './domain/access';
import {
  applyGroupCommand,
  commandTarget,
  type GroupCommand,
} from './domain/commands';
import {
  createdGroupSchema,
  type CreatedGroup,
  type GroupAccessGrant,
  type InitialGroupState,
} from './domain/groups';
import { createIdentifier } from './domain/ids';
import { memberNameKey, type LedgerMember } from './domain/members';
import {
  commandOutcomeSchema,
  type CommandOutcome,
  type GroupSnapshot,
  type SyncGroupCommand,
  type SyncGroupResponse,
} from './domain/sync';
import type {
  GroupDocument,
  GroupRepository,
  StoredAuditEvent,
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

export class GroupStore {
  constructor(
    private readonly repository: GroupRepository,
    private readonly createId: () => string = createIdentifier,
  ) {}

  create(initial: InitialGroupState): CreateStoredGroupResult {
    return this.repository.transaction((document) => {
      if (document) {
        return {
          document,
          result: this.resolveCreateRetry(document, initial.view),
        };
      }

      const createdDocument = this.createDocument(initial);

      return {
        document: createdDocument,
        result: { ok: true as const, created: initial.view },
      };
    });
  }

  join(command: JoinGroupCommand): JoinStoredGroupResult {
    return this.repository.transaction<JoinStoredGroupResult>((document) => {
      if (!document) {
        return {
          document,
          result: { ok: false as const, error: 'group_not_found' as const },
        };
      }

      const requestJson = JSON.stringify({
        group_id: command.group_id,
        identity_id: command.identity_id,
        join_id: command.join_id,
        preferred_member: command.preferred_member,
      });

      const stored = document.join_outcomes.find(
        (outcome) => outcome.join_id === command.join_id,
      );

      if (stored) {
        const result =
          stored.identity_id === command.identity_id &&
          stored.request_json === requestJson
            ? { ok: true as const, ...stored.response }
            : {
                ok: false as const,
                error: 'idempotency_conflict' as const,
              };

        return { document, result };
      }

      const preferred = this.resolvePreferredMember(
        command.preferred_member,
        document.snapshot.members,
        command.joined_at,
      );

      if (!preferred.ok) return { document, result: preferred };

      const previousAccess = document.snapshot.access_grants.find(
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
            actor_handle: `User ${document.next_actor_number}`,
            preferred_member_id: preferred.member.id,
            granted_at: command.joined_at,
            hidden_at: null,
          };

      const changed =
        preferred.created ||
        !previousAccess ||
        previousAccess.preferred_member_id !== access.preferred_member_id ||
        previousAccess.hidden_at !== null;

      if (preferred.created) {
        document.snapshot.members.push(preferred.member);
      }

      if (previousAccess) {
        document.snapshot.access_grants = document.snapshot.access_grants.map(
          (grant) => (grant.identity_id === access.identity_id ? access : grant),
        );
      } else {
        document.snapshot.access_grants.push(access);
        document.next_actor_number += 1;
      }

      if (changed) {
        document.revision += 1;
        document.audit_events.push(
          this.auditEvent(
            document,
            previousAccess ? 'group.rejoined' : 'group.joined',
            null,
            access,
            preferred.member.display_name,
            { kind: 'access', id: command.identity_id },
            command.joined_at,
            previousAccess,
            {
              access,
              created_member: preferred.created ? preferred.member : null,
            },
          ),
        );
      }

      const response = {
        revision: document.revision,
        snapshot: structuredClone(document.snapshot),
        access,
      };

      document.join_outcomes.push({
        join_id: command.join_id,
        identity_id: command.identity_id,
        request_json: requestJson,
        response,
      });

      return { document, result: { ok: true as const, ...response } };
    });
  }

  sync(command: SyncGroupCommand, appliedAt: string): SyncStoredGroupResult {
    return this.repository.transaction<SyncStoredGroupResult>((document) => {
      if (!document || !this.accessFor(document, command.identity_id)) {
        return {
          document,
          result: { ok: false as const, error: 'unauthorized' as const },
        };
      }

      const outcomes = command.commands.map((groupCommand) =>
        this.processCommand(
          document,
          command.identity_id,
          groupCommand,
          appliedAt,
        ),
      );

      const state =
        command.commands.length > 0 ||
        command.known_revision !== document.revision
          ? {
              kind: 'snapshot' as const,
              snapshot: structuredClone(document.snapshot),
            }
          : { kind: 'unchanged' as const };

      return {
        document,
        result: {
          ok: true as const,
          response: { revision: document.revision, outcomes, state },
        },
      };
    });
  }

  private createDocument(initial: InitialGroupState): GroupDocument {
    const { group, member, access } = initial.view;

    return {
      schema_version: 1,
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
      audit_events: [
        {
          sequence: initial.audit.sequence,
          id: this.createId(),
          revision: initial.audit.revision,
          action: initial.audit.action,
          command_id: null,
          actor_identity_id: initial.audit.actor_identity_id,
          actor_handle: access.actor_handle,
          actor_member_name: initial.audit.actor_member_name,
          target_kind: 'group',
          target_id: initial.audit.target_id,
          occurred_at: initial.audit.occurred_at,
          before: null,
          after: initial.view,
        },
      ],
      command_outcomes: [],
      join_outcomes: [],
    };
  }

  private resolveCreateRetry(
    document: GroupDocument,
    requested: CreatedGroup,
  ): CreateStoredGroupResult {
    const stored = document.creation;

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
    document: GroupDocument,
    identityId: string,
    command: GroupCommand,
    appliedAt: string,
  ): CommandOutcome {
    const commandJson = JSON.stringify(command);

    const stored = document.command_outcomes.find(
      (outcome) => outcome.command_id === command.command_id,
    );

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
        target: commandTarget(document.snapshot, identityId, command),
        server_state: null,
      };
    }

    const actor = this.accessFor(document, identityId);

    if (!actor) throw new Error('actor_missing_inside_transaction');

    const actorMemberName = this.memberNameFor(document, actor);

    const transition = applyGroupCommand(
      document.snapshot,
      identityId,
      command,
      appliedAt,
    );

    let auditId: string | null = null;

    if (transition.status === 'applied' && transition.audit) {
      document.snapshot = transition.snapshot;
      document.revision += 1;
      auditId = this.createId();
      document.audit_events.push(
        this.auditEvent(
          document,
          transition.audit.action,
          command.command_id,
          actor,
          actorMemberName,
          transition.target,
          appliedAt,
          transition.audit.before,
          transition.audit.after,
          auditId,
        ),
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

    document.command_outcomes.push({
      command_id: command.command_id,
      identity_id: identityId,
      command_json: commandJson,
      outcome,
    });

    return outcome;
  }

  private resolvePreferredMember(
    choice: PreferredMemberChoice,
    members: readonly LedgerMember[],
    joinedAt: string,
  ): PreferredMemberResult {
    if (choice.kind === 'existing') {
      const member = members.find((candidate) => candidate.id === choice.member_id);

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

  private auditEvent(
    document: GroupDocument,
    action: string,
    commandId: string | null,
    actor: GroupAccessGrant,
    actorMemberName: string | null,
    target: { kind: 'access' | 'group' | 'member'; id: string },
    occurredAt: string,
    before: StoredAuditEvent['before'],
    after: StoredAuditEvent['after'],
    auditId: string = this.createId(),
  ): StoredAuditEvent {
    return {
      sequence: document.audit_events.length + 1,
      id: auditId,
      revision: document.revision,
      action,
      command_id: commandId,
      actor_identity_id: actor.identity_id,
      actor_handle: actor.actor_handle,
      actor_member_name: actorMemberName,
      target_kind: target.kind,
      target_id: target.id,
      occurred_at: occurredAt,
      before,
      after,
    };
  }

  private accessFor(
    document: GroupDocument,
    identityId: string,
  ): GroupAccessGrant | null {
    return (
      document.snapshot.access_grants.find(
        (grant) => grant.identity_id === identityId,
      ) ?? null
    );
  }

  private memberNameFor(
    document: GroupDocument,
    access: GroupAccessGrant,
  ): string | null {
    if (!access.preferred_member_id) return null;

    return (
      document.snapshot.members.find(
        (member) => member.id === access.preferred_member_id,
      )?.display_name ?? null
    );
  }
}
