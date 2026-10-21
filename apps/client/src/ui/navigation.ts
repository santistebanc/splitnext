import { z } from 'zod';

import { groupViews, viewNames } from '../model/uiState';

/** Browser history entries the app writes, read back on Back and Forward. */
export const navigationSchema = z.object({
  splitnext: z.literal(true),
  view: z.enum(viewNames),
  trail: z.array(z.enum(groupViews)).optional(),
  person: z.string().nullable().optional(),
  groupId: z.string().nullable(),
});
