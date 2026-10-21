import { z } from 'zod';
import { settlementMemberIds, settlementSchema } from '../settlements';
import { keepNamedMembers } from '../expenses';
import { identifierSchema } from '../ids';
import { defineCommand, rejected, unchanged, type IntentOf } from './define';
import { settlementChangeSchema } from './settlementRecord';
import { groupCommandTypes } from './outcomes';

export const restoreSettlementCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.restoreSettlement),
  payload: z.object({
    settlement_id: identifierSchema,
  }),
});

export type RestoreSettlementCommand = z.output<typeof restoreSettlementCommandSchema>;

export const settlementRestoredAuditSchema = z.object({
  action: z.literal('settlement.restored'),
  before: settlementSchema,
  after: settlementChangeSchema,
});

/**
 * Returns a removed settlement to balances exactly as it was recorded, with its
 * original allocation, even if members it names were removed since.
 */
export const settlementRestore = defineCommand<RestoreSettlementCommand, IntentOf<RestoreSettlementCommand>>({
  requiresServerDecision: false,
  target: (snapshot, identityId, command) => ({ kind: 'settlement', id: command.payload.settlement_id }),
  complete: (commandId, intent) => ({ command_id: commandId, ...intent }),
  retryIntent: (command) => ({ type: command.type, payload: { settlement_id: command.payload.settlement_id } }),
  apply(snapshot, identityId, command, appliedAt) {
    const target = { kind: 'settlement' as const, id: command.payload.settlement_id };
    const current = snapshot.settlements.find((settlement) => settlement.id === command.payload.settlement_id);

    if (!current) return rejected(snapshot, target, 'settlement_not_found');

    if (current.status === 'active') return unchanged(snapshot, target, { kind: 'settlement', settlement: current });

    const settlement = { ...current, status: 'active' as const, version: current.version + 1, updated_at: appliedAt };
    const kept = keepNamedMembers(snapshot, settlementMemberIds(settlement), appliedAt);

    return {
      snapshot: {
        ...snapshot,
        members: kept.members,
        settlements: snapshot.settlements.map((entry) => (entry.id === settlement.id ? settlement : entry)),
      },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'settlement', settlement },
      audit: { action: 'settlement.restored', before: current, after: { settlement, hidden_members: kept.hidden } },
    };
  },
});
