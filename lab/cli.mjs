import { readFile } from "node:fs/promises";

const [operation = "discover", argument = "{}"] = process.argv.slice(2);

if (operation === "--help") {
  console.log(
    "Start: npm run lab -- --env=NAME --port=8796 --workerPort=8797\nUse: npm run lab:cli -- OPERATION JSON (or @file.json)\nLAB_URL defaults to http://127.0.0.1:8796; discover returns input schemas.",
  );
} else {
  const url = new URL(process.env.LAB_URL ?? "http://127.0.0.1:8796");

  if (url.hostname !== "127.0.0.1" || url.protocol !== "http:")
    throw new Error("local_lab_only");

  const input = JSON.parse(
    argument.startsWith("@")
      ? await readFile(argument.slice(1), "utf8")
      : argument,
  );

  const response = await fetch(new URL("/api", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, input }),
  });

  console.log(JSON.stringify(await response.json(), null, 2));

  if (!response.ok) process.exitCode = 1;
}
