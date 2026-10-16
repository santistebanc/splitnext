import { z } from 'zod';

import { viewNames } from '../model/uiState';

/** Browser history entries the app writes, read back on Back and Forward. */
export const navigationSchema = z.object({
  splitnext: z.literal(true),
  view: z.enum(viewNames),
  groupId: z.string().nullable(),
});
