import { z } from 'zod';
import { identifierSchema } from '../ids';
import { expenseMemberIds, keepNamedMembers } from '../expenses';
import { settlementMemberIds } from '../settlements';
import { reversibleEffect, undoProblem } from '../reversals';
import { defineCommand, rejected, type IntentOf } from './define';

export const undoChangeCommandSchema = z.object({ command_id: identifierSchema, type: z.literal('change.undo'), payload: z.object({ event_id: identifierSchema }) });

type Command = z.output<typeof undoChangeCommandSchema>;

export const changeUndo = defineCommand<Command, IntentOf<Command>>({
  requiresServerDecision: false,
  target: (snapshot) => ({ kind: 'group', id: snapshot.group.id }),
  complete: (id, intent) => ({ command_id: id, ...intent }),
  retryIntent: (command) => ({ type: command.type, payload: command.payload }),
  apply(snapshot, identity, command, at, history = []) {
    const event = history.find((entry) => entry.id === command.payload.event_id);
    const target = event?.target ?? { kind: 'group' as const, id: snapshot.group.id };

    if (!event) return rejected(snapshot, target, 'undo_not_found');
    const effect = reversibleEffect(event);

    if (!effect) return rejected(snapshot, target, 'undo_not_supported');
    const problem = undoProblem(snapshot, event, history);

    if (problem) return { ...rejected(snapshot, target, problem), status: 'superseded' };
    const desired = effect.before;

    if (desired.kind === 'group' && effect.after.kind === 'group') {
      const group = { ...snapshot.group, name: desired.group.name };

      return { snapshot: { ...snapshot, group }, status: 'applied', reason: null, target, serverState: { kind: 'group', group },
        audit: { action: 'change.undone', reverses_event_id: event.id, before: { kind: 'group', group: snapshot.group }, after: { kind: 'group', group } } };
    }

    if (desired.kind === 'member' && effect.after.kind === 'member') {
      const current = snapshot.members.find((entry) => entry.id === desired.member.id);

      if (!current) return rejected(snapshot, target, 'undo_changed');
      const member = { ...desired.member, updated_at: at };
      const access_grants = member.status === 'active' ? snapshot.access_grants : snapshot.access_grants.map((grant) => grant.preferred_member_id === member.id ? { ...grant, preferred_member_id: null } : grant);

      return { snapshot: { ...snapshot, members: snapshot.members.map((entry) => entry.id === member.id ? member : entry), access_grants }, status: 'applied', reason: null, target, serverState: { kind: 'member', member },
        audit: { action: 'change.undone', reverses_event_id: event.id, before: { kind: 'member', member: current }, after: { kind: 'member', member } } };
    }

    if (desired.kind === 'expense' && effect.after.kind === 'expense') {
      const current = snapshot.expenses.find((entry) => entry.id === desired.expense.id);

      if (!current) return rejected(snapshot, target, 'undo_changed');
      const expense = { ...desired.expense, version: current.version + 1, updated_at: at };
      const kept = keepNamedMembers(snapshot, expenseMemberIds(expense), at);

      return { snapshot: { ...snapshot, members: kept.members, expenses: snapshot.expenses.map((entry) => entry.id === expense.id ? expense : entry) }, status: 'applied', reason: null, target,
        serverState: { kind: 'expense', expense }, audit: { action: 'change.undone', reverses_event_id: event.id, before: { kind: 'expense', expense: current }, after: { kind: 'expense', expense } } };
    }

    if (desired.kind === 'settlement' && effect.after.kind === 'settlement') {
      const current = snapshot.settlements.find((entry) => entry.id === desired.settlement.id);

      if (!current) return rejected(snapshot, target, 'undo_changed');
      const settlement = { ...desired.settlement, version: current.version + 1, updated_at: at };
      const kept = keepNamedMembers(snapshot, settlementMemberIds(settlement), at);

      return { snapshot: { ...snapshot, members: kept.members, settlements: snapshot.settlements.map((entry) => entry.id === settlement.id ? settlement : entry) }, status: 'applied', reason: null, target,
        serverState: { kind: 'settlement', settlement }, audit: { action: 'change.undone', reverses_event_id: event.id, before: { kind: 'settlement', settlement: current }, after: { kind: 'settlement', settlement } } };
    }

    return rejected(snapshot, target, 'undo_not_supported');
  },
});
