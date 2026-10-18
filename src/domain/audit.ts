import { z } from 'zod';
import { expenseEditedAuditSchema } from './commands/expenseEdit';
import { expenseRecordedAuditSchema } from './commands/expenseRecord';
import { expenseRemovedAuditSchema } from './commands/expenseRemove';
import { expenseRestoredAuditSchema } from './commands/expenseRestore';
import { groupLeftAuditSchema } from './commands/groupLeave';
import { groupRenamedAuditSchema } from './commands/groupRename';
import { memberCreatedAuditSchema } from './commands/memberCreate';
import { memberRemovedAuditSchema } from './commands/memberRemove';
import { memberRenamedAuditSchema } from './commands/memberRename';
import { memberRestoredAuditSchema } from './commands/memberRestore';
import { commandTargetSchema } from './commands/outcomes';
import { preferenceChangedAuditSchema } from './commands/preferenceSet';
import { createdGroupSchema, groupAccessGrantSchema } from './groups';
import { identifierSchema } from './ids';
import { inviteRecordSchema, inviteMetadataSchema } from './invites';
import { ledgerMemberSchema } from './members';

const joinedStateSchema = z.object({
  access: groupAccessGrantSchema,
  created_member: ledgerMemberSchema.nullable(),
});

/** Every applied transition's change; each group command defines its own in ./commands/. */
export const auditChangeSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('group.created'),
    before: z.null(),
    after: createdGroupSchema.extend({ invite: inviteMetadataSchema }),
  }),
  z.object({
    action: z.literal('group.joined'),
    before: z.null(),
    after: joinedStateSchema,
  }),
  z.object({
    action: z.literal('group.rejoined'),
    before: groupAccessGrantSchema,
    after: joinedStateSchema,
  }),
  groupRenamedAuditSchema,
  memberCreatedAuditSchema,
  memberRenamedAuditSchema,
  memberRemovedAuditSchema,
  memberRestoredAuditSchema,
  expenseRecordedAuditSchema,
  expenseEditedAuditSchema,
  expenseRemovedAuditSchema,
  expenseRestoredAuditSchema,
  preferenceChangedAuditSchema,
  groupLeftAuditSchema,
  z.object({
    action: z.literal('invite.created'),
    // Creating a link revokes the previous one, which is recorded here.
    before: inviteRecordSchema.nullable(),
    after: inviteRecordSchema,
  }),
]);

export const newAuditEventSchema = z.object({
  id: identifierSchema,
  revision: z.number().int().positive(),
  change: auditChangeSchema,
  command_id: identifierSchema.nullable(),
  actor_identity_id: identifierSchema,
  actor_handle: z.string(),
  actor_member_name: z.string().nullable(),
  target: commandTargetSchema,
  occurred_at: z.iso.datetime(),
});

export const auditEventSchema = newAuditEventSchema.extend({
  sequence: z.number().int().positive(),
});

export type AuditChange = z.output<typeof auditChangeSchema>;

export type NewAuditEvent = z.output<typeof newAuditEventSchema>;

export type AuditEvent = z.output<typeof auditEventSchema>;

export type AuditAttribution = Omit<NewAuditEvent, 'id' | 'change'>;

export interface AuditEventStore {
  appendAudit(event: NewAuditEvent): AuditEvent;
  readAudit(): AuditEvent[];
}

/** Owns canonical audit-event construction, validation, and ordered reading. */
export class AuditHistory {
  constructor(
    private readonly store: AuditEventStore,
    private readonly createId: () => string,
  ) {}

  record(change: AuditChange, attribution: AuditAttribution): AuditEvent {
    return auditEventSchema.parse(
      this.store.appendAudit(
        newAuditEventSchema.parse({
          id: this.createId(),
          change,
          ...attribution,
        }),
      ),
    );
  }

  read(): AuditEvent[] {
    return this.store.readAudit().map((event) => auditEventSchema.parse(event));
  }
}
