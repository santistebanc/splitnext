/**
 * Invite-related route addresses live together so generated links and route
 * registrations cannot drift apart.
 */
export const INVITE_REDEMPTIONS_PATH =
  '/groups/{groupId}/invite-redemptions';

export const INVITE_CONTEXT_PATH = '/groups/{groupId}/invite-context';

export const JOIN_PATH = '/join/:groupId/:inviteToken';

/** A route path with its group parameter filled in. */
export function forGroup(path: string, groupId: string): string {
  return path.replace('{groupId}', encodeURIComponent(groupId));
}

/** The public browser address returned with a newly created invite. */
export function joinPath(groupId: string, inviteToken: string): string {
  return JOIN_PATH.replace(':groupId', encodeURIComponent(groupId)).replace(
    ':inviteToken',
    encodeURIComponent(inviteToken),
  );
}
