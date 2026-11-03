import { z } from 'zod';
import type { ClientErrorReport } from '../../../../src/clientErrorReport';

/** What a thrown value offers when it is an error; anything else is a NonError. */
const thrownSchema = z.object({ name: z.string(), stack: z.string().optional() });

export type Thrown = z.infer<typeof thrownSchema>;

/** Stack lines that are frames in V8 (`at f (url:1:2)`) or Firefox and Safari (`f@url:1:2`). */
const framePattern = /^\s*at .+:\d+:\d+\)?$|^[^\s@]*@\S+:\d+:\d+$/;

/** At most this many reports per page load, so a render loop cannot flood the logs. */
const reportLimit = 5;

/**
 * The report for an error thrown in the browser. Only frame lines of the stack
 * are kept: the message, which can quote what someone typed, is left out.
 */
export function errorReport(
  kind: ClientErrorReport['kind'],
  thrown: Thrown | null,
  path: string,
): ClientErrorReport {
  const name = thrown && /^[A-Za-z0-9_.$]{1,80}$/.test(thrown.name) ? thrown.name : 'NonError';
  const stack = thrown?.stack ?? '';

  return {
    kind,
    name,
    frames: stack
      .split('\n')
      .filter((line) => framePattern.test(line))
      .slice(0, 20)
      .map((line) => line.trim().slice(0, 300)),
    // Ids in the path are fine to log; anything else is cut off.
    path: (/^\/[A-Za-z0-9/_-]{0,199}/.exec(path) ?? ['/'])[0],
  };
}

/** Sends uncaught errors and rejections on this page to the Worker's log. */
export function reportBrowserErrors(baseUrl: string): void {
  const sent = new Set<string>();

  const send = (kind: ClientErrorReport['kind'], parsed: z.ZodSafeParseResult<Thrown>) => {
    const report = errorReport(kind, parsed.success ? parsed.data : null, window.location.pathname);
    const key = `${report.name}\n${report.frames.join('\n')}`;

    if (sent.has(key) || sent.size >= reportLimit) return;
    sent.add(key);

    void fetch(`${baseUrl}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => undefined);
  };

  window.addEventListener('error', (event) => send('error', thrownSchema.safeParse(event.error)));
  window.addEventListener('unhandledrejection', (event) => send('unhandledrejection', thrownSchema.safeParse(event.reason)));
}
