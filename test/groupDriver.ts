import { exports } from 'cloudflare:workers';
import { z } from 'zod';
import type {
  CreateGroupInput,
  DeleteGroupInput,
  UpdateGroupInput,
} from '../src/groupState';
import { groupSchema } from '../src/groupState';
import type {
  DeleteMemberInput,
  UpdateMemberInput,
} from '../src/memberDirectory';
import { accessTokenSchema } from '../src/accessCredential';
import { memberSchema } from '../src/memberDirectory';

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

export function postGroup(input: CreateGroupInput): Promise<Response> {
  return exports.default.fetch('https://splitnext.test/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** Carries one valid group identity while hiding routine HTTP request plumbing. */
export class AuthenticatedGroupDriver {
  readonly created: CreateGroupResponse;
  readonly input: CreateGroupInput;

  private constructor(input: CreateGroupInput, created: CreateGroupResponse) {
    this.input = input;
    this.created = created;
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
    return this.request('', groupResponseSchema);
  }

  updateGroup(input: UpdateGroupInput): Promise<TestReply<GroupResponse>> {
    return this.request('', groupResponseSchema, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  deleteGroup(input: DeleteGroupInput): Promise<TestReply<GroupResponse>> {
    return this.request(
      `?expected_version=${encodeURIComponent(String(input.expected_version))}`,
      groupResponseSchema,
      { method: 'DELETE' },
    );
  }

  createMember(displayName: string): Promise<TestReply<MemberResponse>> {
    return this.request('/members', memberResponseSchema, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: displayName }),
    });
  }

  listMembers(): Promise<TestReply<MembersResponse>> {
    return this.request('/members', membersResponseSchema);
  }

  getMember(memberId: string): Promise<TestReply<MemberResponse>> {
    return this.request(`/members/${memberId}`, memberResponseSchema);
  }

  updateMember(
    memberId: string,
    input: UpdateMemberInput,
  ): Promise<TestReply<MemberResponse>> {
    return this.request(`/members/${memberId}`, memberResponseSchema, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  deleteMember(
    memberId: string,
    input: DeleteMemberInput,
  ): Promise<TestReply<MemberResponse>> {
    return this.request(
      `/members/${memberId}?expected_version=${encodeURIComponent(String(input.expected_version))}`,
      memberResponseSchema,
      { method: 'DELETE' },
    );
  }

  private async request<T>(
    relativePath: string,
    successSchema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<TestReply<T>> {
    const headers = new Headers(init.headers);

    headers.set('authorization', `Bearer ${this.created.access_token}`);
    headers.set('x-device-user-id', this.input.device_user_id);

    const response = await exports.default.fetch(
      `https://splitnext.test/groups/${this.created.group.id}${relativePath}`,
      { ...init, headers },
    );

    return readReply(response, successSchema);
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
  response: Response,
  successSchema: z.ZodType<T>,
): Promise<TestReply<T>> {
  const body: unknown = await response.json();

  return response.ok
    ? { ok: true, status: response.status, body: successSchema.parse(body) }
    : { ok: false, status: response.status, body: errorResponseSchema.parse(body) };
}
