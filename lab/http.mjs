import { build } from "esbuild";
import { createServer } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
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

const entryDirectory = path.join(appAssets, "_expo", "static", "js", "web");

/** The built app's client script, which also carries the many-device host and a device's frame. */
async function entryName() {
  const files = await readdir(entryDirectory).catch(() => []);
  const entry = files.find((name) => /^index-.*\.js$/.test(name));

  if (!entry) throw new Error("frontend_not_built: run npm run frontend:build");

  return entry;
}

async function hostEntry() {
  return readFile(path.join(entryDirectory, await entryName()));
}

/**
 * The page inside each in-page device's frame. It loads the app's script by its
 * content-hashed name, so every frame after the first reads it from the cache.
 */
async function framePage() {
  const script = `/_expo/static/js/web/${await entryName()}`;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lab device</title></head>
<body>
<script>window.splitnextLabFramePage = true;</script>
<script src="${script}"></script>
</body>
</html>`;
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

  // The page is read fresh on every request, so the script it loads must follow
  // edits too: rebuild whenever a bundled lab source file changed.
  const stampOf = async (sources) =>
    (
      await Promise.all(
        sources.map((file) => stat(file).then((info) => info.mtimeMs, () => 0)),
      )
    ).join(",");

  const rebuild = async () => {
    const result = await build({
      entryPoints: [path.join(repo, "lab/ui.mjs")],
      bundle: true,
      write: false,
      metafile: true,
      format: "esm",
      platform: "browser",
      define: { "process.env.NODE_ENV": '"production"' },
    });

    const sources = Object.keys(result.metafile.inputs)
      .filter((input) => !input.includes("node_modules"))
      .map((input) => path.resolve(repo, input));

    return {
      contents: result.outputFiles[0].contents,
      sources,
      stamp: await stampOf(sources),
    };
  };

  const bundle = async () => {
    const pending = (uiBundle ??= rebuild());

    // A failed build (say, a syntax error mid-edit) is retried on the next request.
    pending.catch(() => uiBundle === pending && (uiBundle = undefined));

    const current = await pending;

    if ((await stampOf(current.sources)) === current.stamp) return current.contents;

    if (uiBundle === pending) uiBundle = undefined;

    return bundle();
  };

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

      if (req.method === "GET" && url.pathname === "/host/frame") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(await framePage());

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

          // Built scripts are named by their content, so they never change.
          if (url.pathname.startsWith("/_expo/static/")) res.setHeader("cache-control", "public, max-age=31536000, immutable");
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
