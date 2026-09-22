import { describe, expect, it } from 'vitest';
import {
  SplitnextClient,
  SplitnextProtocolError,
  SplitnextRequestError,
  type ClientRequestEvent,
  type ClientResponseEvent,
} from '../src/client';

const deviceSecret = 'A'.repeat(43);

describe('Splitnext client SDK', () => {
  it('owns authenticated URL, header, body, and response handling', async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      authorization: string | null;
      body: string | null;
    }> = [];

    const client = new SplitnextClient({
      baseUrl: 'https://splitnext.test/',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const body = await request.text();

        requests.push({
          url: request.url,
          method: request.method,
          authorization: request.headers.get('authorization'),
          body: body || null,
        });

        return Response.json({
          revision: 8,
          outcomes: [],
          state: { kind: 'unchanged' },
        });
      },
    }).forDevice(deviceSecret);

    const response = await client.syncGroup('group id', {
      known_revision: 8,
      commands: [],
    });

    expect(response).toEqual({
      revision: 8,
      outcomes: [],
      state: { kind: 'unchanged' },
    });
    expect(requests).toEqual([
      {
        url: 'https://splitnext.test/groups/group%20id/sync',
        method: 'POST',
        authorization: `Bearer v1.${deviceSecret}`,
        body: JSON.stringify({ known_revision: 8, commands: [] }),
      },
    ]);
  });

  it('creates an anonymous identity without sending an authorization header', async () => {
    let authorization: string | null = 'not-called';

    const client = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization');

        return Response.json({
          identity: {
            id: crypto.randomUUID(),
            created_at: '2026-09-22T00:00:00.000Z',
          },
          device: {
            id: crypto.randomUUID(),
            created_at: '2026-09-22T00:00:00.000Z',
          },
        });
      },
    });

    await client.createAnonymousIdentity(deviceSecret);

    expect(authorization).toBeNull();
  });

  it('reports transport activity without exposing observer failures to callers', async () => {
    const requests: ClientRequestEvent[] = [];
    const responses: ClientResponseEvent[] = [];

    const client = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      observer: {
        onRequest: (event) => requests.push(event),
        onResponse: (event) => responses.push(event),
      },
      fetch: async () => Response.json({ error: 'member_name_taken' }, {
        status: 409,
      }),
    }).forDevice(deviceSecret);

    const request = client.redeemGroupLink('group', 'secret/token', {
      preferred_member: {
        kind: 'new',
        member_id: crypto.randomUUID(),
        display_name: 'Santi',
      },
    });

    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<SplitnextRequestError>>({
        name: 'SplitnextRequestError',
        status: 409,
        code: 'member_name_taken',
      }),
    );
    expect(requests).toMatchObject([
      {
        method: 'POST',
        path: '/join/group/secret%2Ftoken',
      },
    ]);
    expect(responses).toMatchObject([
      {
        status: 409,
        response: { error: 'member_name_taken' },
      },
    ]);
  });

  it('keeps diagnostics from changing a successful request', async () => {
    const client = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      observer: {
        onRequest: () => {
          throw new Error('broken diagnostics');
        },
      },
      fetch: async () => Response.json({
        ok: true,
        service: 'splitnext-api',
        revision: 'local',
      }),
    });

    await expect(client.health()).resolves.toEqual({
      ok: true,
      service: 'splitnext-api',
      revision: 'local',
    });
  });

  it('rejects a successful HTTP response that violates the shared contract', async () => {
    const client = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      fetch: async () => Response.json({ ok: true }),
    });

    await expect(client.health()).rejects.toEqual(
      expect.objectContaining<Partial<SplitnextProtocolError>>({
        name: 'SplitnextProtocolError',
        message: 'invalid_response',
      }),
    );
  });
});
