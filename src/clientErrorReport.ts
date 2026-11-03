import { z } from 'zod';

/**
 * A browser error, reduced to what locates the bug: the error's type, its
 * stack frames, and the page's path. Messages are left out because they can
 * quote what someone typed, so the report holds no names, amounts or links.
 */
export const clientErrorReportSchema = z.object({
  kind: z.enum(['error', 'unhandledrejection']),
  name: z.string().regex(/^[A-Za-z0-9_.$]{1,80}$/),
  frames: z.array(z.string().max(300)).max(20),
  path: z.string().regex(/^\/[A-Za-z0-9/_-]{0,199}$/),
});

export type ClientErrorReport = z.infer<typeof clientErrorReportSchema>;
