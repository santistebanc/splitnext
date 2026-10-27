import { undoExplanation, type ClientReplicaState } from '@splitnext/client';
import { moneyLabel } from './expenses';

type Notice = ClientReplicaState['notices'][number];

/** What the change was about, in the words of its target now. */
function subject(notice: Notice): string {
  const current = notice.outcome.server_state;

  if (current?.kind === 'expense') return current.expense.description;

  if (current?.kind === 'member') return current.member.display_name;

  if (current?.kind === 'group') return current.group.name;

  const command = notice.command;

  switch (command.type) {
    case 'expense.record':
    case 'expense.edit':
      return command.payload.description;
    case 'member.create':
    case 'member.rename':
      return command.payload.display_name;
    case 'group.rename':
      return command.payload.name;
    default:
      return 'this';
  }
}

/** The change this device tried, named as what it was doing: "Your change to Groceries". */
export function reviewTitle(notice: Notice): string {
  const command = notice.command;

  switch (command.type) {
    case 'change.undo':
      return 'Your undo';
    case 'group.rename':
      return 'Renaming the group';
    case 'member.create':
      return `Adding ${command.payload.display_name}`;
    case 'member.rename':
      return `Renaming ${command.payload.expected_display_name}`;
    case 'member.remove':
      return `Removing ${subject(notice)}`;
    case 'member.restore':
      return `Restoring ${subject(notice)}`;
    case 'settlement.record':
      return `Your repayment of ${moneyLabel(command.payload.amount, command.payload.currency)}`;
    case 'settlement.edit':
      return 'Your change to a repayment';
    case 'settlement.remove':
      return 'Removing a repayment';
    case 'settlement.restore':
      return 'Restoring a repayment';
    case 'expense.record':
      return `Adding ${command.payload.description}`;
    case 'expense.edit':
      return `Your change to ${subject(notice)}`;
    case 'expense.remove':
      return `Removing ${subject(notice)}`;
    case 'expense.restore':
      return `Restoring ${subject(notice)}`;
    case 'preference.set':
      return 'Choosing who you are';
    case 'group.leave':
      return 'Leaving the group';
  }
}

/** What the target is now, or null when the change left nothing to compare. */
function currentResult(notice: Notice): string | null {
  const current = notice.outcome.server_state;

  if (current?.kind === 'group') return `called “${current.group.name}”`;

  if (current?.kind === 'expense')
    return current.expense.status === 'removed'
      ? 'removed'
      : `${moneyLabel(current.expense.total, current.expense.currency)}, split between ${current.expense.parts.length}`;

  if (current?.kind === 'settlement')
    return current.settlement.status === 'removed' ? 'removed' : moneyLabel(current.settlement.amount, current.settlement.currency);

  if (current?.kind === 'member')
    return current.member.status === 'active' ? `called “${current.member.display_name}”` : 'removed';

  return null;
}

function reason(notice: Notice): string {
  if (notice.command.type === 'change.undo' && notice.outcome.reason) return undoExplanation(notice.outcome.reason);

  if (notice.outcome.status === 'superseded') return 'Someone else changed it first.';

  switch (notice.outcome.reason) {
    case 'member_removed':
      return 'That person was removed before your change arrived.';
    case 'expense_removed':
      return 'That expense was removed before your change arrived.';
    case 'group_left':
      return 'You left this group before the change arrived.';
    default:
      return 'The group’s current state does not allow this change.';
  }
}

/** Why the change was not applied and where things stand: "Someone else changed it first. It’s now 36.00 EUR, split between 6." */
export function reviewDetail(notice: Notice): string {
  const now = currentResult(notice);

  return now ? `${reason(notice)} It’s now ${now}.` : reason(notice);
}

/** Whether a notice concerns an expense or repayment, for the dot on its row. */
export function needsReview(replica: ClientReplicaState, kind: 'expense' | 'settlement', id: string): boolean {
  return replica.notices.some((notice) => notice.outcome.target.kind === kind && notice.outcome.target.id === id);
}
