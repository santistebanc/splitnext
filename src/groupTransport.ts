import { isInviteFailure } from './domain/invites';

/** HTTP and isolated transports expose the same group failure contract. */
export const groupFailureStatus = {
  create(error: string): 400 | 409 {
    return error === 'invalid_request' ? 400 : 409;
  },
  join(error: string): 400 | 403 | 404 | 409 {
    if (error === 'invalid_request') return 400;

    if (error === 'group_not_found') return 404;

    if (isInviteFailure(error)) return 403;

    return 409;
  },
  sync(error: string): 400 | 401 {
    return error === 'invalid_request' ? 400 : 401;
  },
  invite(error: string): 400 | 401 | 404 | 409 {
    if (error === 'invalid_request') return 400;

    if (error === 'group_not_found') return 404;

    if (error === 'unauthorized') return 401;

    return 409;
  },
  preview(error: string): 400 | 403 | 404 {
    if (error === 'invalid_request') return 400;

    return error === 'group_not_found' ? 404 : 403;
  },
};
