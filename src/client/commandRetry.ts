import type { ClientNotice } from './storage';
import { commandFromIntent, intentForRetry, type GroupCommand } from '../domain/commands';
import type { GroupSnapshot } from '../domain/sync';

/** A notice retry is new intent, based on the current projected state. */
export function commandForRetry(
  notice: ClientNotice,
  snapshot: GroupSnapshot,
  createId: () => string,
): GroupCommand {
  const server = notice.outcome.server_state;

  // A merged creation's alias is not in the projection; its outcome names
  // the member it resolved to.
  const member = (memberId: string) =>
    snapshot.members.some((entry) => entry.id === memberId) || server?.kind !== 'member'
      ? memberId
      : server.member.id;

  return commandFromIntent(intentForRetry(notice.command, member), snapshot, createId);
}
