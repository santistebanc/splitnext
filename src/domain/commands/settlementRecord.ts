import { z } from 'zod';
import { identifierSchema } from '../ids';
import { ledgerMemberSchema } from '../members';
import { keepNamedMembers } from '../expenses';
import { settlementEntry, settlementEntrySchema, settlementProblem, settlementSchema } from '../settlements';
import { defineCommand, rejected, type IntentOf } from './define';

export const recordSettlementCommandSchema = z.object({
  command_id: identifierSchema, type: z.literal('settlement.record'),
  payload: settlementEntrySchema.extend({ settlement_id: identifierSchema }),
});

type Command = z.output<typeof recordSettlementCommandSchema>;

export const settlementChangeSchema = z.object({ settlement: settlementSchema, hidden_members: z.array(ledgerMemberSchema) });

export const settlementRecordedAuditSchema = z.object({ action: z.literal('settlement.recorded'), before: z.null(), after: settlementChangeSchema });

export const settlementRecord = defineCommand<Command, IntentOf<Command, 'settlement_id'>>({
  requiresServerDecision: false,
  target: (snapshot, identity, command) => ({ kind: 'settlement', id: command.payload.settlement_id }),
  complete: (id, intent, snapshot, createId) => ({ command_id: id, type: intent.type, payload: { ...settlementEntry(intent.payload), settlement_id: intent.payload.settlement_id ?? createId() } }),
  retryIntent: (command) => ({ type: command.type, payload: settlementEntry(command.payload) }),
  apply(snapshot, identity, command, at) {
    const target = { kind: 'settlement' as const, id: command.payload.settlement_id };
    const existing = snapshot.settlements.find((item) => item.id === target.id);

    if (existing) return { ...rejected(snapshot, target, 'settlement_id_exists'), serverState: { kind: 'settlement', settlement: existing } };
    const entry = settlementEntry(command.payload);
    const problem = settlementProblem(snapshot, entry);

    if (problem) return rejected(snapshot, target, problem);
    const settlement = { ...entry, id: target.id, status: 'active' as const, version: 1, created_at: at, updated_at: at };
    const kept = keepNamedMembers(snapshot, [entry.from_member_id, entry.to_member_id], at);

    return { snapshot: { ...snapshot, members: kept.members, settlements: [...snapshot.settlements, settlement] }, status: 'applied', reason: null, target,
      serverState: { kind: 'settlement', settlement }, audit: { action: 'settlement.recorded', before: null, after: { settlement, hidden_members: kept.hidden } } };
  },
});
