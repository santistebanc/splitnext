import { z } from '@hono/zod-openapi';
import {
  ACCESS_TOKEN_PATTERN,
  type AccessCredential,
  deviceUserIdSchema,
} from '../accessCredential';

const BEARER_PREFIX = 'Bearer ';

export const groupIdParameterSchema = z.uuid().openapi({
  param: { name: 'groupId', in: 'path' },
});

export const groupParamsSchema = z.object({
  groupId: groupIdParameterSchema,
});

export const accessHeadersSchema = z.object({
  authorization: z
    .string()
    .regex(new RegExp(`^${BEARER_PREFIX}${ACCESS_TOKEN_PATTERN}$`))
    .openapi({
      param: { name: 'authorization', in: 'header' },
      description: 'The Bearer capability returned when the group was created.',
    }),
  // OpenAPI metadata belongs to this route-owned schema. The domain schema is
  // only the validation target, so importing it before this module is safe.
  'x-device-user-id': z.string().pipe(deviceUserIdSchema).openapi({
    param: { name: 'x-device-user-id', in: 'header' },
    description: 'The device identity that received this group capability.',
  }),
});

/** Both credentials arrive validated, so this only strips the scheme. */
function capabilityFrom(
  headers: z.infer<typeof accessHeadersSchema>,
): AccessCredential {
  return {
    accessToken: headers.authorization.slice(BEARER_PREFIX.length),
    deviceUserId: headers['x-device-user-id'],
  };
}

/** How a group id becomes an object, decided once for every route. */
export function groupObject(env: Env, groupId: string) {
  return env.GROUPS.get(env.GROUPS.idFromName(groupId));
}

/** The same, for a route that also carries the authority to act on the group. */
export function groupSession(
  env: Env,
  groupId: string,
  headers: z.infer<typeof accessHeadersSchema>,
) {
  return {
    group: groupObject(env, groupId),
    credential: capabilityFrom(headers),
  };
}
