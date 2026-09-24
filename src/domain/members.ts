import { z } from 'zod';
import { identifierSchema } from './ids';

export const memberNameSchema = z.string().trim().min(1).max(100);

export const ledgerMemberSchema = z.object({
  id: identifierSchema,
  display_name: z.string(),
  status: z.enum(['active', 'archived']),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export type LedgerMember = z.output<typeof ledgerMemberSchema>;

export function memberNameKey(displayName: string): string {
  return displayName.normalize('NFKC').toLowerCase();
}
