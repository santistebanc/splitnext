import path from 'node:path';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';

// Runtime messages (expected/received values, locators, call logs, error text)
// can hold credentials, URLs or personal data, so none of their text is
// published. Diagnostics are extracted instead: identifiers matched by strict
// patterns, timeouts as numbers, and locations and lines of tracked repository
// source, whose text is already visible to anyone who can read the evidence.
const maxListed = 20;

// oxlint-disable-next-line no-control-regex -- removing terminal escapes and control characters is the point
const terminalText = /\u001b\[[0-9;]*[A-Za-z]|[\u0000-\u0008\u000b-\u001f\u007f]/g;

const plain = (text) => String(text ?? '').replace(terminalText, '');

const firstLine = (text) => plain(text).split('\n', 1)[0] ?? '';

function oneLine(text, limit) {
  const compact = plain(text).replace(/\s+/g, ' ').trim();

  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

function readSource(file) {
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}

/** What kind of failure a runtime message describes, as identifiers and numbers only. */
export function failureKind(message) {
  const text = plain(message);
  const head = firstLine(message);

  const matcher = /expect\((?:locator|page|received)\)\.(?:not\.)?(to[A-Z][A-Za-z]*)\(/.exec(head)?.[1]
    ?? (text.includes('__VITEST_POLL_CHAIN__') ? 'expect.poll' : null);
  // Playwright reports a timed-out action on a later error than the timeout itself.

  const action = /^Error: ((?:locator|page|frame|context|browser)\.[a-zA-Z]+):/m.exec(text)?.[1] ?? null;
  const errorType = /^([A-Z][A-Za-z]*Error)\b/.exec(head)?.[1] ?? null;
  const testTimeout = /Test timeout of (\d+)ms exceeded|Test timed out in (\d+)ms/.exec(text);
  const expectTimeout = /^Timeout: +(\d+)ms$/m.exec(text);
  const timeoutMs = Number(testTimeout?.[1] ?? testTimeout?.[2] ?? expectTimeout?.[1]) || null;

  // Vitest's JSON report keeps a test or hook timeout only as the stack captured where the test was declared.
  if (testTimeout || head === 'Error: STACK_TRACE_ERROR') return { kind: 'test-timeout', matcher: null, action, errorType: null, timeoutMs };

  if (matcher || errorType === 'AssertionError') return { kind: 'assertion', matcher, action: null, errorType, timeoutMs };

  if (errorType) return { kind: 'error', matcher: null, action, errorType, timeoutMs: null };

  return { kind: 'unknown', matcher: null, action: null, errorType: null, timeoutMs: null };
}

/** Keep counts and allowlisted diagnostics; runtime message text, DOM and outputs stay private. */
export function testSummary(report, kind, sourceFiles, read = readSource) {
  const tracked = (file) => Boolean(sourceFiles[file]) && sourceFiles[file] !== 'deleted';

  const location = (file) => {
    if (!file) return null;
    const relative = path.isAbsolute(file) ? path.relative(process.cwd(), file) : file;
    const normalized = relative.split(path.sep).join('/');

    if (tracked(normalized)) return normalized;

    if (tracked(`e2e/${normalized}`)) return `e2e/${normalized}`;

    return null;
  };

  const sources = new Map();

  const contents = (file) => {
    if (!sources.has(file)) sources.set(file, read(file));

    return sources.get(file);
  };
  // The first stack frame in tracked source, skipping dependencies.

  const stackLocation = (message) => {
    for (const match of plain(message).matchAll(/([A-Za-z]:[\\/][^\s():]+|\/[^\s():]+|[\w.-]+(?:[\\/][\w.-]+)+):(\d+):\d+/g)) {
      const file = location(match[1]);

      if (file) return { file, line: Number(match[2]) };
    }

    return null;
  };

  const sourceLine = (at) => {
    const text = at ? contents(at.file)?.split(/\r?\n/)[at.line - 1] : undefined;

    return text === undefined ? null : oneLine(text, 200) || null;
  };
  // A title is published only when its file spells out every part (describe and test titles), so runtime values interpolated into it stay private.

  const title = (file, parts) => (parts.length > 0 && parts.every((part) => part && contents(file)?.includes(part)) ? oneLine(parts.join(' '), 160) : null);

  const reproduce = (file, line, name) => {
    if (kind === 'browser') return `npm run frontend:build && npx playwright test ${line ? `${file}:${line}` : file}`;

    if (kind === 'performance') return 'npm run test:performance';

    return `npx vitest run ${file}${name ? ` -t ${JSON.stringify(name)}` : ''}`;
  };

  const diagnosis = (file, line, name, message, structured) => {
    const at = structured ?? stackLocation(message);
    const shownTitle = title(file, name);

    return { file, line, title: shownTitle, ...failureKind(message), at, source: sourceLine(at), reproduce: reproduce(file, line, shownTitle) };
  };

  const failed = [];
  let total;
  let failedTests;
  let skipped;

  if (kind === 'browser') {
    const visit = (suite) => {
      for (const spec of suite.specs ?? []) {
        const file = location(spec.file);

        if (spec.ok || !file) continue;
        const result = (spec.tests ?? []).flatMap((test) => test.results ?? []).findLast((candidate) => !['passed', 'skipped'].includes(candidate.status));
        const errors = result?.errors ?? [];
        const located = errors.find((error) => location(error.location?.file) && Number.isInteger(error.location?.line));
        const at = located ? { file: location(located.location.file), line: located.location.line } : null;

        failed.push(diagnosis(file, Number.isInteger(spec.line) ? spec.line : null, [spec.title], errors.map((error) => error.message ?? '').join('\n'), at));
      }

      for (const nested of suite.suites ?? []) visit(nested);
    };

    for (const suite of report.suites ?? []) visit(suite);
    total = (report.stats?.expected ?? 0) + (report.stats?.unexpected ?? 0) + (report.stats?.flaky ?? 0);
    failedTests = (report.stats?.unexpected ?? 0) + (report.stats?.flaky ?? 0);
    skipped = report.stats?.skipped ?? 0;
  } else {
    total = (report.numPassedTests ?? 0) + (report.numFailedTests ?? 0);
    failedTests = report.numFailedTests ?? 0;
    skipped = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);

    for (const test of report.testResults ?? []) {
      const file = location(test.name);

      if (test.status !== 'failed' || !file) continue;
      const assertions = (test.assertionResults ?? []).filter((assertion) => assertion.status === 'failed');

      // A file can fail without failed tests, as when it cannot be imported.
      if (assertions.length === 0) failed.push(diagnosis(file, null, [], test.message, null));

      for (const assertion of assertions)
        failed.push(diagnosis(file, null, [...(assertion.ancestorTitles ?? []), assertion.title], (assertion.failureMessages ?? []).join('\n'), null));
    }
  }

  return { kind, status: total > 0 ? 'executed' : 'not-run', executed: total, skipped, failedTests: Math.max(failedTests, failed.length),
    failed: failed.slice(0, maxListed), omitted: Math.max(0, failed.length - maxListed) };
}

const annotationText = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const annotationProperty = (text) => annotationText(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** Readable lines and GitHub annotations, built only from the published fields. */
export function failureLines(reports) {
  const output = [];

  for (const report of reports) {
    for (const failure of report.failed ?? []) {
      const at = failure.at ?? { file: failure.file, line: failure.line };
      const detail = [failure.kind, failure.matcher ?? failure.action ?? failure.errorType, failure.timeoutMs ? `after ${failure.timeoutMs}ms` : null];
      const summary = `${report.kind}: ${failure.title ?? '(title withheld)'}: ${detail.filter(Boolean).join(' ')}`;

      output.push(`::error file=${annotationProperty(at.file)}${at.line ? `,line=${at.line}` : ''},title=${annotationProperty(`${report.kind} test failed`)}::${annotationText(summary)}`);
      output.push(`FAIL ${failure.file}${failure.line ? `:${failure.line}` : ''} ${summary}`);

      if (failure.at) output.push(`  at ${failure.at.file}:${failure.at.line}${failure.source ? `  ${failure.source}` : ''}`);
      output.push(`  reproduce: ${failure.reproduce}`);
    }

    if (report.omitted > 0) output.push(`${report.kind}: ${report.omitted} more failures are only in the private report`);
  }

  return output;
}

export async function ciReports(job, steps, source) {
  const reports = [];
  const configs = job === 'check' ? [['unit', 'unit-results.json'], ['performance', 'performance-results.json']] : [['browser', 'browser-results.json']];
  const completed = steps[job === 'check' ? 'checks' : 'browsers']?.outcome === 'success';

  for (const [kind, name] of configs) {
    try {
      const raw = JSON.parse(await readFile(path.join('.wrangler/verification/private', name), 'utf8'));

      reports.push(testSummary(raw, kind, source.files));
    } catch {
      reports.push({ kind, status: 'not-run', executed: 0, skipped: 0, failedTests: 0, failed: [], omitted: 0 });
    }
  }

  let scenarios = null;

  if (job === 'browser') {
    const receipts = [];

    for (const file of await readdir('.wrangler/verification/public').catch(() => [])) {
      if (file.endsWith('.ci.json')) continue;
      const receipt = JSON.parse(await readFile(path.join('.wrangler/verification/public', file), 'utf8'));

      if (receipt.scenario === 'expense-recovery' && receipt.source?.commit === source.commit && receipt.source?.fingerprint === source.fingerprint) receipts.push(receipt);
    }

    scenarios = {
      expenseRecovery: receipts.some((receipt) => receipt.status === 'passed' && receipt.cleanup === 'completed'),
      realPathControl: receipts.some((receipt) => receipt.status === 'failed' && receipt.negativeControl?.injected === true &&
        receipt.failure?.check === 'outbox-survives-reload' && receipt.cleanup === 'completed'),
    };
  }

  const complete = reports.every((report) => report.executed > 0) && (scenarios === null || (scenarios.expenseRecovery && scenarios.realPathControl));

  return { reports, scenarios, complete, passed: complete && reports.every((report) => report.failedTests === 0), stepClaimedSuccess: completed };
}
