import type { AuditEventStore } from './domain/audit';
import type { CommandOutcome, MemberAlias } from './domain/commands';
import type { CreatedGroup } from './domain/groups';
import type { InviteRecord } from './domain/invites';
import type { GroupSnapshot } from './domain/sync';

export type StoredGroupCreation = {
  creator_identity_id: string;
  request: {
    group_id: string;
    name: string;
    creator_member_name: string;
    invite_id: string;
    invite_token_hash: string;
  };
  response: CreatedGroup;
};

export type StoredGroupState = {
  revision: number;
  next_actor_number: number;
  creation: StoredGroupCreation;
  snapshot: GroupSnapshot;
};

export type StoredCommandOutcome = {
  command_id: string;
  identity_id: string;
  command_json: string;
  outcome: CommandOutcome;
};

export type StoredJoinOutcome = {
  join_id: string;
  identity_id: string;
  request_json: string;
  response: {
    revision: number;
    snapshot: GroupSnapshot;
    access: GroupSnapshot['access_grants'][number];
  };
};

/** An invite as persisted: its hash, never its token. */
export type StoredInvite = InviteRecord & { token_hash: string };

export interface GroupPersistence extends AuditEventStore {
  loadState(): StoredGroupState | null;
  saveState(state: StoredGroupState): void;
  findCommandOutcome(commandId: string): StoredCommandOutcome | null;
  recordCommandOutcome(outcome: StoredCommandOutcome): void;
  findJoinOutcome(joinId: string): StoredJoinOutcome | null;
  recordJoinOutcome(outcome: StoredJoinOutcome): void;
  memberAliases(): Map<string, string>;
  recordMemberAlias(alias: MemberAlias): void;
  findInvite(inviteId: string): StoredInvite | null;
  findInviteByTokenHash(tokenHash: string): StoredInvite | null;
  recordInvite(invite: StoredInvite): void;
  retireInvite(inviteId: string, revokedAt: string): void;
}

export interface GroupRepository {
  transaction<T>(operation: (persistence: GroupPersistence) => T): T;
}

