import { z } from 'zod';

export const viewNames = [
  'home',
  'create',
  'join',
  'invite',
  'settings',
  'notices',
  'rejoin',
] as const;

export type ViewName = (typeof viewNames)[number];

export type Navigate = (view: ViewName) => void;

/** Browser history entries the app writes, read back on Back and Forward. */
export const navigationSchema = z.object({
  splitnext: z.literal(true),
  view: z.enum(viewNames),
  groupId: z.string().nullable(),
});
