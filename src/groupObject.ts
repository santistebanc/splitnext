import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import {
  createGroupInputSchema,
  type CreateGroupInput,
  deleteGroupInputSchema,
  type DeleteGroupInput,
  type Group,
  type GroupMutationResult,
  GroupState,
  updateGroupInputSchema,
  type UpdateGroupInput,
} from './groupState';
import { type AccessCredential } from './accessCredential';
import { GroupDatabase } from './groupDatabase';
import {
  createMemberInputSchema,
  type CreateMemberInput,
  deleteMemberInputSchema,
  type DeleteMemberInput,
  type Member,
  MemberDirectory,
  type MemberMutationResult,
  type MemberReadResult,
  updateMemberInputSchema,
  type UpdateMemberInput,
} from './memberDirectory';

type ProbeRow = { ok: number };

/** Why a caller may not act on this group at all. */
type GroupRefusal = { ok: false; error: 'unauthorized' | 'group_deleted' };

/** A command that did not survive the seam it was sent across. */
type InvalidCommand = { ok: false; error: 'invalid_request' };

/**
 * An outcome an authorized operation can produce. Naming the guard once means
 * a new operation adds a method, not a result type.
 */
type Guarded<T> = T | GroupRefusal;

/** The same, for operations that carry a command this seam must validate. */
type Commanded<T> = Guarded<T> | InvalidCommand;

type GroupFound = { ok: true; group: Group };

type MemberFound = { ok: true; member: Member };

type CreateGroupResult =
  | { ok: true; group: Group; member: Member; access_token: string }
  | { ok: false; error: 'group_exists' }
  | InvalidCommand;

/**
 * Cloudflare's adapter for one group. It owns the named object identity,
 * transaction scope, authorization guard, and coordination between deep state
 * modules; persisted lifecycle rules stay inside those modules.
 */
export class GroupObject extends DurableObject<Env> {
  private readonly database: GroupDatabase;
  private readonly groupState: GroupState;
  private readonly members: MemberDirectory;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.database = new GroupDatabase(ctx.storage);
    this.groupState = new GroupState(ctx.storage.sql);
    this.members = new MemberDirectory(ctx.storage.sql);
  }

  async health(): Promise<boolean> {
    return this.isStorageReachable();
  }

  async createGroup(rawInput: CreateGroupInput): Promise<CreateGroupResult> {
    const parsed = createGroupInputSchema.safeParse(rawInput);

    if (!parsed.success) return { ok: false, error: 'invalid_request' };

    const input = parsed.data;
    const groupId = this.ctx.id.name;

    if (!groupId) throw new Error('named_group_object_required');

    const preparedCreator = await this.members.prepareMemberWithAccess({
      display_name: input.creator_display_name,
      device_user_id: input.device_user_id,
    });

    this.database.createForNewGroup();

    return this.ctx.storage.transactionSync((): CreateGroupResult => {
      const storedGroup = this.groupState.create(groupId, input);

      if (!storedGroup.ok) return storedGroup;

      const creator = this.members.createWithAccess(preparedCreator);

      return {
        ok: true,
        group: storedGroup.group,
        member: creator.member,
        access_token: creator.access_token,
      };
    });
  }

  /**
   * A caller without a valid capability is told only that it is unauthorized.
   * Whether the group exists is itself privileged, so an unknown group and a
   * wrong token are deliberately indistinguishable.
   */
  async getGroup(credential: AccessCredential): Promise<Guarded<GroupFound>> {
    return this.actOnGroup(credential, (group): GroupFound => ({
      ok: true,
      group,
    }));
  }

  async updateGroup(
    credential: AccessCredential,
    input: UpdateGroupInput,
  ): Promise<Commanded<GroupMutationResult>> {
    return this.onCommand(updateGroupInputSchema, input, (command) =>
      this.actOnGroup(credential, (group) =>
        this.groupState.update(group, command),
      ),
    );
  }

  async deleteGroup(
    credential: AccessCredential,
    input: DeleteGroupInput,
  ): Promise<Commanded<GroupMutationResult>> {
    return this.onCommand(deleteGroupInputSchema, input, (command) =>
      this.actOnGroup(credential, (group) =>
        this.groupState.remove(group, command),
      ),
    );
  }

  async createMember(
    credential: AccessCredential,
    input: CreateMemberInput,
  ): Promise<Commanded<MemberFound>> {
    return this.onCommand(createMemberInputSchema, input, (command) =>
      this.actOnGroup(credential, (): MemberFound => ({
        ok: true,
        member: this.members.create(command),
      })),
    );
  }

  async listMembers(
    credential: AccessCredential,
  ): Promise<Guarded<{ ok: true; members: Member[] }>> {
    return this.actOnGroup(credential, () => ({
      ok: true as const,
      members: this.members.listActive(),
    }));
  }

  async getMember(
    credential: AccessCredential,
    memberId: string,
  ): Promise<Guarded<MemberReadResult>> {
    return this.actOnGroup(credential, () => this.members.retrieve(memberId));
  }

  async updateMember(
    credential: AccessCredential,
    memberId: string,
    input: UpdateMemberInput,
  ): Promise<Commanded<MemberMutationResult>> {
    return this.onCommand(updateMemberInputSchema, input, (command) =>
      this.actOnGroup(credential, () => this.members.rename(memberId, command)),
    );
  }

  async deleteMember(
    credential: AccessCredential,
    memberId: string,
    input: DeleteMemberInput,
  ): Promise<Commanded<MemberMutationResult>> {
    return this.onCommand(deleteMemberInputSchema, input, (command) =>
      this.actOnGroup(credential, () => this.members.remove(memberId, command)),
    );
  }

  /**
   * Commands are validated here and nowhere else. This is the seam a command
   * crosses, so the state modules behind it receive shapes they can trust.
   */
  private async onCommand<Command, T>(
    schema: z.ZodType<Command, Command>,
    input: Command,
    act: (command: Command) => Promise<T>,
  ): Promise<T | InvalidCommand> {
    const parsed = schema.safeParse(input);

    if (!parsed.success) return { ok: false, error: 'invalid_request' };

    return act(parsed.data);
  }

  /**
   * Prepares the credential before opening the synchronous SQLite transaction,
   * then resolves the live group every operation is allowed to see.
   */
  private async actOnGroup<T>(
    credential: AccessCredential,
    act: (group: Group) => T,
  ): Promise<T | GroupRefusal> {
    // Hash first, unconditionally. An unknown group and a wrong capability are
    // meant to be indistinguishable, so they must also cost the same.
    const prepared = await this.members.prepareAuthorization(credential);

    // The module that owns the schema is the one that knows whether there is
    // one. Nothing below this line has to ask again.
    if (!this.database.prepareExistingGroup()) {
      return { ok: false, error: 'unauthorized' };
    }

    return this.ctx.storage.transactionSync((): T | GroupRefusal => {
      const principal = this.members.authenticate(prepared);

      if (!principal) return { ok: false, error: 'unauthorized' };

      const group = this.groupState.retrieve();

      // A live capability without group state breaks the invariant that both
      // are written in one transaction, so it is a fault, not a refusal.
      if (!group) throw new Error('group_state_missing');

      if (group.deleted_at !== null) {
        return { ok: false, error: 'group_deleted' };
      }

      return act(group);
    });
  }

  /**
   * Readiness is reachability and nothing more. The probe addresses a sentinel
   * object that is never created, so it has no schema to be stale about.
   */
  private isStorageReachable(): boolean {
    const probe = this.ctx.storage.sql.exec<ProbeRow>('SELECT 1 AS ok').toArray()[0];

    return probe?.ok === 1;
  }
}
