import { describe, expect, it } from 'vitest';
import {
  SplitnextClient,
  SplitnextProtocolError,
  SplitnextRequestError,
  type ClientTransportEvent,
} from '../src/client';
import { createIdentifier } from '../src/domain/ids';

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
    const events: ClientTransportEvent[] = [];

    const client = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      observer: (event) => events.push(event),
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization');

        return Response.json({
          identity: {
            id: createIdentifier(),
            created_at: '2026-09-22T00:00:00.000Z',
          },
          device: {
            id: createIdentifier(),
            created_at: '2026-09-22T00:00:00.000Z',
          },
        });
      },
    });

    await client.createAnonymousIdentity(deviceSecret);

    expect(authorization).toBeNull();
    expect(JSON.stringify(events)).not.toContain(deviceSecret);
    expect(events[0]).toMatchObject({
      kind: 'request',
      body: { device_secret: '[redacted]' },
    });
  });

  it('reports one correlated transport event stream', async () => {
    const events: ClientTransportEvent[] = [];

    const client = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      observer: (event) => events.push(event),
      fetch: async () => Response.json({ error: 'member_name_taken' }, {
        status: 409,
      }),
    }).forDevice(deviceSecret);

    const request = client.joinGroup('group', {
      join_id: createIdentifier(),
      preferred_member: {
        kind: 'new',
        member_id: createIdentifier(),
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
    expect(events).toMatchObject([
      {
        kind: 'request',
        method: 'POST',
        path: '/groups/group/join',
      },
      {
        kind: 'response',
        status: 409,
        response: { error: 'member_name_taken' },
      },
    ]);
    expect(events[0]?.request_id).toBe(events[1]?.request_id);
  });

  it('keeps diagnostics from changing a successful request', async () => {
    const client = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      observer: () => {
        throw new Error('broken diagnostics');
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

  it('correlates identical requests completed out of order', async () => {
    const events: ClientTransportEvent[] = [];
    const releases: Array<() => void> = [];

    const client = new SplitnextClient({
      baseUrl: 'https://splitnext.test',
      observer: (event) => events.push(event),
      fetch: () => new Promise<Response>((resolve) => {
        releases.push(() => resolve(Response.json({
          ok: true,
          service: 'splitnext-api',
          revision: 'local',
        })));
      }),
    });

    const first = client.health();
    const second = client.health();

    releases[1]?.();
    await second;
    releases[0]?.();
    await first;

    const requestIds = events.flatMap((event) =>
      event.kind === 'request' ? [event.request_id] : [],
    );

    const responseIds = events.flatMap((event) =>
      event.kind === 'response' ? [event.request_id] : [],
    );

    expect(responseIds).toEqual([requestIds[1], requestIds[0]]);
  });

  it('distinguishes a failed connection from malformed JSON and observes both', async () => {
    const events: ClientTransportEvent[] = [];
    const network = new SplitnextClient({ baseUrl: 'https://splitnext.test', observer: (event) => events.push(event), fetch: async () => { throw new TypeError('connection_lost'); } });

    await expect(network.health()).rejects.toMatchObject({ name: 'SplitnextNetworkError' });
    expect(events.at(-1)).toMatchObject({ kind: 'network_error' });
    const protocol = new SplitnextClient({ baseUrl: 'https://splitnext.test', observer: (event) => events.push(event), fetch: async () => new Response('<html>broken</html>') });

    await expect(protocol.health()).rejects.toMatchObject({ name: 'SplitnextProtocolError' });
    expect(events.at(-1)).toMatchObject({ kind: 'protocol_error' });
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
