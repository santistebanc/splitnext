import { z } from 'zod';
import { settlementSchema } from '../settlements';
import { identifierSchema } from '../ids';
import { defineCommand, rejected, unchanged, type IntentOf } from './define';
import { groupCommandTypes } from './outcomes';

export const removeSettlementCommandSchema = z.object({
  command_id: identifierSchema,
  type: z.literal(groupCommandTypes.removeSettlement),
  payload: z.object({
    settlement_id: identifierSchema,
  }),
});

export type RemoveSettlementCommand = z.output<typeof removeSettlementCommandSchema>;

export const settlementRemovedAuditSchema = z.object({
  action: z.literal('settlement.removed'),
  before: settlementSchema,
  after: settlementSchema,
});

/**
 * Takes an settlement out of balances, keeping it so it can be restored. It
 * applies whatever version the person saw, since restoring undoes it.
 */
export const settlementRemove = defineCommand<RemoveSettlementCommand, IntentOf<RemoveSettlementCommand>>({
  requiresServerDecision: false,
  target: (snapshot, identityId, command) => ({ kind: 'settlement', id: command.payload.settlement_id }),
  complete: (commandId, intent) => ({ command_id: commandId, ...intent }),
  retryIntent: (command) => ({ type: command.type, payload: { settlement_id: command.payload.settlement_id } }),
  apply(snapshot, identityId, command, appliedAt) {
    const target = { kind: 'settlement' as const, id: command.payload.settlement_id };
    const current = snapshot.settlements.find((settlement) => settlement.id === command.payload.settlement_id);

    if (!current) return rejected(snapshot, target, 'settlement_not_found');

    if (current.status === 'removed') return unchanged(snapshot, target, { kind: 'settlement', settlement: current });

    const settlement = { ...current, status: 'removed' as const, version: current.version + 1, updated_at: appliedAt };

    return {
      snapshot: { ...snapshot, settlements: snapshot.settlements.map((entry) => (entry.id === settlement.id ? settlement : entry)) },
      status: 'applied',
      reason: null,
      target,
      serverState: { kind: 'settlement', settlement },
      audit: { action: 'settlement.removed', before: current, after: settlement },
    };
  },
});
