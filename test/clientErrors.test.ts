import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { errorReport } from '../apps/client/src/model/errorReports';
import app from '../src/app';
import { clientErrorReportSchema, type ClientErrorReport } from '../src/clientErrorReport';

const logLineSchema = z.record(z.string(), z.json());

function thrown(message: string, stack: string): Error {
  const error = new TypeError(message);

  error.stack = stack;

  return error;
}

describe('browser error reports', () => {
  it('keep the error type, stack frames and path, never the message', () => {
    const error = thrown('Cannot read "Private Ana"', [
      'TypeError: Cannot read "Private Ana"',
      'which spans a second line of message',
      '    at renderRow (https://splitnext.test/_expo/static/js/web/entry.js:12:345)',
      '    at https://splitnext.test/_expo/static/js/web/entry.js:67:89',
    ].join('\n'));

    const report = errorReport('error', error, '/join/abc123?x=Private#token');

    expect(report).toEqual({
      kind: 'error',
      name: 'TypeError',
      frames: [
        'at renderRow (https://splitnext.test/_expo/static/js/web/entry.js:12:345)',
        'at https://splitnext.test/_expo/static/js/web/entry.js:67:89',
      ],
      path: '/join/abc123',
    });
    expect(JSON.stringify(report)).not.toContain('Private');
    expect(clientErrorReportSchema.safeParse(report).success).toBe(true);
  });

  it('reports a rejection with something other than an error as a NonError', () => {
    expect(errorReport('unhandledrejection', null, '/app')).toEqual({
      kind: 'unhandledrejection',
      name: 'NonError',
      frames: [],
      path: '/app',
    });
  });

  it('are logged by the Worker with its revision, and malformed ones are refused', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => { lines.push(String(line)); });
    const report = errorReport('error', thrown('x', 'TypeError: x\n    at f (https://splitnext.test/a.js:1:2)'), '/app');

    try {
      const post = (body: ClientErrorReport & { message?: string }) =>
        app.fetch(new Request('https://splitnext.test/client-errors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }), { ...env, LOG_REQUESTS: 'true' });

      expect((await post(report)).status).toBe(204);
      expect((await post({ ...report, name: 'Private Ana' })).status).toBe(400);
      expect((await post({ ...report, message: 'Private Ana' })).status).toBe(204);
    } finally {
      spy.mockRestore();
    }

    const logged = lines.flatMap((line) => {
      const entry = logLineSchema.parse(JSON.parse(line));

      return entry.event === 'client_error' ? [entry] : [];
    });

    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject({ ...report, revision: env.DEPLOY_SHA });
    expect(lines.join('\n')).not.toContain('Private');
  });
});
