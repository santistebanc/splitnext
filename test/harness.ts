import { env, exports } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { expect } from 'vitest';
import type {
  ClientPreferredMemberChoice,
  RealtimeSocketFactory,
  SplitnextSyncClient,
} from '../src/client';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      APP_RENDERING: Fetcher;
    }
  }
}

/**
 * The generated document, described once and with nothing optional, so a
 * renamed path or a dropped response fails where it is read rather than
 * degrading into an assertion that passes against nothing.
 */
export type OpenApiDocument = {
  info: { title: string };
  paths: {
    '/health': object;
    '/ready': object;
    '/identities/anonymous': {
      post: {
        responses: object;
      };
    };
    '/identity': {
      get: {
        parameters: { name: string; in: string }[];
        responses: object;
      };
    };
    '/groups': {
      post: {
        parameters: { name: string; in: string }[];
        responses: object;
      };
    };
    '/groups/{groupId}/sync': {
      post: {
        parameters: { name: string; in: string }[];
        responses: object;
      };
    };
    '/groups/{groupId}/invite': {
      put: { responses: object };
    };
    '/groups/{groupId}/invite/preview': {
      post: { responses: object };
    };
    '/groups/{groupId}/join': {
      post: { responses: object };
    };
  };
};

export function applyTestMigrations(): Promise<void> {
  return applyD1Migrations(env.INDEX, env.TEST_MIGRATIONS);
}

export async function fetchOpenApiDocument(): Promise<OpenApiDocument> {
  const response = await exports.default.fetch(
    'https://splitnext.test/openapi.json',
  );

  expect(response.status).toBe(200);

  // SAFETY: The Worker generates this document from its registered OpenAPI routes.
  return (await response.json()) as OpenApiDocument;
}

const pendingUpgrades = new Set<Promise<void>>();

/**
 * Waits for upgrades still in flight, so a subscription opened at the end of
 * a test cannot outlive the test environment.
 */
export async function settleWorkerSockets(): Promise<void> {
  while (pendingUpgrades.size > 0) await Promise.allSettled(pendingUpgrades);
}

/**
 * Opens realtime connections through the Worker in-process, since tests have
 * no network listener for a browser WebSocket to reach.
 */
export const workerWebSocket: RealtimeSocketFactory = (
  url,
  protocols,
  handlers,
) => {
  let socket: WebSocket | null = null;
  let closedByClient = false;

  const connecting = (async () => {
    const response = await exports.default.fetch(url.replace(/^ws/, 'http'), {
      headers: {
        upgrade: 'websocket',
        'sec-websocket-protocol': protocols.join(', '),
      },
    });

    const accepted = response.webSocket;

    if (!accepted) {
      handlers.close(1006, `http_${response.status}`);

      return;
    }

    accepted.accept();
    socket = accepted;
    accepted.addEventListener('message', (event) =>
      handlers.message(String(event.data)),
    );
    accepted.addEventListener('close', (event) =>
      handlers.close(event.code, event.reason),
    );

    if (closedByClient) {
      accepted.close(1000, 'unsubscribed');
    } else {
      handlers.open();
    }
  })().catch(() => handlers.close(1006, 'network_error'));

  pendingUpgrades.add(connecting);
  void connecting.finally(() => pendingUpgrades.delete(connecting));

  return {
    close: (code, reason) => {
      closedByClient = true;
      socket?.close(code ?? 1000, reason);
    },
  };
};

export function randomDeviceSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** Joins the way a new participant must: through a freshly created link. */
export async function joinThroughInvite(
  creator: SplitnextSyncClient,
  joiner: SplitnextSyncClient,
  groupId: string,
  preferredMember: ClientPreferredMemberChoice,
) {
  const token = (await creator.regenerateInvite(groupId)).projected_snapshot
    ?.invite.token;

  if (!token) throw new Error('invite_token_missing');

  return joiner.joinGroup(groupId, preferredMember, token);
}
