import { v7 as uuidv7 } from 'uuid';
import {
  createdGroupSchema,
  type CreatedGroup,
  type GroupAccessGrant,
  type InitialGroupState,
} from './domain/groups';
import {
  type RedeemGroupLinkCommand,
  type RotateGroupLinkCommand,
} from './domain/invites';
import {
  decideMemberArchive,
  decideMemberCreation,
  decideMemberRename,
  memberNameKey,
  type ArchiveMemberCommand,
  type CreateMemberCommand,
  type LedgerMember,
  type MemberCommand,
  type RenameMemberCommand,
} from './domain/members';
import {
  commandOutcomeSchema,
  type CommandOutcome,
  type GroupSnapshot,
  type SyncGroupCommand,
  type SyncGroupResponse,
} from './domain/sync';

type StoredCreation = {
  group_id: string;
  creator_identity_id: string;
  request_name: string;
  currency_code: string;
  creator_member_name: string;
  outcome_json: string;
};

type StoredGroup = {
  id: string;
  name: string;
  currency_code: string;
  created_at: string;
  current_revision: number;
};

type StoredMember = {
  id: string;
  display_name: string;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
};

type StoredActor = {
  identity_id: string;
  actor_number: number;
  preferred_member_id: string | null;
  actor_member_name: string | null;
};

type StoredAccessGrant = {
  identity_id: string;
  actor_number: number;
  preferred_member_id: string | null;
  granted_at: string;
  hidden_at: string | null;
};

type StoredCommandOutcome = {
  identity_id: string;
  command_json: string;
  outcome_json: string;
};

type StoredInvite = {
  id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  use_count: number;
  last_used_at: string | null;
};

type JoiningMemberResult =
  | { ok: true; member: LedgerMember; created: boolean }
  | {
      ok: false;
      error:
        | 'member_not_found'
        | 'member_archived'
        | 'member_name_taken'
        | 'member_id_exists';
    };

type AuditInput = {
  revision: number;
  action: string;
  actor: StoredActor;
  targetKind: string;
  targetId: string;
  occurredAt: string;
  before: unknown;
  after: unknown;
};

export type CreateStoredGroupResult =
  | { ok: true; created: CreatedGroup }
  | { ok: false; error: 'group_exists' | 'idempotency_conflict' };

export type SyncStoredGroupResult =
  | { ok: true; response: SyncGroupResponse }
  | { ok: false; error: 'unauthorized' };

export type RotateGroupLinkResult =
  | {
      ok: true;
      revision: number;
      snapshot: GroupSnapshot;
      invite: { id: string; created_at: string; expires_at: string };
    }
  | { ok: false; error: 'unauthorized' };

export type RedeemGroupLinkResult =
  | {
      ok: true;
      revision: number;
      snapshot: GroupSnapshot;
      access: GroupAccessGrant;
    }
  | {
      ok: false;
      error:
        | 'invalid_invite'
        | 'member_not_found'
        | 'member_archived'
        | 'member_name_taken'
        | 'member_id_exists';
    };

export class GroupStore {
  constructor(private readonly storage: DurableObjectStorage) {
    this.initializeSchema();
  }

  create(initial: InitialGroupState): CreateStoredGroupResult {
    return this.storage.transactionSync(() => {
      const existing = this.readCreation();

      if (existing) return this.resolveRetry(existing, initial.view);

      this.insert(initial);

      return { ok: true, created: initial.view };
    });
  }

  sync(command: SyncGroupCommand, appliedAt: string): SyncStoredGroupResult {
    if (!this.isInitialized()) return { ok: false, error: 'unauthorized' };

    return this.storage.transactionSync(() => {
      const actor = this.readActor(command.identity_id);

      if (!actor) return { ok: false, error: 'unauthorized' };

      const outcomes = command.commands.map((groupCommand) =>
        this.processCommand(groupCommand, actor, appliedAt),
      );

      const group = this.readGroup();

      if (!group) throw new Error('group_state_missing');

      const state =
        command.commands.length > 0 ||
        command.known_revision !== group.current_revision
          ? { kind: 'snapshot' as const, snapshot: this.readSnapshot(group) }
          : { kind: 'unchanged' as const };

      return {
        ok: true,
        response: {
          revision: group.current_revision,
          outcomes,
          state,
        },
      };
    });
  }

  rotateGroupLink(command: RotateGroupLinkCommand): RotateGroupLinkResult {
    if (!this.isInitialized()) return { ok: false, error: 'unauthorized' };

    return this.storage.transactionSync(() => {
      const actor = this.readActor(command.identity_id);

      if (!actor) return { ok: false, error: 'unauthorized' };

      const group = this.readGroup();

      if (!group) throw new Error('group_state_missing');

      const previous = this.readCurrentInvite();
      const revision = group.current_revision + 1;

      this.storage.sql.exec(
        `UPDATE group_invites
         SET revoked_at = ?
         WHERE revoked_at IS NULL`,
        command.created_at,
      );
      this.storage.sql.exec(
        `INSERT INTO group_invites
          (id, token_hash, created_by_identity_id, created_at, expires_at,
           revoked_at, use_count, last_used_at)
         VALUES (?, ?, ?, ?, ?, NULL, 0, NULL)`,
        command.invite_id,
        command.token_hash,
        command.identity_id,
        command.created_at,
        command.expires_at,
      );
      this.insertAudit({
        revision,
        action: 'invite.rotated',
        actor,
        targetKind: 'invite',
        targetId: command.invite_id,
        occurredAt: command.created_at,
        before: previous,
        after: {
          id: command.invite_id,
          created_at: command.created_at,
          expires_at: command.expires_at,
        },
      });
      this.updateRevision(revision);

      return {
        ok: true,
        revision,
        snapshot: this.readSnapshot({ ...group, current_revision: revision }),
        invite: {
          id: command.invite_id,
          created_at: command.created_at,
          expires_at: command.expires_at,
        },
      };
    });
  }

  redeemGroupLink(command: RedeemGroupLinkCommand): RedeemGroupLinkResult {
    if (!this.isInitialized()) return { ok: false, error: 'invalid_invite' };

    return this.storage.transactionSync(() => {
      const group = this.readGroup();

      if (!group) return { ok: false, error: 'invalid_invite' };

      const existingAccess = this.readAccessGrant(command.identity_id);

      if (existingAccess) {
        return {
          ok: true,
          revision: group.current_revision,
          snapshot: this.readSnapshot(group),
          access: existingAccess,
        };
      }

      const invite = this.readInviteByHash(command.token_hash);

      if (
        !invite ||
        invite.revoked_at !== null ||
        invite.expires_at <= command.joined_at
      ) {
        return { ok: false, error: 'invalid_invite' };
      }

      const members = this.readMembers();

      const memberResult = this.resolveJoiningMember(
        command,
        members,
        command.joined_at,
      );

      if (!memberResult.ok) return memberResult;

      const actorNumber = this.nextActorNumber();
      const revision = group.current_revision + 1;

      if (memberResult.created) {
        const member = memberResult.member;

        this.storage.sql.exec(
          `INSERT INTO members
            (id, display_name, name_key, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)`,
          member.id,
          member.display_name,
          memberNameKey(member.display_name),
          member.created_at,
          member.updated_at,
        );
      }

      this.storage.sql.exec(
        `INSERT INTO group_access_grants
          (identity_id, actor_number, preferred_member_id, granted_at, hidden_at)
         VALUES (?, ?, ?, ?, NULL)`,
        command.identity_id,
        actorNumber,
        memberResult.member.id,
        command.joined_at,
      );
      this.storage.sql.exec(
        `UPDATE group_invites
         SET use_count = use_count + 1, last_used_at = ?
         WHERE id = ?`,
        command.joined_at,
        invite.id,
      );

      const actor: StoredActor = {
        identity_id: command.identity_id,
        actor_number: actorNumber,
        preferred_member_id: memberResult.member.id,
        actor_member_name: memberResult.member.display_name,
      };

      const access = this.mapAccessGrant({
        identity_id: command.identity_id,
        actor_number: actorNumber,
        preferred_member_id: memberResult.member.id,
        granted_at: command.joined_at,
        hidden_at: null,
      });

      this.insertAudit({
        revision,
        action: 'group.joined',
        actor,
        targetKind: 'access',
        targetId: command.identity_id,
        occurredAt: command.joined_at,
        before: null,
        after: {
          access,
          created_member: memberResult.created ? memberResult.member : null,
          invite_id: invite.id,
        },
      });
      this.updateRevision(revision);

      return {
        ok: true,
        revision,
        snapshot: this.readSnapshot({ ...group, current_revision: revision }),
        access,
      };
    });
  }

  private initializeSchema(): void {
    const { sql } = this.storage;

    sql.exec('PRAGMA foreign_keys = ON');
    sql.exec(`CREATE TABLE IF NOT EXISTS group_creation (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      group_id TEXT NOT NULL UNIQUE,
      creator_identity_id TEXT NOT NULL,
      request_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      creator_member_name TEXT NOT NULL,
      outcome_json TEXT NOT NULL CHECK (json_valid(outcome_json))
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS group_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      created_at TEXT NOT NULL,
      current_revision INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS active_member_name_keys
      ON members (name_key)
      WHERE status = 'active'`);
    sql.exec(`CREATE TABLE IF NOT EXISTS group_access_grants (
      identity_id TEXT PRIMARY KEY,
      actor_number INTEGER NOT NULL UNIQUE,
      preferred_member_id TEXT REFERENCES members(id),
      granted_at TEXT NOT NULL,
      hidden_at TEXT
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS group_invites (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      created_by_identity_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      use_count INTEGER NOT NULL,
      last_used_at TEXT
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS audit_events (
      sequence INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      revision INTEGER NOT NULL,
      action TEXT NOT NULL,
      command_id TEXT UNIQUE,
      actor_identity_id TEXT NOT NULL,
      actor_number INTEGER NOT NULL,
      actor_member_name TEXT,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
      after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json))
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS command_outcomes (
      command_id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      command_json TEXT NOT NULL CHECK (json_valid(command_json)),
      outcome_json TEXT NOT NULL CHECK (json_valid(outcome_json)),
      recorded_at TEXT NOT NULL
    )`);
  }

  private isInitialized(): boolean {
    const row = this.storage.sql
      .exec<{ available: number }>(
        'SELECT 1 AS available FROM group_state WHERE singleton = 1',
      )
      .toArray()[0];

    return row?.available === 1;
  }

  private readActor(identityId: string): StoredActor | null {
    return (
      this.storage.sql
        .exec<StoredActor>(
          `SELECT
             access.identity_id,
             access.actor_number,
             access.preferred_member_id,
             members.display_name AS actor_member_name
           FROM group_access_grants AS access
           LEFT JOIN members ON members.id = access.preferred_member_id
           WHERE access.identity_id = ?`,
          identityId,
        )
        .toArray()[0] ?? null
    );
  }

  private readGroup(): StoredGroup | null {
    return (
      this.storage.sql
        .exec<StoredGroup>(
          `SELECT id, name, currency_code, created_at, current_revision
           FROM group_state
           WHERE singleton = 1`,
        )
        .toArray()[0] ?? null
    );
  }

  private readMembers(): LedgerMember[] {
    return this.storage.sql
      .exec<StoredMember>(
        `SELECT id, display_name, status, created_at, updated_at
         FROM members
         ORDER BY created_at, id`,
      )
      .toArray();
  }

  private readCurrentInvite(): StoredInvite | null {
    return (
      this.storage.sql
        .exec<StoredInvite>(
          `SELECT id, token_hash, created_at, expires_at, revoked_at, use_count,
                  last_used_at
           FROM group_invites
           WHERE revoked_at IS NULL
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .toArray()[0] ?? null
    );
  }

  private readInviteByHash(tokenHash: string): StoredInvite | null {
    return (
      this.storage.sql
        .exec<StoredInvite>(
          `SELECT id, token_hash, created_at, expires_at, revoked_at, use_count,
                  last_used_at
           FROM group_invites
           WHERE token_hash = ?`,
          tokenHash,
        )
        .toArray()[0] ?? null
    );
  }

  private readAccessGrant(identityId: string): GroupAccessGrant | null {
    const stored = this.storage.sql
      .exec<StoredAccessGrant>(
        `SELECT identity_id, actor_number, preferred_member_id, granted_at,
                hidden_at
         FROM group_access_grants
         WHERE identity_id = ?`,
        identityId,
      )
      .toArray()[0];

    return stored ? this.mapAccessGrant(stored) : null;
  }

  private resolveJoiningMember(
    command: RedeemGroupLinkCommand,
    members: readonly LedgerMember[],
    joinedAt: string,
  ): JoiningMemberResult {
    const choice = command.preferred_member;

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

  private nextActorNumber(): number {
    return this.storage.sql
      .exec<{ next_number: number }>(
        `SELECT COALESCE(MAX(actor_number), 0) + 1 AS next_number
         FROM group_access_grants`,
      )
      .one().next_number;
  }

  private mapAccessGrant(stored: StoredAccessGrant): GroupAccessGrant {
    return {
      identity_id: stored.identity_id,
      actor_handle: `User ${stored.actor_number}`,
      preferred_member_id: stored.preferred_member_id,
      granted_at: stored.granted_at,
      hidden_at: stored.hidden_at,
    };
  }

  private insertAudit(input: AuditInput): void {
    this.storage.sql.exec(
      `INSERT INTO audit_events
        (sequence, id, revision, action, command_id, actor_identity_id,
         actor_number, actor_member_name, target_kind, target_id, occurred_at,
         before_json, after_json)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      this.nextAuditSequence(),
      uuidv7(),
      input.revision,
      input.action,
      input.actor.identity_id,
      input.actor.actor_number,
      input.actor.actor_member_name,
      input.targetKind,
      input.targetId,
      input.occurredAt,
      input.before === null ? null : JSON.stringify(input.before),
      input.after === null ? null : JSON.stringify(input.after),
    );
  }

  private updateRevision(revision: number): void {
    this.storage.sql.exec(
      'UPDATE group_state SET current_revision = ? WHERE singleton = 1',
      revision,
    );
  }

  private processCommand(
    command: MemberCommand,
    actor: StoredActor,
    appliedAt: string,
  ): CommandOutcome {
    const commandJson = JSON.stringify(command);
    const stored = this.readCommandOutcome(command.command_id);

    if (stored) {
      if (
        stored.identity_id === actor.identity_id &&
        stored.command_json === commandJson
      ) {
        return commandOutcomeSchema.parse(JSON.parse(stored.outcome_json));
      }

      return this.idempotencyConflict(command);
    }

    let outcome: CommandOutcome;

    switch (command.type) {
      case 'member.create':
        outcome = this.processMemberCreation(command, actor, appliedAt);
        break;
      case 'member.rename':
        outcome = this.processMemberRename(command, actor, appliedAt);
        break;
      case 'member.archive':
        outcome = this.processMemberArchive(command, actor, appliedAt);
        break;
    }

    this.storeCommandOutcome(command, actor.identity_id, outcome, appliedAt);

    return outcome;
  }

  private processMemberCreation(
    command: CreateMemberCommand,
    actor: StoredActor,
    appliedAt: string,
  ): CommandOutcome {
    const decision = decideMemberCreation(
      command,
      this.readMembers(),
      appliedAt,
    );

    if (decision.kind === 'apply') {
      return this.applyMemberCreation(
        command,
        decision.member,
        actor,
        appliedAt,
      );
    }

    return {
      command_id: command.command_id,
      command_type: command.type,
      status: decision.kind === 'supersede' ? 'superseded' : 'rejected',
      reason: decision.reason,
      audit_id: null,
      target: { kind: 'member', id: command.payload.member_id },
      server_state: { kind: 'member', member: decision.current },
    };
  }

  private processMemberRename(
    command: RenameMemberCommand,
    actor: StoredActor,
    appliedAt: string,
  ): CommandOutcome {
    const decision = decideMemberRename(command, this.readMembers(), appliedAt);

    if (decision.kind === 'apply') {
      return this.applyMemberRename(
        command,
        decision.before,
        decision.member,
        actor,
        appliedAt,
      );
    }

    return {
      command_id: command.command_id,
      command_type: command.type,
      status:
        decision.kind === 'no_effect'
          ? 'no_effect'
          : decision.kind === 'supersede'
            ? 'superseded'
            : 'rejected',
      reason: decision.kind === 'no_effect' ? null : decision.reason,
      audit_id: null,
      target: { kind: 'member', id: command.payload.member_id },
      server_state: decision.current
        ? { kind: 'member', member: decision.current }
        : null,
    };
  }

  private processMemberArchive(
    command: ArchiveMemberCommand,
    actor: StoredActor,
    appliedAt: string,
  ): CommandOutcome {
    const decision = decideMemberArchive(
      command,
      this.readMembers(),
      this.readAccessGrants(),
      appliedAt,
    );

    if (decision.kind === 'apply') {
      return this.applyMemberArchive(
        command,
        decision.before,
        decision.member,
        decision.orphaned_identity_ids,
        actor,
        appliedAt,
      );
    }

    return {
      command_id: command.command_id,
      command_type: command.type,
      status: decision.kind === 'no_effect' ? 'no_effect' : 'rejected',
      reason: decision.kind === 'no_effect' ? null : decision.reason,
      audit_id: null,
      target: { kind: 'member', id: command.payload.member_id },
      server_state: decision.current
        ? { kind: 'member', member: decision.current }
        : null,
    };
  }

  private applyMemberArchive(
    command: ArchiveMemberCommand,
    before: LedgerMember,
    member: LedgerMember,
    orphanedIdentityIds: string[],
    actor: StoredActor,
    appliedAt: string,
  ): CommandOutcome {
    const group = this.readGroup();

    if (!group) throw new Error('group_state_missing');

    const revision = group.current_revision + 1;
    const auditId = uuidv7();

    this.storage.sql.exec(
      `UPDATE members
       SET status = 'archived', updated_at = ?
       WHERE id = ?`,
      member.updated_at,
      member.id,
    );
    this.storage.sql.exec(
      `UPDATE group_access_grants
       SET preferred_member_id = NULL
       WHERE preferred_member_id = ?`,
      member.id,
    );
    this.storage.sql.exec(
      `INSERT INTO audit_events
        (sequence, id, revision, action, command_id, actor_identity_id,
         actor_number, actor_member_name, target_kind, target_id, occurred_at,
         before_json, after_json)
       VALUES (?, ?, ?, 'member.archived', ?, ?, ?, ?, 'member', ?, ?, ?, ?)`,
      this.nextAuditSequence(),
      auditId,
      revision,
      command.command_id,
      actor.identity_id,
      actor.actor_number,
      actor.actor_member_name,
      member.id,
      appliedAt,
      JSON.stringify({ member: before, preferred_by: orphanedIdentityIds }),
      JSON.stringify({ member, preferred_by: [] }),
    );
    this.updateRevision(revision);

    return {
      command_id: command.command_id,
      command_type: command.type,
      status: 'applied',
      reason: null,
      audit_id: auditId,
      target: { kind: 'member', id: member.id },
      server_state: { kind: 'member', member },
    };
  }

  private applyMemberRename(
    command: RenameMemberCommand,
    before: LedgerMember,
    member: LedgerMember,
    actor: StoredActor,
    appliedAt: string,
  ): CommandOutcome {
    const group = this.readGroup();

    if (!group) throw new Error('group_state_missing');

    const revision = group.current_revision + 1;
    const auditId = uuidv7();

    this.storage.sql.exec(
      `UPDATE members
       SET display_name = ?, name_key = ?, updated_at = ?
       WHERE id = ?`,
      member.display_name,
      memberNameKey(member.display_name),
      member.updated_at,
      member.id,
    );
    this.storage.sql.exec(
      `INSERT INTO audit_events
        (sequence, id, revision, action, command_id, actor_identity_id,
         actor_number, actor_member_name, target_kind, target_id, occurred_at,
         before_json, after_json)
       VALUES (?, ?, ?, 'member.renamed', ?, ?, ?, ?, 'member', ?, ?, ?, ?)`,
      this.nextAuditSequence(),
      auditId,
      revision,
      command.command_id,
      actor.identity_id,
      actor.actor_number,
      actor.actor_member_name,
      member.id,
      appliedAt,
      JSON.stringify(before),
      JSON.stringify(member),
    );
    this.storage.sql.exec(
      'UPDATE group_state SET current_revision = ? WHERE singleton = 1',
      revision,
    );

    return {
      command_id: command.command_id,
      command_type: command.type,
      status: 'applied',
      reason: null,
      audit_id: auditId,
      target: { kind: 'member', id: member.id },
      server_state: { kind: 'member', member },
    };
  }

  private applyMemberCreation(
    command: CreateMemberCommand,
    member: LedgerMember,
    actor: StoredActor,
    appliedAt: string,
  ): CommandOutcome {
    const group = this.readGroup();

    if (!group) throw new Error('group_state_missing');

    const revision = group.current_revision + 1;
    const auditId = uuidv7();

    this.storage.sql.exec(
      `INSERT INTO members
        (id, display_name, name_key, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      member.id,
      member.display_name,
      memberNameKey(member.display_name),
      member.status,
      member.created_at,
      member.updated_at,
    );
    this.storage.sql.exec(
      `INSERT INTO audit_events
        (sequence, id, revision, action, command_id, actor_identity_id,
         actor_number, actor_member_name, target_kind, target_id, occurred_at,
         before_json, after_json)
       VALUES (?, ?, ?, 'member.created', ?, ?, ?, ?, 'member', ?, ?, NULL, ?)`,
      this.nextAuditSequence(),
      auditId,
      revision,
      command.command_id,
      actor.identity_id,
      actor.actor_number,
      actor.actor_member_name,
      member.id,
      appliedAt,
      JSON.stringify(member),
    );
    this.storage.sql.exec(
      'UPDATE group_state SET current_revision = ? WHERE singleton = 1',
      revision,
    );

    return {
      command_id: command.command_id,
      command_type: command.type,
      status: 'applied',
      reason: null,
      audit_id: auditId,
      target: { kind: 'member', id: member.id },
      server_state: { kind: 'member', member },
    };
  }

  private nextAuditSequence(): number {
    const row = this.storage.sql
      .exec<{ next_sequence: number }>(
        'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM audit_events',
      )
      .one();

    return row.next_sequence;
  }

  private readCommandOutcome(commandId: string): StoredCommandOutcome | null {
    return (
      this.storage.sql
        .exec<StoredCommandOutcome>(
          `SELECT identity_id, command_json, outcome_json
           FROM command_outcomes
           WHERE command_id = ?`,
          commandId,
        )
        .toArray()[0] ?? null
    );
  }

  private storeCommandOutcome(
    command: MemberCommand,
    identityId: string,
    outcome: CommandOutcome,
    recordedAt: string,
  ): void {
    this.storage.sql.exec(
      `INSERT INTO command_outcomes
        (command_id, identity_id, command_type, command_json, outcome_json,
         recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      command.command_id,
      identityId,
      command.type,
      JSON.stringify(command),
      JSON.stringify(outcome),
      recordedAt,
    );
  }

  private idempotencyConflict(command: MemberCommand): CommandOutcome {
    return {
      command_id: command.command_id,
      command_type: command.type,
      status: 'rejected',
      reason: 'idempotency_conflict',
      audit_id: null,
      target: { kind: 'member', id: command.payload.member_id },
      server_state: null,
    };
  }

  private readSnapshot(group: StoredGroup): GroupSnapshot {
    return {
      group: {
        id: group.id,
        name: group.name,
        currency_code: group.currency_code,
        created_at: group.created_at,
      },
      members: this.readMembers(),
      access_grants: this.readAccessGrants(),
    };
  }

  private readAccessGrants(): GroupAccessGrant[] {
    return this.storage.sql
      .exec<StoredAccessGrant>(
        `SELECT identity_id, actor_number, preferred_member_id, granted_at,
                hidden_at
         FROM group_access_grants
         ORDER BY actor_number`,
      )
      .toArray()
      .map((grant) => this.mapAccessGrant(grant));
  }

  private insert(initial: InitialGroupState): void {
    const { group, member, access } = initial.view;
    const { audit } = initial;
    const { sql } = this.storage;

    sql.exec(
      `INSERT INTO group_state
        (singleton, id, name, currency_code, created_at, current_revision)
       VALUES (1, ?, ?, ?, ?, ?)`,
      group.id,
      group.name,
      group.currency_code,
      group.created_at,
      group.revision,
    );
    sql.exec(
      `INSERT INTO members
        (id, display_name, name_key, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      member.id,
      member.display_name,
      memberNameKey(member.display_name),
      member.status,
      member.created_at,
      member.updated_at,
    );
    sql.exec(
      `INSERT INTO group_access_grants
        (identity_id, actor_number, preferred_member_id, granted_at, hidden_at)
       VALUES (?, ?, ?, ?, NULL)`,
      access.identity_id,
      audit.actor_number,
      access.preferred_member_id,
      access.granted_at,
    );
    sql.exec(
      `INSERT INTO audit_events
        (sequence, id, revision, action, command_id, actor_identity_id,
         actor_number, actor_member_name, target_kind, target_id, occurred_at,
         before_json, after_json)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'group', ?, ?, NULL, ?)`,
      audit.sequence,
      uuidv7(),
      audit.revision,
      audit.action,
      audit.actor_identity_id,
      audit.actor_number,
      audit.actor_member_name,
      audit.target_id,
      audit.occurred_at,
      JSON.stringify(initial.view),
    );
    sql.exec(
      `INSERT INTO group_creation
        (singleton, group_id, creator_identity_id, request_name, currency_code,
         creator_member_name, outcome_json)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
      group.id,
      access.identity_id,
      group.name,
      group.currency_code,
      member.display_name,
      JSON.stringify(initial.view),
    );
  }

  private readCreation(): StoredCreation | null {
    return (
      this.storage.sql
        .exec<StoredCreation>(
          `SELECT
             group_id,
             creator_identity_id,
             request_name,
             currency_code,
             creator_member_name,
             outcome_json
           FROM group_creation
           WHERE singleton = 1`,
        )
        .toArray()[0] ?? null
    );
  }

  private resolveRetry(
    stored: StoredCreation,
    requested: CreatedGroup,
  ): CreateStoredGroupResult {
    if (stored.creator_identity_id !== requested.access.identity_id) {
      return { ok: false, error: 'group_exists' };
    }

    const sameInput =
      stored.group_id === requested.group.id &&
      stored.request_name === requested.group.name &&
      stored.currency_code === requested.group.currency_code &&
      stored.creator_member_name === requested.member.display_name;

    if (!sameInput) return { ok: false, error: 'idempotency_conflict' };

    return {
      ok: true,
      created: createdGroupSchema.parse(JSON.parse(stored.outcome_json)),
    };
  }
}
