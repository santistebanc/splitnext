import { preferredMember, type AuditEvent, type ClientReplicaState, type Expense, type Settlement } from '@splitnext/client';
import { memberName, moneyLabel } from './expenses';

type Snapshot = ClientReplicaState['projected_snapshot'];

/** What an Activity entry is about, which picks its icon. */
export type ActivityKind = 'expense' | 'repayment' | 'people' | 'group';

/** An Activity entry as people read it: who did what, and one line of detail. */
export type ActivitySegment = { text: string; reference: boolean };

type Prose = string | ActivitySegment[];

const reference = (text: string): ActivitySegment => ({ text, reference: true });

// These unions are internal formatting values, never unvalidated input.
// oxlint-disable-next-line anti-slop/no-runtime-typeof
const prose = (...parts: (string | ActivitySegment)[]): ActivitySegment[] => parts.map((part) => typeof part === 'string' ? { text: part, reference: false } : part);

// oxlint-disable-next-line anti-slop/no-runtime-typeof
const segments = (value: Prose): ActivitySegment[] => typeof value === 'string' ? prose(value) : value;

const flat = (value: Prose): string => segments(value).map((part) => part.text).join('');

export type ActivityEntry = { kind: ActivityKind; who: string; what: string; detail: string | null; whatSegments: ActivitySegment[]; detailSegments: ActivitySegment[] };

/** The catalog retains all availability and navigation guards. */
export function activityTarget(event: AuditEvent) {
  const id = event.target.id;

  switch (event.target.kind) {
    case 'expense': return { name: 'showExpense', input: { expenseId: id }, label: 'Open expense' } as const;
    case 'settlement': return { name: 'showSettlement', input: { settlementId: id }, label: 'Open repayment' } as const;
    case 'member': return { name: 'showPerson', input: { memberId: id }, label: 'Open member' } as const;
    default: return null;
  }
}

/** Activity people see: every change except which member a device calls "you". */
export function visibleActivity(activity: readonly AuditEvent[]): AuditEvent[] {
  return activity.filter((event) => event.change.action !== 'preference.changed');
}

/** Changes other devices made after the last one this installation marked seen. */
export function newActivity(replica: ClientReplicaState | null, seen: number | undefined): AuditEvent[] {
  const identity = replica?.session?.identity.id;

  if (!replica || seen === undefined) return [];

  return visibleActivity(replica.activity).filter((event) => event.sequence > seen && event.actor_identity_id !== identity);
}

/** Whether an expense edit changes what anyone owes: its amount, who paid, or how it is split. */
function changesShares(before: Expense, after: Expense): boolean {
  return before.total !== after.total
    || before.currency !== after.currency
    || JSON.stringify(before.paid) !== JSON.stringify(after.paid)
    || JSON.stringify(before.parts) !== JSON.stringify(after.parts)
    || JSON.stringify(before.allocations) !== JSON.stringify(after.allocations)
    || JSON.stringify(before.extras) !== JSON.stringify(after.extras);
}

/** Whether a change moves balances: expenses and repayments, but not an expense's description alone. */
export function affectsBalances(event: AuditEvent): boolean {
  const change = event.change;

  switch (change.action) {
    case 'expense.recorded':
    case 'expense.removed':
    case 'expense.restored':
    case 'settlement.recorded':
    case 'settlement.edited':
    case 'settlement.removed':
    case 'settlement.restored':
      return true;
    case 'expense.edited':
      return changesShares(change.before, change.after.expense);
    default:
      return false;
  }
}

/**
 * The bell's count: new changes from others that move balances, plus this
 * device's changes waiting for review. Activity still tags every new entry.
 */
export function attentionCount(replica: ClientReplicaState | null, seen: number | undefined) {
  return { fresh: newActivity(replica, seen).filter(affectsBalances).length, review: replica?.notices.length ?? 0 };
}

/**
 * Who acted, by the name they used then: "Ana", "Santiago (now Santi)" once
 * that device chose another member, "Ana (User 2)" once it chose none, or
 * "You" for this installation.
 */
export function actorLabel(event: AuditEvent, replica: ClientReplicaState): string {
  if (event.actor_identity_id === replica.session?.identity.id) return 'You';
  const current = preferredMember(replica.projected_snapshot, event.actor_identity_id)?.display_name;
  const then = event.actor_member_name;

  if (!then) return current ?? event.actor_handle;

  if (!current) return `${then} (${event.actor_handle})`;

  return current === then ? then : `${then} (now ${current})`;
}

function split(expense: Expense): string {
  return `${moneyLabel(expense.total, expense.currency)} · split between ${expense.parts.length}`;
}

function payment(snapshot: Snapshot, entry: Settlement, amount = moneyLabel(entry.amount, entry.currency)): Prose {
  return prose(reference(memberName(snapshot, entry.from_member_id)), ' paid ', reference(memberName(snapshot, entry.to_member_id)), ` ${amount}`);
}

function edited(before: Expense, after: Expense): Prose {
  if (before.total !== after.total || before.currency !== after.currency)
    return `Amount ${moneyLabel(before.total, before.currency)} → ${moneyLabel(after.total, after.currency)}`;

  if (before.description !== after.description) return prose('Was ', reference(before.description));

  return 'Who paid or how it’s split changed';
}

/** Meaningful Activity uses names recorded when the action happened. */
export function describeActivity(event: AuditEvent, replica: ClientReplicaState): ActivityEntry {
  const snapshot = replica.projected_snapshot;
  const who = actorLabel(event, replica);
  const change = event.change;
  const entry = (kind: ActivityKind, what: Prose, detail: Prose | null = null): ActivityEntry => ({ kind, who, what: flat(what), detail: detail === null ? null : flat(detail), whatSegments: segments(what), detailSegments: detail === null ? [] : segments(detail) });

  switch (change.action) {
    case 'change.undone': {
      const original = replica.activity.find((item) => item.id === change.reverses_event_id);
      const kind = change.after.kind === 'expense' ? 'expense' : change.after.kind === 'settlement' ? 'repayment' : change.after.kind === 'member' ? 'people' : 'group';
      const reversed = original ? describeActivity(original, replica) : null;

      return entry(kind, 'undid a change', reversed ? prose(reference(reversed.who), ' ', ...reversed.whatSegments) : null);
    }

    case 'group.created': return entry('group', 'created the group', prose(reference(change.after.group.name)));
    case 'group.renamed': return entry('group', 'renamed the group', prose(reference(change.before.name), ' → ', reference(change.after.name)));
    case 'group.joined': return entry('people', 'joined', change.after.created_member ? prose('Added ', reference(change.after.created_member.display_name)) : null);
    case 'group.rejoined': return entry('people', 'rejoined', change.after.created_member ? prose('Added ', reference(change.after.created_member.display_name)) : null);
    case 'group.left': return entry('people', 'left the group');
    case 'invite.created': return entry('group', 'replaced the invite link', 'The old link stopped working');
    case 'member.created': return entry('people', prose('added ', reference(change.after.display_name)));
    case 'member.renamed': return entry('people', prose('renamed ', reference(change.before.display_name)), prose(reference(change.before.display_name), ' → ', reference(change.after.display_name)));
    case 'member.removed': {
      const member = snapshot?.members.find((item) => item.id === change.after.member.id);

      return entry('people', prose('removed ', reference(change.after.member.display_name)), member?.status === 'hidden' ? prose(reference(change.after.member.display_name), ' still has open balances') : null);
    }

    case 'member.restored': return entry('people', prose('restored ', reference(change.after.display_name)));
    case 'expense.recorded': return entry('expense', prose('added ', reference(change.after.expense.description)), split(change.after.expense));
    case 'expense.edited': return entry('expense', prose('changed ', reference(change.after.expense.description)), edited(change.before, change.after.expense));
    case 'expense.removed': return entry('expense', prose('removed ', reference(change.after.description)), split(change.after));
    case 'expense.restored': return entry('expense', prose('restored ', reference(change.after.expense.description)), split(change.after.expense));
    case 'settlement.recorded': return entry('repayment', 'recorded a repayment', payment(snapshot, change.after.settlement));
    case 'settlement.edited': return entry('repayment', 'changed a repayment', payment(snapshot, change.after.settlement, `${moneyLabel(change.before.amount, change.before.currency)} → ${moneyLabel(change.after.settlement.amount, change.after.settlement.currency)}`));
    case 'settlement.removed': return entry('repayment', 'removed a repayment', payment(snapshot, change.after));
    case 'settlement.restored': return entry('repayment', 'restored a repayment', payment(snapshot, change.after.settlement));
    case 'preference.changed': return entry('people', 'changed who they are');
  }
}

/** One line naming an action for labels, such as "Mira changed Groceries". */
export function activityLabel(event: AuditEvent, replica: ClientReplicaState): string {
  const entry = describeActivity(event, replica);

  return `${entry.who} ${entry.what}`;
}
