import type { ClientNotice } from './storage';
import type { GroupCommand } from '../domain/commands';
import type { GroupSnapshot } from '../domain/sync';

/** A notice retry is new intent, based on the current projected state. */
export function commandForRetry(
  notice: ClientNotice,
  snapshot: GroupSnapshot,
  createId: () => string,
): GroupCommand {
  const command = notice.command;
  const serverMember = notice.outcome.server_state?.kind === 'member' ? notice.outcome.server_state.member : null;
  const command_id = createId();

  switch (command.type) {
    case 'group.rename':
      return { ...command, command_id, payload: { ...command.payload, expected_name: snapshot.group.name } };
    case 'member.create':
      return { ...command, command_id, payload: { ...command.payload, member_id: createId() } };
    case 'member.rename': {
      const member = snapshot.members.find((entry) => entry.id === command.payload.member_id) ?? snapshot.members.find((entry) => entry.id === serverMember?.id);

      if (!member) throw new Error('member_not_found_locally');

      return { ...command, command_id, payload: { ...command.payload, member_id: member.id, expected_display_name: member.display_name } };
    }

    case 'member.archive':
    case 'preference.set':
      return { ...command, command_id, payload: { member_id: snapshot.members.some((entry) => entry.id === command.payload.member_id) ? command.payload.member_id : serverMember?.id ?? command.payload.member_id } };
    case 'group.leave':
      return { ...command, command_id };
  }
}
