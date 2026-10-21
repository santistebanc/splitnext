import { preferredMember, type AuditEvent, type ClientReplicaState, type Expense, type Settlement } from '@splitnext/client';
import { memberName, moneyLabel } from './expenses';

type Snapshot = ClientReplicaState['projected_snapshot'];

/** What an Activity entry is about, which picks its icon. */
export type ActivityKind = 'expense' | 'repayment' | 'people' | 'group';

/** An Activity entry as people read it: who did what, and one line of detail. */
export type ActivityEntry = { kind: ActivityKind; who: string; what: string; detail: string | null };

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

/** The bell's count: new changes from others plus this device's changes waiting for review. */
export function attentionCount(replica: ClientReplicaState | null, seen: number | undefined) {
  return { fresh: newActivity(replica, seen).length, review: replica?.notices.length ?? 0 };
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

function payment(snapshot: Snapshot, entry: Settlement, amount = moneyLabel(entry.amount, entry.currency)): string {
  return `${memberName(snapshot, entry.from_member_id)} paid ${memberName(snapshot, entry.to_member_id)} ${amount}`;
}

function edited(before: Expense, after: Expense): string {
  if (before.total !== after.total || before.currency !== after.currency)
    return before.currency === after.currency
      ? `Amount ${moneyLabel(before.total, before.currency).replace(` ${before.currency}`, '')} → ${moneyLabel(after.total, after.currency)}`
      : `Amount ${moneyLabel(before.total, before.currency)} → ${moneyLabel(after.total, after.currency)}`;

  if (before.description !== after.description) return `Was ${before.description}`;

  return 'Who paid or how it’s split changed';
}

/** Meaningful Activity uses names recorded when the action happened. */
export function describeActivity(event: AuditEvent, replica: ClientReplicaState): ActivityEntry {
  const snapshot = replica.projected_snapshot;
  const who = actorLabel(event, replica);
  const change = event.change;
  const entry = (kind: ActivityKind, what: string, detail: string | null = null): ActivityEntry => ({ kind, who, what, detail });

  switch (change.action) {
    case 'change.undone': {
      const original = replica.activity.find((item) => item.id === change.reverses_event_id);
      const kind = change.after.kind === 'expense' ? 'expense' : change.after.kind === 'settlement' ? 'repayment' : change.after.kind === 'member' ? 'people' : 'group';
      const reversed = original ? describeActivity(original, replica) : null;

      return entry(kind, 'undid a change', reversed ? `${reversed.who} ${reversed.what}` : null);
    }

    case 'group.created': return entry('group', 'created the group', change.after.group.name);
    case 'group.renamed': return entry('group', 'renamed the group', `${change.before.name} → ${change.after.name}`);
    case 'group.joined': return entry('people', 'joined', change.after.created_member ? `Added ${change.after.created_member.display_name}` : null);
    case 'group.rejoined': return entry('people', 'rejoined', change.after.created_member ? `Added ${change.after.created_member.display_name}` : null);
    case 'group.left': return entry('people', 'left the group');
    case 'invite.created': return entry('group', 'replaced the invite link', 'The old link stopped working');
    case 'member.created': return entry('people', `added ${change.after.display_name}`);
    case 'member.renamed': return entry('people', `renamed ${change.before.display_name}`, `${change.before.display_name} → ${change.after.display_name}`);
    case 'member.removed': {
      const member = snapshot?.members.find((item) => item.id === change.after.member.id);

      return entry('people', `removed ${change.after.member.display_name}`, member?.status === 'hidden' ? `${change.after.member.display_name} still has open balances` : null);
    }

    case 'member.restored': return entry('people', `restored ${change.after.display_name}`);
    case 'expense.recorded': return entry('expense', `added ${change.after.expense.description}`, split(change.after.expense));
    case 'expense.edited': return entry('expense', `changed ${change.after.expense.description}`, edited(change.before, change.after.expense));
    case 'expense.removed': return entry('expense', `removed ${change.after.description}`, split(change.after));
    case 'expense.restored': return entry('expense', `restored ${change.after.expense.description}`, split(change.after.expense));
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
