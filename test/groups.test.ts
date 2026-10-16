import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createIdentifier, identifierSchema } from '../src/domain/ids';
import { createInviteToken, groupInviteSchema } from '../src/domain/invites';
import { applyTestMigrations, fetchOpenApiDocument } from './harness';

const createdGroupSchema = z.object({
  invite: groupInviteSchema,
  group: z.strictObject({
    id: identifierSchema,
    name: z.string(),
    created_at: z.iso.datetime(),
    revision: z.number().int(),
  }),
  member: z.object({
    id: identifierSchema,
    display_name: z.string(),
    status: z.literal('active'),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  }),
  access: z.object({
    identity_id: identifierSchema,
    actor_handle: z.string(),
    preferred_member_id: identifierSchema,
    granted_at: z.iso.datetime(),
    hidden_at: z.null(),
  }),
});

beforeAll(async () => {
  await applyTestMigrations();
});

describe('group creation API', () => {
  it('atomically creates a group, initial member, creator access, and usable invite', async () => {
    const session = await createIdentity('c');
    const input = newGroupInput();
    const response = await createGroup(session.deviceSecret, input);
    const created = createdGroupSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(created.group).toMatchObject({
      id: input.group_id,
      name: input.name,
      revision: 1,
    });
    expect(created.member).toMatchObject({
      display_name: input.creator_member_name,
      status: 'active',
    });
    expect(created.access).toEqual({
      identity_id: session.identityId,
      actor_handle: 'User 1',
      preferred_member_id: created.member.id,
      granted_at: created.group.created_at,
      hidden_at: null,
    });
    expect(created.invite).toEqual({
      id: input.invite.invite_id,
      token: input.invite.token,
      created_by_identity_id: session.identityId,
      created_at: created.group.created_at,
    });

    const preview = await exports.default.fetch(
      `https://splitnext.test/groups/${input.group_id}/invite/preview`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer v1.${session.deviceSecret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ token: input.invite.token }),
      },
    );

    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      group: { id: input.group_id },
      members: [{ display_name: 'Santi' }],
    });
  });

  it('returns the original result when creation is retried', async () => {
    const session = await createIdentity('d');
    const input = newGroupInput();

    const first = await createGroup(session.deviceSecret, input);
    const repeated = await createGroup(session.deviceSecret, input);

    expect(first.status).toBe(201);
    expect(repeated.status).toBe(201);
    expect(await repeated.json()).toEqual(await first.json());
  });

  it('requires an initial invite and creates no partial group on invalid input', async () => {
    const session = await createIdentity('j');
    const input = newGroupInput();

    for (const invite of [undefined, { ...input.invite, token: 'invalid' }]) {
      const response = await exports.default.fetch(
        'https://splitnext.test/groups',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer v1.${session.deviceSecret}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ ...input, invite }),
        },
      );

      expect(response.status).toBe(400);
    }

    const state = await exports.default.fetch(
      `https://splitnext.test/debug/groups/${input.group_id}`,
    );

    expect(state.status).toBe(404);
  });

  it('rejects a changed creation token and never restores the initial link after rotation', async () => {
    const session = await createIdentity('k');
    const input = newGroupInput();
    const first = await createGroup(session.deviceSecret, input);
    const original = await first.json();

    const changed = await createGroup(session.deviceSecret, {
      ...input,
      invite: { ...input.invite, token: createInviteToken() },
    });

    expect(changed.status).toBe(409);

    const replacement = {
      invite_id: createIdentifier(),
      token: createInviteToken(),
    };

    const headers = {
      authorization: `Bearer v1.${session.deviceSecret}`,
      'content-type': 'application/json',
    };

    const rotated = await exports.default.fetch(
      `https://splitnext.test/groups/${input.group_id}/invite`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify(replacement),
      },
    );

    expect(rotated.status).toBe(200);

    const retry = await createGroup(session.deviceSecret, input);
    expect(await retry.json()).toEqual(original);

    for (const [token, status] of [
      [input.invite.token, 403],
      [replacement.token, 200],
    ] as const) {
      const preview = await exports.default.fetch(
        `https://splitnext.test/groups/${input.group_id}/invite/preview`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ token }),
        },
      );

      expect(preview.status).toBe(status);
    }

    const state = await exports.default.fetch(
      `https://splitnext.test/debug/groups/${input.group_id}`,
    );

    const persisted = await state.text();
    expect(persisted.includes(input.invite.token)).toBe(false);
    expect(persisted.includes(replacement.token)).toBe(true);
  });

  it('exposes the authoritative snapshot to debug inspection', async () => {
    const session = await createIdentity('i');
    const input = newGroupInput();

    await createGroup(session.deviceSecret, input);

    const response = await exports.default.fetch(
      `https://splitnext.test/debug/groups/${input.group_id}`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      revision: 1,
      snapshot: { group: { id: input.group_id, name: input.name } },
    });
  });

  it('rejects reuse of a group id with different creation input', async () => {
    const session = await createIdentity('e');
    const input = newGroupInput();

    await createGroup(session.deviceSecret, input);

    const response = await createGroup(session.deviceSecret, {
      ...input,
      name: 'A different group',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'idempotency_conflict' });
  });

  it('requires a valid device credential', async () => {
    const response = await createGroup('x'.repeat(43), newGroupInput());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('does not let another identity adopt an existing group id', async () => {
    const firstIdentity = await createIdentity('f');
    const otherIdentity = await createIdentity('g');
    const input = newGroupInput();

    await createGroup(firstIdentity.deviceSecret, input);
    const response = await createGroup(otherIdentity.deviceSecret, input);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'group_exists' });
  });

  it('rejects invalid creation input', async () => {
    const session = await createIdentity('h');
    const input = { ...newGroupInput(), name: '   ' };
    const response = await createGroup(session.deviceSecret, input);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  });

  it('publishes group creation in OpenAPI', async () => {
    const document = await fetchOpenApiDocument();

    expect(document.paths['/groups'].post.responses).toHaveProperty('201');
    expect(document.paths['/groups'].post.parameters).toContainEqual(
      expect.objectContaining({ name: 'authorization', in: 'header' }),
    );
  });
});

async function createIdentity(seed: string) {
  const deviceSecret = seed.repeat(43);

  const response = await exports.default.fetch(
    'https://splitnext.test/identities/anonymous',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_secret: deviceSecret }),
    },
  );

  const body = z
    .object({ identity: z.object({ id: identifierSchema }) })
    .parse(await response.json());

  return { deviceSecret, identityId: body.identity.id };
}

function newGroupInput() {
  return {
    group_id: createIdentifier(),
    name: 'Berlin flat',
    creator_member_name: 'Santi',
    invite: { invite_id: createIdentifier(), token: createInviteToken() },
  };
}

function createGroup(
  deviceSecret: string,
  input: ReturnType<typeof newGroupInput>,
) {
  return exports.default.fetch('https://splitnext.test/groups', {
    method: 'POST',
    headers: {
      authorization: `Bearer v1.${deviceSecret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}
