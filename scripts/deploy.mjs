// Deploys a clean, committed checkout to one environment: builds the app,
// applies D1 migrations there, and stamps the Worker with the commit it runs.
// Usage: node scripts/deploy.mjs staging
import { execFileSync } from 'node:child_process';

const environment = process.argv[2];

if (environment !== 'staging') {
  console.error('Usage: node scripts/deploy.mjs staging');
  process.exit(1);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

if (git('status', '--porcelain')) {
  console.error('Commit or stash your changes first, so the deployed commit is the one running.');
  process.exit(1);
}

const sha = git('rev-parse', '--short', 'HEAD');

const run = (command, args) => execFileSync(command, args, { stdio: 'inherit', shell: true });

run('npm', ['run', 'frontend:build']);

run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'INDEX', '--remote', '--env', environment]);

run('npx', ['wrangler', 'deploy', '--env', environment, '--var', `DEPLOY_SHA:${sha}`]);

console.log(`Deployed ${sha} to ${environment}.`);
