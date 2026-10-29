import { build } from "esbuild";
import { createServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));

const appAssets = path.join(repo, ".wrangler", "app-assets");

const types = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

async function readBody(req, limit = 10_000_000) {
  let body = "";

  for await (const part of req) {
    body += part;

    if (body.length > limit) throw new Error("body_too_large");
  }

  return body;
}

/** The built app's client script, which also carries the many-device host. */
async function hostEntry() {
  const directory = path.join(appAssets, "_expo", "static", "js", "web");
  const files = await readdir(directory).catch(() => []);
  const entry = files.find((name) => /^index-.*\.js$/.test(name));

  if (!entry) throw new Error("frontend_not_built: run npm run frontend:build");

  return readFile(path.join(directory, entry));
}

/** Built app files the host page needs, never anything outside them. */
async function staticAsset(pathname) {
  if (!/^\/(_expo|assets)\//.test(pathname)) return null;
  const file = path.resolve(appAssets, "." + decodeURIComponent(pathname));

  if (!file.startsWith(appAssets + path.sep)) return null;

  return readFile(file)
    .then((content) => ({ content, type: types[path.extname(file)] ?? "application/octet-stream" }))
    .catch(() => null);
}

/** The supervisor's loopback HTTP surface: operations API, lab page, host channel. */
export function createLabServer(lab, port) {
  const origin = `http://127.0.0.1:${port}`;

  lab.labOrigin = origin;

  let uiBundle;

  const bundle = () => uiBundle ??= build({
    entryPoints: [path.join(repo, "lab/ui.mjs")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  }).then((result) => result.outputFiles[0].contents);

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

      if (req.method === "GET" && url.pathname === "/ui.js") {
        res.setHeader("content-type", types[".js"]);
        res.setHeader("cache-control", "no-store");
        res.end(await bundle());

        return;
      }

      if (req.method === "GET" && url.pathname === "/host/entry.js") {
        res.setHeader("content-type", types[".js"]);
        res.setHeader("cache-control", "no-store");
        res.end(await hostEntry());

        return;
      }

      if (req.method === "GET") {
        const asset = await staticAsset(url.pathname);

        if (asset) {
          res.setHeader("content-type", asset.type);
          res.end(asset.content);

          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/host/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        lab.registerHost(res, url.searchParams.get("headless") === "1");

        return;
      }

      if (req.method === "POST" && url.pathname === "/host/result") {
        lab.hostResult(JSON.parse(await readBody(req)));
        res.writeHead(204).end();

        return;
      }

      if (req.method === "POST" && url.pathname === "/host/report") {
        await lab.hostReport(JSON.parse(await readBody(req)));
        res.writeHead(204).end();

        return;
      }

      if (req.method === "POST" && url.pathname === "/host/ready") {
        void lab.hostReady();
        res.writeHead(204).end();

        return;
      }

      if (req.method === "GET" && url.pathname === "/screen") {
        res.setHeader("content-type", "image/png");
        res.setHeader("cache-control", "no-store");
        res.end(await lab.screenshot(url.searchParams.get("device")));

        return;
      }

      if (
        req.method === "POST" &&
        url.pathname === "/api" &&
        req.headers["content-type"] === "application/json"
      ) {
        const { operation, input } = JSON.parse(await readBody(req));

        if (
          !lab.initialized &&
          !["status", "discover", "shutdown"].includes(operation)
        )
          throw new Error("lab_starting");
        const result = await lab.execute(operation, input);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(result));

        if (operation === "shutdown") server.emit("shutdown");

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

  return { server, origin };
}
