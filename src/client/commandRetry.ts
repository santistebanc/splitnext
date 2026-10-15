import type { ClientNotice } from './storage';
import { commandFromIntent, type CommandIntent, type GroupCommand } from '../domain/commands';
import type { GroupSnapshot } from '../domain/sync';

/** A notice retry is new intent, based on the current projected state. */
export function commandForRetry(
  notice: ClientNotice,
  snapshot: GroupSnapshot,
  createId: () => string,
): GroupCommand {
  return commandFromIntent(retryIntent(notice, snapshot), snapshot, createId);
}

/** The original intent without its stale preconditions or identifiers. */
function retryIntent(notice: ClientNotice, snapshot: GroupSnapshot): CommandIntent {
  const command = notice.command;
  const server = notice.outcome.server_state;

  // A merged creation's alias is not in the projection; its outcome names
  // the member it resolved to.
  const member = (memberId: string) =>
    snapshot.members.some((entry) => entry.id === memberId) || server?.kind !== 'member'
      ? memberId
      : server.member.id;

  switch (command.type) {
    case 'group.rename':
      return { type: command.type, payload: { name: command.payload.name } };
    case 'member.create':
      return { type: command.type, payload: { display_name: command.payload.display_name } };
    case 'member.rename':
      return { type: command.type, payload: { member_id: member(command.payload.member_id), display_name: command.payload.display_name } };
    case 'member.archive':
    case 'preference.set':
      return { type: command.type, payload: { member_id: member(command.payload.member_id) } };
    case 'group.leave':
      return { type: command.type, payload: {} };
  }
}
