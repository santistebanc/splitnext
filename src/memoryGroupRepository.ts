import { auditEventSchema, newAuditEventSchema, type AuditEvent, type NewAuditEvent } from './domain/audit';
import type { GroupPersistence, GroupRepository, StoredGroupState, StoredCommandOutcome, StoredJoinOutcome, StoredInvite } from './groupPersistence';

type MemoryGroupData = {
  state: StoredGroupState | null;
  auditEvents: AuditEvent[];
  commandOutcomes: StoredCommandOutcome[];
  joinOutcomes: StoredJoinOutcome[];
  invites: StoredInvite[];
};

export type GroupRepositoryInspection = {
  state: StoredGroupState | null;
  audit_events: AuditEvent[];
  command_outcomes: StoredCommandOutcome[];
  join_outcomes: StoredJoinOutcome[];
  invites: StoredInvite[];
};

export class MemoryGroupRepository implements GroupRepository {
  private data: MemoryGroupData;

  constructor(initial: GroupRepositoryInspection | null = null) {
    this.data = initial
      ? {
          state: clone(initial.state),
          auditEvents: clone(initial.audit_events),
          commandOutcomes: clone(initial.command_outcomes),
          joinOutcomes: clone(initial.join_outcomes),
          invites: clone(initial.invites),
        }
      : emptyMemoryData();
  }

  transaction<T>(operation: (persistence: GroupPersistence) => T): T {
    const working = new MemoryGroupPersistence(this.data);
    const result = operation(working);

    this.data = working.commit();

    return result;
  }

  inspect(): GroupRepositoryInspection {
    return {
      state: clone(this.data.state),
      audit_events: clone(this.data.auditEvents),
      command_outcomes: clone(this.data.commandOutcomes),
      join_outcomes: clone(this.data.joinOutcomes),
      invites: clone(this.data.invites),
    };
  }
}

class MemoryGroupPersistence implements GroupPersistence {
  private readonly data: MemoryGroupData;

  constructor(current: MemoryGroupData) {
    this.data = clone(current);
  }

  loadState(): StoredGroupState | null {
    return clone(this.data.state);
  }

  saveState(state: StoredGroupState): void {
    this.data.state = clone(state);
  }

  findCommandOutcome(commandId: string): StoredCommandOutcome | null {
    return (
      clone(
        this.data.commandOutcomes.find(
          (outcome) => outcome.command_id === commandId,
        ),
      ) ?? null
    );
  }

  recordCommandOutcome(outcome: StoredCommandOutcome): void {
    this.data.commandOutcomes.push(clone(outcome));
  }

  findJoinOutcome(joinId: string): StoredJoinOutcome | null {
    return (
      clone(
        this.data.joinOutcomes.find((outcome) => outcome.join_id === joinId),
      ) ?? null
    );
  }

  recordJoinOutcome(outcome: StoredJoinOutcome): void {
    this.data.joinOutcomes.push(clone(outcome));
  }

  findInvite(inviteId: string): StoredInvite | null {
    return clone(this.data.invites.find(({ id }) => id === inviteId)) ?? null;
  }

  findInviteByTokenHash(tokenHash: string): StoredInvite | null {
    return (
      clone(
        this.data.invites.find((invite) => invite.token_hash === tokenHash),
      ) ?? null
    );
  }

  recordInvite(invite: StoredInvite): void {
    this.data.invites.push(clone(invite));
  }

  retireInvite(inviteId: string, revokedAt: string): void {
    const invite = this.data.invites.find(({ id }) => id === inviteId);

    if (invite && invite.revoked_at === null) invite.revoked_at = revokedAt;
  }

  appendAudit(event: NewAuditEvent): AuditEvent {
    const stored = auditEventSchema.parse({
      sequence: this.data.auditEvents.length + 1,
      ...newAuditEventSchema.parse(clone(event)),
    });

    this.data.auditEvents.push(stored);

    return clone(stored);
  }

  readAudit(): AuditEvent[] {
    return clone(this.data.auditEvents);
  }

  commit(): MemoryGroupData {
    return clone(this.data);
  }
}

function emptyMemoryData(): MemoryGroupData {
  return {
    state: null,
    auditEvents: [],
    commandOutcomes: [],
    joinOutcomes: [],
    invites: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
