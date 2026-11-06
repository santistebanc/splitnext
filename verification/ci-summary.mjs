import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';

/** Keep numeric results and source locations; assertion messages/DOM/outputs stay private. */
export function testSummary(report, kind, sourceFiles) {
  const location = (file) => {
    const relative = path.isAbsolute(file) ? path.relative(process.cwd(), file) : file;
    const normalized = relative.split(path.sep).join('/');

    if (sourceFiles[normalized]) return normalized;

    if (sourceFiles[`e2e/${normalized}`]) return `e2e/${normalized}`;

    return null;
  };

  const failed = [];
  let total;
  let failedTests;
  let skipped;

  if (kind === 'browser') {
    const visit = (suite) => {
      for (const spec of suite.specs ?? []) {
        const file = location(spec.file);

        if (!spec.ok && file) failed.push({ file, line: Number.isInteger(spec.line) ? spec.line : null });
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

      if (test.status === 'failed' && file) failed.push({ file, line: null });
    }
  }

  return { kind, status: total > 0 ? 'executed' : 'not-run', executed: total, skipped, failedTests: Math.max(failedTests, failed.length), failed };
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
      reports.push({ kind, status: 'not-run', executed: 0, skipped: 0, failedTests: 0, failed: [] });
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
