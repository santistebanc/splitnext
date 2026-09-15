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

type OpenApiGroupSchema = {
  properties: { group: { properties: object } };
};

type OpenApiJsonResponse = {
  content: { 'application/json': { schema: OpenApiGroupSchema } };
};

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
    '/groups': {
      post: {
        responses: object;
      };
    };
    '/groups/{groupId}': {
      get: {
        parameters: { name: string; in: string }[];
        responses: {
          200: OpenApiJsonResponse;
        };
      };
      patch: {
        responses: object;
      };
      delete: {
        responses: object;
      };
    };
    '/groups/{groupId}/members': {
      post: { responses: object };
      get: { responses: object };
    };
    '/groups/{groupId}/members/{memberId}': {
      get: { responses: object };
      patch: { responses: object };
      delete: { responses: object };
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
