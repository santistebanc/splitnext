import type { GroupCommand } from '../domain/commands';
import type { JoinGroupRequest } from '../domain/access';
import type { CreateGroupRequest } from '../domain/groups';
import type { IdentitySession } from '../domain/identities';
import type { CommandOutcome, GroupSnapshot } from '../domain/sync';

export type PendingCommand = {
  command: GroupCommand;
  queued_at: string;
};

export type ClientNotice = {
  command: GroupCommand;
  outcome: CommandOutcome;
  recorded_at: string;
};

export type ClientGroupReplica = {
  group_id: string;
  revision: number;
  snapshot: GroupSnapshot;
  outbox: PendingCommand[];
  notices: ClientNotice[];
  last_synced_at: string | null;
};

export type PendingJoin = {
  group_id: string;
  request: JoinGroupRequest;
};

export type PendingGroupCreation = {
  request: CreateGroupRequest;
};

export type ClientStorageDocument = {
  schema_version: 1;
  session: IdentitySession | null;
  groups: ClientGroupReplica[];
  pending_group_creations: PendingGroupCreation[];
  pending_joins: PendingJoin[];
};

export interface ClientStorageAdapter {
  load(): Promise<ClientStorageDocument | null>;
  save(document: ClientStorageDocument): Promise<void>;
}

export class MemoryClientStorage implements ClientStorageAdapter {
  private document: ClientStorageDocument | null = null;

  async load(): Promise<ClientStorageDocument | null> {
    return clone(this.document);
  }

  async save(document: ClientStorageDocument): Promise<void> {
    this.document = clone(document);
  }
}

export type StringStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export class JsonClientStorage implements ClientStorageAdapter {
  constructor(
    private readonly storage: StringStorage,
    private readonly key: string,
  ) {}

  async load(): Promise<ClientStorageDocument | null> {
    const value = this.storage.getItem(this.key);

    if (!value) return null;

    // SAFETY: Only save() writes this namespaced value. Runtime contract
    // validation can be added to a production adapter without changing callers.
    return JSON.parse(value) as ClientStorageDocument;
  }

  async save(document: ClientStorageDocument): Promise<void> {
    this.storage.setItem(this.key, JSON.stringify(document));
  }
}

export function emptyClientDocument(): ClientStorageDocument {
  return {
    schema_version: 1,
    session: null,
    groups: [],
    pending_group_creations: [],
    pending_joins: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
