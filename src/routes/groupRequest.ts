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
  'x-device-user-id': deviceUserIdSchema.openapi({
    param: { name: 'x-device-user-id', in: 'header' },
    description: 'The device identity that received this group capability.',
  }),
});

/** Both credentials arrive validated, so this only strips the scheme. */
export function capabilityFrom(
  headers: z.infer<typeof accessHeadersSchema>,
): AccessCredential {
  return {
    accessToken: headers.authorization.slice(BEARER_PREFIX.length),
    deviceUserId: headers['x-device-user-id'],
  };
}
