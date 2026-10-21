import { z } from 'zod';
import type { AuditEvent } from './audit';
import { groupDetailsSchema } from './groups';
import { ledgerMemberSchema } from './members';
import { memberHasRecords } from './expenses';
import { expenseSchema } from './expenses';
import { settlementSchema } from './settlements';
import { identifierSchema } from './ids';
import type { GroupSnapshot } from './sync';

export const reversibleStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('group'), group: groupDetailsSchema }),
  z.object({ kind: z.literal('member'), member: ledgerMemberSchema }),
  z.object({ kind: z.literal('expense'), expense: expenseSchema }),
  z.object({ kind: z.literal('settlement'), settlement: settlementSchema }),
]);

export type ReversibleState = z.output<typeof reversibleStateSchema>;

export const changeUndoneAuditSchema = z.object({ action: z.literal('change.undone'), reverses_event_id: identifierSchema, before: reversibleStateSchema, after: reversibleStateSchema });

export type ReversibleEffect = { before: ReversibleState; after: ReversibleState };

/** The inverse restores saved monetary details and allocations, never reallocates. */
export function reversibleEffect(event: AuditEvent): ReversibleEffect | null {
  const change = event.change;

  switch (change.action) {
    case 'group.renamed': return { before: { kind: 'group', group: change.before }, after: { kind: 'group', group: change.after } };
    case 'member.created': return { before: { kind: 'member', member: { ...change.after, status: 'deleted' } }, after: { kind: 'member', member: change.after } };
    case 'member.renamed':
    case 'member.restored': return { before: { kind: 'member', member: change.before }, after: { kind: 'member', member: change.after } };
    case 'member.removed': return { before: { kind: 'member', member: change.before.member }, after: { kind: 'member', member: change.after.member } };
    case 'expense.recorded': return { before: { kind: 'expense', expense: { ...change.after.expense, status: 'removed' } }, after: { kind: 'expense', expense: change.after.expense } };
    case 'expense.edited':
    case 'expense.restored': return { before: { kind: 'expense', expense: change.before }, after: { kind: 'expense', expense: change.after.expense } };
    case 'expense.removed': return { before: { kind: 'expense', expense: change.before }, after: { kind: 'expense', expense: change.after } };
    case 'settlement.recorded': return { before: { kind: 'settlement', settlement: { ...change.after.settlement, status: 'removed' } }, after: { kind: 'settlement', settlement: change.after.settlement } };
    case 'settlement.edited':
    case 'settlement.restored': return { before: { kind: 'settlement', settlement: change.before }, after: { kind: 'settlement', settlement: change.after.settlement } };
    case 'settlement.removed': return { before: { kind: 'settlement', settlement: change.before }, after: { kind: 'settlement', settlement: change.after } };
    case 'change.undone': return { before: change.before, after: change.after };
    default: return null;
  }
}

export function undoProblem(snapshot: GroupSnapshot, event: AuditEvent, history: readonly AuditEvent[] = []): 'undo_not_supported' | 'undo_changed' | 'undo_member_referenced' | null {
  const effect = reversibleEffect(event);

  if (!effect) return 'undo_not_supported';
  const after = effect.after;

  if (after.kind === 'group' || after.kind === 'member') {
    const latest = [...history].reverse().find((entry) => entry.target.kind === event.target.kind && entry.target.id === event.target.id);

    if (latest && latest.id !== event.id) return 'undo_changed';

    if (after.kind === 'group') return snapshot.group.name === after.group.name ? null : 'undo_changed';
    const member = snapshot.members.find((entry) => entry.id === after.member.id);

    if (!member || JSON.stringify(ledgerMemberSchema.parse(member)) !== JSON.stringify(after.member)) return 'undo_changed';

    if (effect.before.kind === 'member' && effect.before.member.status === 'deleted' && memberHasRecords(snapshot, member.id)) return 'undo_member_referenced';

    return null;
  }

  const current = after.kind === 'expense' ? snapshot.expenses.find((entry) => entry.id === after.expense.id) : snapshot.settlements.find((entry) => entry.id === after.settlement.id);
  const version = after.kind === 'expense' ? after.expense.version : after.settlement.version;

  return current?.version === version ? null : 'undo_changed';
}

export function undoExplanation(reason: string): string {
  if (reason === 'undo_member_referenced') return 'This member has expense or repayment history and cannot be removed by undoing their addition.';

  return reason === 'undo_changed' ? 'Changed since this action. Undo would overwrite a later change.' : 'This action cannot be undone.';
}
