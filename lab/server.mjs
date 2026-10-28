import { createServer } from "node:http";
import { mkdir, readFile, open, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Lab } from "./runtime.mjs";

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

const lab = new Lab(root, workerPort);

const origin = `http://127.0.0.1:${port}`;

const server = createServer(async (req, res) => {
  try {
    if (
      req.headers.host !== `127.0.0.1:${port}` ||
      (req.headers.origin && req.headers.origin !== origin)
    ) {
      res.writeHead(403).end();

      return;
    }

    const url = new URL(req.url, origin);

    if (req.method === "GET" && url.pathname === "/font.woff2") {
      res.setHeader("content-type", "font/woff2");
      res.end(
        await readFile(
          new URL(
            "../apps/client/public/assets/instrument-sans.woff2",
            import.meta.url,
          ),
        ),
      );

      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(await readFile(new URL("./ui.html", import.meta.url)));

      return;
    }

    if (req.method === "GET" && url.pathname === "/screen") {
      const page = lab.device(url.searchParams.get("device")).page;
      res.setHeader("content-type", "image/png");
      res.setHeader("cache-control", "no-store");
      res.end(await page.screenshot());

      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api" &&
      req.headers["content-type"] === "application/json"
    ) {
      let body = "";

      for await (const part of req) {
        body += part;

        if (body.length > 10_000_000) throw new Error("body_too_large");
      }

      const { operation, input } = JSON.parse(body);

      if (
        !lab.initialized &&
        !["status", "discover", "shutdown"].includes(operation)
      )
        throw new Error("lab_starting");
      const result = await lab.execute(operation, input);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(result));

      if (operation === "shutdown") void close().then(() => process.exit());

      return;
    }

    res.writeHead(404).end();
  } catch (error) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: String(error), diagnostics: error.diagnostics }),
    );
  }
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
