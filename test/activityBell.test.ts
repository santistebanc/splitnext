import { describe, expect, it } from 'vitest';
import type { AuditChange, AuditEvent } from '../src/domain/audit';
import type { Expense } from '../src/domain/expenses';
import { affectsBalances } from '../apps/client/src/model/activity';

const lunch: Expense = {
  id: 'expense-1',
  description: 'Lunch',
  currency: 'EUR',
  total: 2000,
  paid: [{ member_id: 'ana', amount: 2000 }],
  parts: [{ member_id: 'ana', kind: 'shares', shares: 1 }, { member_id: 'ben', kind: 'shares', shares: 1 }],
  allocations: [{ member_id: 'ana', amount: 1000 }, { member_id: 'ben', amount: 1000 }],
  extras: [],
  status: 'active',
  version: 1,
  created_at: '2026-10-28T10:00:00.000Z',
  updated_at: '2026-10-28T10:00:00.000Z',
};

function event(change: { action: AuditChange['action']; before?: Expense | null; after?: Expense | { expense: Expense } }): AuditEvent {
  // SAFETY: affectsBalances reads only the change's action, and an edited expense's before and after.
  return { change: change as AuditChange } as AuditEvent;
}

function edit(after: Partial<Expense>) {
  return event({ action: 'expense.edited', before: lunch, after: { expense: { ...lunch, ...after, version: 2 } } });
}

describe('the Activity bell', () => {
  it('counts expenses and repayments that move balances', () => {
    expect(affectsBalances(event({ action: 'expense.recorded', before: null, after: { expense: lunch } }))).toBe(true);
    expect(affectsBalances(event({ action: 'expense.removed', before: lunch, after: lunch }))).toBe(true);
    expect(affectsBalances(event({ action: 'settlement.recorded' }))).toBe(true);
    expect(affectsBalances(event({ action: 'settlement.edited' }))).toBe(true);
    expect(affectsBalances(edit({ total: 2500 }))).toBe(true);
    expect(affectsBalances(edit({ paid: [{ member_id: 'ben', amount: 2000 }] }))).toBe(true);
    expect(affectsBalances(edit({ parts: [{ member_id: 'ana', kind: 'shares', shares: 1 }] }))).toBe(true);
  });

  it('leaves out a description-only edit and changes to the group or its people', () => {
    expect(affectsBalances(edit({ description: 'Dinner' }))).toBe(false);
    expect(affectsBalances(event({ action: 'group.renamed' }))).toBe(false);
    expect(affectsBalances(event({ action: 'member.created' }))).toBe(false);
    expect(affectsBalances(event({ action: 'member.renamed' }))).toBe(false);
    expect(affectsBalances(event({ action: 'group.joined' }))).toBe(false);
  });
});
