import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Lab } from "./runtime.mjs";
import { createLabServer } from "./http.mjs";

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")),
);

const environment = options.env ?? "default";

if (!/^[a-zA-Z0-9_-]{1,48}$/.test(environment))
  throw new Error("invalid_environment");

const port = Number(options.port ?? 8796);

const workerPort = Number(options.workerPort ?? 8797);

if (
  ![port, workerPort].every(
    (p) =>
      Number.isInteger(p) &&
      p >= 1024 &&
      p <= 65535 &&
      ![8787, 8791, 8793].includes(p),
  ) ||
  port === workerPort
)
  throw new Error("unsafe_ports");

const repo = fileURLToPath(new URL("../", import.meta.url));

process.chdir(repo);

const root = path.join(repo, ".wrangler", "lab", environment);

await mkdir(root, { recursive: true });

const lockPath = path.join(root, "supervisor.lock");

let lock;

try {
  lock = await open(lockPath, "wx");
} catch {
  throw new Error(
    `environment_locked: ${lockPath}; if a previous supervisor crashed, verify its PID is dead before removing the lock`,
  );
}

await lock.writeFile(JSON.stringify({ pid: process.pid, port, workerPort }));

const hostMode = options.host ?? "auto";

if (!["auto", "headless", "tab"].includes(hostMode))
  throw new Error("invalid_host_mode");

const lab = new Lab(root, workerPort, { host: hostMode });

const { server, origin } = createLabServer(lab, port);

server.on("shutdown", () => {
  void close().then(() => process.exit());
});

let closing = false;

async function close() {
  if (closing) return;
  closing = true;
  server.close();
  await lab.tail;
  await lab.close();
  await lock.close();
  await rm(lockPath);
}

process.once("SIGINT", () => {
  void close().then(() => process.exit());
});

process.once("SIGTERM", () => {
  void close().then(() => process.exit());
});

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await lab.init();
  console.log(
    `Splitnext lab: ${origin} — environment ${environment}; Worker ${lab.base}`,
  );
} catch (error) {
  console.error(error);
  await close();
  throw error;
}
