import { z } from 'zod';
import { commandTargetSchema } from './commands';
import {
  createdGroupSchema,
  groupAccessGrantSchema,
  groupDetailsSchema,
} from './groups';
import { identifierSchema } from './ids';
import { ledgerMemberSchema } from './members';

const joinedStateSchema = z.object({
  access: groupAccessGrantSchema,
  created_member: ledgerMemberSchema.nullable(),
});

const archivedMemberStateSchema = z.object({
  member: ledgerMemberSchema,
  preferred_by: z.array(identifierSchema),
});

export const auditChangeSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('group.created'),
    before: z.null(),
    after: createdGroupSchema,
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
  z.object({
    action: z.literal('group.renamed'),
    before: groupDetailsSchema,
    after: groupDetailsSchema,
  }),
  z.object({
    action: z.literal('member.created'),
    before: z.null(),
    after: ledgerMemberSchema,
  }),
  z.object({
    action: z.literal('member.renamed'),
    before: ledgerMemberSchema,
    after: ledgerMemberSchema,
  }),
  z.object({
    action: z.literal('member.archived'),
    before: archivedMemberStateSchema,
    after: archivedMemberStateSchema,
  }),
  z.object({
    action: z.literal('preference.changed'),
    before: groupAccessGrantSchema,
    after: groupAccessGrantSchema,
  }),
  z.object({
    action: z.literal('group.left'),
    before: groupAccessGrantSchema,
    after: groupAccessGrantSchema,
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

export type AuditAttribution = Omit<
  NewAuditEvent,
  'id' | 'change'
>;

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
