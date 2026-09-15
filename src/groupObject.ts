import { DurableObject } from 'cloudflare:workers';
import {
  createGroupInputSchema,
  type CreateGroupInput,
  type DeleteGroupInput,
  type Group,
  type GroupMutationResult,
  GroupState,
  type UpdateGroupInput,
} from './groupState';
import {
  type AccessCredential,
  type CreateMemberInput,
  type DeleteMemberInput,
  type Member,
  type MemberCreateResult,
  MemberDirectory,
  type MemberMutationResult,
  type MemberReadResult,
  type UpdateMemberInput,
} from './memberDirectory';

type ProbeRow = { ok: number };

type CreateGroupResult =
  | { ok: true; group: Group; member: Member; access_token: string }
  | { ok: false; error: 'group_exists' | 'invalid_request' };

/** Why a caller may not act on this group at all. */
type GroupRefusal = { ok: false; error: 'unauthorized' | 'group_deleted' };

type ResolvedGroup = { ok: true; group: Group } | GroupRefusal;

type MutateGroupResult = GroupMutationResult | GroupRefusal;

type CreateMemberResult = MemberCreateResult | GroupRefusal;

type ListMembersResult = { ok: true; members: Member[] } | GroupRefusal;

type GetMemberResult = MemberReadResult | GroupRefusal;

type MutateMemberResult = MemberMutationResult | GroupRefusal;

/**
 * Cloudflare's adapter for one group. It owns the named object identity,
 * transaction scope, authorization guard, and coordination between deep state
 * modules; persisted lifecycle rules stay inside those modules.
 */
export class GroupObject extends DurableObject<Env> {
  private readonly groupState: GroupState;
  private readonly members: MemberDirectory;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
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
  async getGroup(credential: AccessCredential): Promise<ResolvedGroup> {
    return this.actOnGroup(credential, (group): ResolvedGroup => ({
      ok: true,
      group,
    }));
  }

  async updateGroup(
    credential: AccessCredential,
    input: UpdateGroupInput,
  ): Promise<MutateGroupResult> {
    return this.actOnGroup(credential, (group): MutateGroupResult =>
      this.groupState.update(group, input),
    );
  }

  async deleteGroup(
    credential: AccessCredential,
    input: DeleteGroupInput,
  ): Promise<MutateGroupResult> {
    return this.actOnGroup(credential, (group): MutateGroupResult =>
      this.groupState.remove(group, input),
    );
  }

  async createMember(
    credential: AccessCredential,
    input: CreateMemberInput,
  ): Promise<CreateMemberResult> {
    return this.actOnGroup(credential, (): CreateMemberResult =>
      this.members.create(input),
    );
  }

  async listMembers(credential: AccessCredential): Promise<ListMembersResult> {
    return this.actOnGroup(credential, (): ListMembersResult => ({
      ok: true,
      members: this.members.listActive(),
    }));
  }

  async getMember(
    credential: AccessCredential,
    memberId: string,
  ): Promise<GetMemberResult> {
    return this.actOnGroup(credential, (): GetMemberResult =>
      this.members.retrieve(memberId),
    );
  }

  async updateMember(
    credential: AccessCredential,
    memberId: string,
    input: UpdateMemberInput,
  ): Promise<MutateMemberResult> {
    return this.actOnGroup(credential, (): MutateMemberResult =>
      this.members.rename(memberId, input),
    );
  }

  async deleteMember(
    credential: AccessCredential,
    memberId: string,
    input: DeleteMemberInput,
  ): Promise<MutateMemberResult> {
    return this.actOnGroup(credential, (): MutateMemberResult =>
      this.members.remove(memberId, input),
    );
  }

  /**
   * Prepares the credential before opening the synchronous SQLite transaction,
   * then resolves the live group every operation is allowed to see.
   */
  private async actOnGroup<T>(
    credential: AccessCredential,
    act: (group: Group) => T,
  ): Promise<T | GroupRefusal> {
    const prepared = await this.members.prepareAuthorization(credential);

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
