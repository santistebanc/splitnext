import { expect, it } from 'vitest';
import type { AuditEvent, ClientReplicaState } from '@splitnext/client';
import { activityTarget, describeActivity } from '../apps/client/src/model/activity';

it('keeps repeated names, quotes and punctuation as literal reference segments', () => {
  // SAFETY: This formatter reads only the supplied change and actor fields.
  const event = { actor_identity_id: 'me', change: { action: 'member.renamed', before: { display_name: 'A "A" \u2192 A' }, after: { display_name: 'A "A" \u2192 A' } } } as AuditEvent;
  // SAFETY: actorLabel only needs the matching identity here.
  const replica = { session: { identity: { id: 'me' } }, projected_snapshot: null } as ClientReplicaState;
  const entry = describeActivity(event, replica);
  expect(entry.what).toBe('renamed A "A" \u2192 A');
  expect(entry.whatSegments).toEqual([{ text: 'renamed ', reference: false }, { text: 'A "A" \u2192 A', reference: true }]);
  expect(entry.detailSegments).toEqual([{ text: 'A "A" \u2192 A', reference: true }, { text: ' \u2192 ', reference: false }, { text: 'A "A" \u2192 A', reference: true }]);
});

it('maps canonical record targets to existing actions without granting availability', () => {
  for (const [kind, name, field] of [['expense', 'showExpense', 'expenseId'], ['settlement', 'showSettlement', 'settlementId'], ['member', 'showPerson', 'memberId']]) {
    // SAFETY: activityTarget reads only the target.
    const target = activityTarget({ target: { kind, id: 'record' } } as AuditEvent);
    expect(target?.name).toBe(name);
    expect(target?.input).toEqual({ [field!]: 'record' });
  }

  // SAFETY: activityTarget reads only the target.
  expect(activityTarget({ target: { kind: 'group', id: 'group' } } as AuditEvent)).toBeNull();
});

it('separates repayment member names from ordinary payment prose', () => {
  // SAFETY: This formatter only reads the settlement member IDs, amount and currency.
  const event = { actor_identity_id: 'me', change: { action: 'settlement.recorded', after: { settlement: { from_member_id: 'a', to_member_id: 'b', amount: 100, currency: 'XXX' } } } } as AuditEvent;
  // SAFETY: Name lookup reads only member IDs and names; attribution matches the identity.
  const replica = { session: { identity: { id: 'me' } }, projected_snapshot: { members: [{ id: 'a', display_name: 'paid' }, { id: 'b', display_name: 'paid' }] } } as ClientReplicaState;
  const entry = describeActivity(event, replica);

  expect(entry.detailSegments.slice(0, 3)).toEqual([{ text: 'paid (1)', reference: true }, { text: ' paid ', reference: false }, { text: 'paid (2)', reference: true }]);
  expect(entry.detailSegments.map((part) => part.text).join('')).toBe(entry.detail);
});
