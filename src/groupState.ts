import { z } from 'zod';
import { deviceUserIdSchema } from './accessCredential';
import { memberDisplayNameSchema } from './memberDirectory';

export const groupNameSchema = z.string().trim().min(1).max(100);

export const currencyLabelSchema = z.string().trim().min(1).max(16);

export const groupVersionSchema = z.number().int().positive();

export const groupSchema = z.object({
  id: z.uuid(),
  version: groupVersionSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
  name: groupNameSchema,
  currency_label: currencyLabelSchema,
});

export type Group = z.infer<typeof groupSchema>;

/** The complete command accepted by the Durable Object when a group begins. */
export const createGroupInputSchema = z
  .object({
    name: groupNameSchema,
    currency_label: currencyLabelSchema.default('EUR'),
    device_user_id: deviceUserIdSchema,
    creator_display_name: memberDisplayNameSchema,
  })
  .strict();

export type CreateGroupInput = z.infer<typeof createGroupInputSchema>;

export const updateGroupInputSchema = z
  .object({
    expected_version: groupVersionSchema,
    name: groupNameSchema.optional(),
    currency_label: currencyLabelSchema.optional(),
  })
  .strict()
  .refine(
    ({ name, currency_label }) =>
      name !== undefined || currency_label !== undefined,
    { message: 'At least one editable field is required.' },
  );

export type UpdateGroupInput = z.infer<typeof updateGroupInputSchema>;

export const deleteGroupInputSchema = z
  .object({ expected_version: groupVersionSchema })
  .strict();

export type DeleteGroupInput = z.infer<typeof deleteGroupInputSchema>;

type CreateGroupStateInput = Pick<
  CreateGroupInput,
  'name' | 'currency_label'
>;

export type CreateStoredGroupResult =
  | { ok: true; group: Group }
  | { ok: false; error: 'group_exists' };

export type GroupMutationResult =
  | { ok: true; group: Group }
  | { ok: false; error: 'version_conflict' };

type GroupChanges = {
  name?: string | undefined;
  currency_label?: string | undefined;
  deleted?: boolean | undefined;
};

/** Owns one group's persisted shape, version policy, and tombstone lifecycle. */
export class GroupState {
  constructor(private readonly sql: SqlStorage) {}

  create(groupId: string, input: CreateGroupStateInput): CreateStoredGroupResult {
    if (this.retrieve()) return { ok: false, error: 'group_exists' };

    const createdAt = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO group_state
        (singleton, id, version, created_at, updated_at, deleted_at, name, currency_label)
       VALUES (1, ?, 1, ?, ?, NULL, ?, ?)`,
      groupId,
      createdAt,
      createdAt,
      input.name,
      input.currency_label,
    );

    const group = this.retrieve();

    if (!group) throw new Error('group_insert_failed');

    return { ok: true, group };
  }

  retrieve(): Group | null {
    const row = this.sql
      .exec<Group>(
        `SELECT id, version, created_at, updated_at, deleted_at, name, currency_label
         FROM group_state
         WHERE singleton = 1`,
      )
      .toArray()[0];

    return row ?? null;
  }

  update(group: Group, input: UpdateGroupInput): GroupMutationResult {
    if (group.version !== input.expected_version) {
      return { ok: false, error: 'version_conflict' };
    }

    const name = input.name ?? group.name;
    const currencyLabel = input.currency_label ?? group.currency_label;

    if (name === group.name && currencyLabel === group.currency_label) {
      return { ok: true, group };
    }

    return this.commit(group, { name, currency_label: currencyLabel });
  }

  remove(group: Group, input: DeleteGroupInput): GroupMutationResult {
    if (group.version !== input.expected_version) {
      return { ok: false, error: 'version_conflict' };
    }

    return this.commit(group, { deleted: true });
  }

  private commit(group: Group, changes: GroupChanges): GroupMutationResult {
    const at = new Date().toISOString();

    this.sql.exec(
      `UPDATE group_state
       SET version = version + 1,
           updated_at = ?,
           name = ?,
           currency_label = ?,
           deleted_at = ?
       WHERE singleton = 1`,
      at,
      changes.name ?? group.name,
      changes.currency_label ?? group.currency_label,
      changes.deleted === true ? at : group.deleted_at,
    );

    const mutated = this.retrieve();

    if (!mutated) throw new Error('group_mutation_failed');

    return { ok: true, group: mutated };
  }
}
