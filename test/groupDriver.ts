import { exports } from 'cloudflare:workers';
import { z } from 'zod';
import type {
  CreateGroupInput,
  DeleteGroupInput,
  UpdateGroupInput,
} from '../src/groupState';
import { groupSchema } from '../src/groupState';
import type {
  CreateMemberInput,
  DeleteMemberInput,
  UpdateMemberInput,
} from '../src/memberDirectory';
import { accessTokenSchema } from '../src/accessCredential';
import { memberSchema } from '../src/memberDirectory';
import {
  GroupClient,
  SplitnextClient,
  type SplitnextFetch,
} from '../src/splitnextClient';

const workerFetch: SplitnextFetch = (input, init) =>
  exports.default.fetch(input, init);

const api = new SplitnextClient('https://splitnext.test', workerFetch);

const createGroupResponseSchema = z.object({
  access_token: accessTokenSchema,
  group: groupSchema,
  member: memberSchema,
});

const groupResponseSchema = z.object({ group: groupSchema });

const memberResponseSchema = z.object({ member: memberSchema });

const membersResponseSchema = z.object({ members: z.array(memberSchema) });

const errorResponseSchema = z.object({ error: z.string() }).strict();

export type CreateGroupResponse = z.infer<typeof createGroupResponseSchema>;

export type GroupResponse = z.infer<typeof groupResponseSchema>;

export type MemberResponse = z.infer<typeof memberResponseSchema>;

export type MembersResponse = z.infer<typeof membersResponseSchema>;

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export type TestReply<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: ErrorResponse };

/** Only what readReply needs; the body is parsed by schema, not by this type. */
type JsonResponse = {
  ok: boolean;
  status: number;
  json(): Promise<object>;
};

export function postGroup(input: CreateGroupInput) {
  return api.createGroup(input);
}

/** Carries one valid group identity while hiding routine HTTP request plumbing. */
export class AuthenticatedGroupDriver {
  readonly created: CreateGroupResponse;
  readonly input: CreateGroupInput;

  private readonly client: GroupClient;

  private constructor(input: CreateGroupInput, created: CreateGroupResponse) {
    this.input = input;
    this.created = created;
    this.client = api.group(created.group.id, {
      accessToken: created.access_token,
      deviceUserId: input.device_user_id,
    });
  }

  static async create(
    overrides: Partial<CreateGroupInput> = {},
  ): Promise<AuthenticatedGroupDriver> {
    const input = {
      name: 'Berlin flat',
      currency_label: 'EUR',
      device_user_id: crypto.randomUUID(),
      creator_display_name: 'Santi',
      ...overrides,
    };

    const response = await postGroup(input);
    const creation = await readReply(response, createGroupResponseSchema);

    if (!creation.ok || creation.status !== 201) {
      throw new Error(
        `authenticated_group_creation_failed:${creation.status}:${JSON.stringify(creation.body)}`,
      );
    }

    return new AuthenticatedGroupDriver(input, creation.body);
  }

  getGroup(): Promise<TestReply<GroupResponse>> {
    return this.read(this.client.getGroup(), groupResponseSchema);
  }

  updateGroup(input: UpdateGroupInput): Promise<TestReply<GroupResponse>> {
    return this.read(this.client.updateGroup(input), groupResponseSchema);
  }

  deleteGroup(input: DeleteGroupInput): Promise<TestReply<GroupResponse>> {
    return this.read(this.client.deleteGroup(input), groupResponseSchema);
  }

  createMember(input: CreateMemberInput): Promise<TestReply<MemberResponse>> {
    return this.read(this.client.createMember(input), memberResponseSchema);
  }

  listMembers(): Promise<TestReply<MembersResponse>> {
    return this.read(this.client.listMembers(), membersResponseSchema);
  }

  getMember(memberId: string): Promise<TestReply<MemberResponse>> {
    return this.read(this.client.getMember(memberId), memberResponseSchema);
  }

  updateMember(
    memberId: string,
    input: UpdateMemberInput,
  ): Promise<TestReply<MemberResponse>> {
    return this.read(
      this.client.updateMember(memberId, input),
      memberResponseSchema,
    );
  }

  deleteMember(
    memberId: string,
    input: DeleteMemberInput,
  ): Promise<TestReply<MemberResponse>> {
    return this.read(
      this.client.deleteMember(memberId, input),
      memberResponseSchema,
    );
  }

  private async read<T>(
    responsePromise: Promise<JsonResponse>,
    successSchema: z.ZodType<T>,
  ): Promise<TestReply<T>> {
    return readReply(await responsePromise, successSchema);
  }
}

export function successBody<T>(reply: TestReply<T>, expectedStatus: number): T {
  if (!reply.ok) {
    throw new Error(
      `expected_success_but_received:${reply.status}:${JSON.stringify(reply.body)}`,
    );
  }

  if (reply.status !== expectedStatus) {
    throw new Error(`expected_status_${expectedStatus}_but_received_${reply.status}`);
  }

  return reply.body;
}

export function failureBody<T>(
  reply: TestReply<T>,
  expectedStatus: number,
): ErrorResponse {
  if (reply.ok) {
    throw new Error(
      `expected_failure_but_received:${reply.status}:${JSON.stringify(reply.body)}`,
    );
  }

  if (reply.status !== expectedStatus) {
    throw new Error(`expected_status_${expectedStatus}_but_received_${reply.status}`);
  }

  return reply.body;
}

async function readReply<T>(
  response: JsonResponse,
  successSchema: z.ZodType<T>,
): Promise<TestReply<T>> {
  const body: unknown = await response.json();

  return response.ok
    ? { ok: true, status: response.status, body: successSchema.parse(body) }
    : { ok: false, status: response.status, body: errorResponseSchema.parse(body) };
}
