import { spawn } from 'node:child_process';

/** Only terminate the process tree this invocation started. Never inspect/kill a listener. */
export async function stopOwned(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }

    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);

    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
}

export async function runOwned(args, { timeoutMs, output, env = process.env }) {
  const child = spawn(process.execPath, args, {
    windowsHide: true, detached: process.platform !== 'win32',
    env: { ...env, WRANGLER_SEND_METRICS: 'false', EXPO_NO_TELEMETRY: '1' },
    stdio: ['ignore', output, output],
  });

  let interrupted = false;
  const abort = () => { interrupted = true; void stopOwned(child); };

  const timer = setTimeout(abort, timeoutMs);

  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);

  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });

    if (interrupted) throw new Error('owned_process_interrupted_or_timed_out');

    return code;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    await stopOwned(child);
  }
}
