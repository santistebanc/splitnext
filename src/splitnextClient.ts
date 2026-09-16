import { hc } from 'hono/client';
import type { AccessCredential } from './accessCredential';
import type app from './app';
import type {
  CreateGroupInput,
  DeleteGroupInput,
  UpdateGroupInput,
} from './groupState';
import type {
  CreateGroupInviteInput,
  InviteContextInput,
  RedeemGroupInviteInput,
} from './inviteDirectory';
import type {
  CreateMemberInput,
  DeleteMemberInput,
  UpdateMemberInput,
} from './memberDirectory';

export type SplitnextFetch = typeof globalThis.fetch;

type RpcClient = ReturnType<typeof hc<typeof app>>;

/**
 * The typed way to call this API over HTTP, with the transport contract
 * inferred from the routes rather than restated. The test suite drives the
 * Worker through it, so the shape a consumer would use is the shape under test.
 */
export class SplitnextClient {
  private readonly rpc: RpcClient;

  constructor(
    baseUrl: string,
    fetcher: SplitnextFetch = globalThis.fetch,
  ) {
    this.rpc = hc<typeof app>(baseUrl, { fetch: fetcher });
  }

  createGroup(input: CreateGroupInput) {
    return this.rpc.groups.$post({ json: input });
  }

  redeemGroupInvite(groupId: string, input: RedeemGroupInviteInput) {
    return this.rpc.groups[':groupId']['invite-redemptions'].$post({
      param: { groupId },
      json: input,
    });
  }

  previewGroupInvite(groupId: string, input: InviteContextInput) {
    return this.rpc.groups[':groupId']['invite-context'].$post({
      param: { groupId },
      json: input,
    });
  }

  group(groupId: string, credential: AccessCredential): GroupClient {
    return new GroupClient(this.rpc, groupId, credential);
  }
}

/** One authenticated group session, including all group-scoped operations. */
export class GroupClient {
  private readonly headers: {
    authorization: string;
    'x-device-user-id': string;
  };

  constructor(
    private readonly rpc: RpcClient,
    private readonly groupId: string,
    credential: AccessCredential,
  ) {
    this.headers = {
      authorization: `Bearer ${credential.accessToken}`,
      'x-device-user-id': credential.deviceUserId,
    };
  }

  getGroup() {
    return this.rpc.groups[':groupId'].$get(this.scope());
  }

  updateGroup(input: UpdateGroupInput) {
    return this.rpc.groups[':groupId'].$patch({ ...this.scope(), json: input });
  }

  deleteGroup(input: DeleteGroupInput) {
    return this.rpc.groups[':groupId'].$delete({
      ...this.scope(),
      query: { expected_version: input.expected_version },
    });
  }

  createMember(input: CreateMemberInput) {
    return this.rpc.groups[':groupId'].members.$post({
      ...this.scope(),
      json: input,
    });
  }

  listMembers() {
    return this.rpc.groups[':groupId'].members.$get(this.scope());
  }

  getMember(memberId: string) {
    return this.rpc.groups[':groupId'].members[':memberId'].$get(
      this.memberScope(memberId),
    );
  }

  updateMember(memberId: string, input: UpdateMemberInput) {
    return this.rpc.groups[':groupId'].members[':memberId'].$patch({
      ...this.memberScope(memberId),
      json: input,
    });
  }

  deleteMember(memberId: string, input: DeleteMemberInput) {
    return this.rpc.groups[':groupId'].members[':memberId'].$delete({
      ...this.memberScope(memberId),
      query: { expected_version: input.expected_version },
    });
  }

  createGroupInvite(input: CreateGroupInviteInput = {}) {
    return this.rpc.groups[':groupId'].invites.$post({
      ...this.scope(),
      json: input,
    });
  }

  listGroupInvites() {
    return this.rpc.groups[':groupId'].invites.$get(this.scope());
  }

  revokeGroupInvite(inviteId: string) {
    return this.rpc.groups[':groupId'].invites[':inviteId'].$delete(
      this.inviteScope(inviteId),
    );
  }

  /** Which group this session speaks for, and on whose authority. */
  private scope() {
    return {
      param: { groupId: this.groupId },
      header: this.headers,
    };
  }

  private memberScope(memberId: string) {
    return {
      param: { groupId: this.groupId, memberId },
      header: this.headers,
    };
  }

  private inviteScope(inviteId: string) {
    return {
      param: { groupId: this.groupId, inviteId },
      header: this.headers,
    };
  }
}
