import { connect } from 'node:net';

const port = 8787;

// Windows lets a second wrangler bind a port that is already taken, and the
// rebuild that precedes it reloads the running server mid-write. Either leaves
// the port accepting connections without answering, so refuse to start.
function listening(host) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });

    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

if ((await listening('127.0.0.1')) || (await listening('::1'))) {
  console.error(
    `Port ${port} is already in use, probably by another \`npm run dev\` in this checkout.\n` +
      `Use the running server at http://localhost:${port}/, or stop it before starting another.`,
  );
  process.exit(1);
}
