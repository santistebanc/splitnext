import { env, exports } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { expect } from 'vitest';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
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
    '/groups/{groupId}/invite-link': {
      post: { responses: object };
    };
    '/join/{groupId}/{inviteToken}': {
      post: { responses: object };
    };
  };
};

export function applyTestMigrations(): Promise<void> {
  return applyD1Migrations(env.INDEX, env.TEST_MIGRATIONS);
}

export async function fetchOpenApiDocument(): Promise<OpenApiDocument> {
  const response = await exports.default.fetch('https://splitnext.test/openapi.json');

  expect(response.status).toBe(200);

  // SAFETY: The Worker generates this document from its registered OpenAPI routes.
  return (await response.json()) as OpenApiDocument;
}
