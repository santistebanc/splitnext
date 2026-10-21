import { z } from 'zod';
import { identifierSchema } from '../ids';
import { keepNamedMembers } from '../expenses';
import { settlementEntry, settlementEntrySchema, settlementMemberIds, settlementProblem, settlementSchema } from '../settlements';
import { defineCommand, rejected, unchanged, type IntentOf } from './define';
import { settlementChangeSchema } from './settlementRecord';

export const editSettlementCommandSchema = z.object({ command_id: identifierSchema, type: z.literal('settlement.edit'), payload: settlementEntrySchema.extend({ settlement_id: identifierSchema, expected_version: z.number().int().positive() }) });

type Command = z.output<typeof editSettlementCommandSchema>;

export const settlementEditedAuditSchema = z.object({ action: z.literal('settlement.edited'), before: settlementSchema, after: settlementChangeSchema });

export const settlementEdit = defineCommand<Command, IntentOf<Command, 'expected_version'>>({
  requiresServerDecision: false,
  target: (snapshot, identity, command) => ({ kind: 'settlement', id: command.payload.settlement_id }),
  complete(id, intent, snapshot) {
    const current = snapshot.settlements.find((entry) => entry.id === intent.payload.settlement_id);

    if (!current) throw new Error('settlement_not_found_locally');

    return { command_id: id, type: intent.type, payload: { ...settlementEntry(intent.payload), settlement_id: current.id, expected_version: intent.payload.expected_version ?? current.version } };
  },
  retryIntent: (command) => ({ type: command.type, payload: { ...settlementEntry(command.payload), settlement_id: command.payload.settlement_id } }),
  apply(snapshot, identity, command, at) {
    const target = { kind: 'settlement' as const, id: command.payload.settlement_id };
    const current = snapshot.settlements.find((entry) => entry.id === target.id);

    if (!current) return rejected(snapshot, target, 'settlement_not_found');
    const serverState = { kind: 'settlement' as const, settlement: current };

    if (current.status === 'removed') return { ...rejected(snapshot, target, 'settlement_removed'), serverState };
    const entry = settlementEntry(command.payload);

    if (JSON.stringify(settlementEntry(current)) === JSON.stringify(entry)) return unchanged(snapshot, target, serverState);

    if (current.version !== command.payload.expected_version) return { snapshot, target, serverState, status: 'superseded', reason: 'settlement_changed', audit: null };
    const problem = settlementProblem(snapshot, entry);

    if (problem) return rejected(snapshot, target, problem);
    const settlement = { ...current, ...entry, version: current.version + 1, updated_at: at };
    const kept = keepNamedMembers(snapshot, settlementMemberIds(settlement), at);

    return { snapshot: { ...snapshot, members: kept.members, settlements: snapshot.settlements.map((item) => item.id === settlement.id ? settlement : item) }, status: 'applied', reason: null, target,
      serverState: { kind: 'settlement', settlement }, audit: { action: 'settlement.edited', before: current, after: { settlement, hidden_members: kept.hidden } } };
  },
});
