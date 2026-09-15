import { z } from '@hono/zod-openapi';

export const memberSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  deleted_at: z.iso.datetime().nullable(),
  display_name: z.string(),
});

export type Member = z.infer<typeof memberSchema>;

export type CreateMemberInput = {
  display_name: string;
};

export type UpdateMemberInput = {
  expected_version: number;
  display_name: string;
};

export type DeleteMemberInput = {
  expected_version: number;
};
