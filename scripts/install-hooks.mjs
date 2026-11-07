// Points git at the tracked hooks in `.githooks` when dependencies are
// installed. CI and copies outside a git work tree have nothing to install.
import { execFileSync } from 'node:child_process';

if (!process.env.CI) {
  try {
    let current = '';

    try { current = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim(); } catch { /* Unset hooks use the repository defaults. */ }

    // An owner-managed hook chain supplies delivery coordination. Preserve it.
    if (!current || current === '.githooks') execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  } catch {
    // Not a git work tree, or no git: pushes cannot run hooks here anyway.
  }
}
