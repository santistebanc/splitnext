import { errorSchema } from '../domain/errors';

/** Every error response has the same body, so a route supplies only its meaning. */
export function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: errorSchema } },
  };
}
