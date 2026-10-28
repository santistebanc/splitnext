import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Lab } from "./runtime.mjs";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(".wrangler/lab", `test-${Date.now()}`);

await mkdir(root, { recursive: true });

const lab = new Lab(root, Number(process.env.LAB_TEST_WORKER_PORT ?? 8817));

const op = (name, input = {}) => lab.execute(name, input);

const action = async (device, name, input = {}) => {
  const result = await op("action", { device, name, input });
  assert.equal(result.status, "done", JSON.stringify(result));
};

try {
  await lab.init();
  await op("addDevice", { device: "a" });
  await op("addDevice", { device: "b" });
  await action("a", "createGroup", { name: "Lab trip", yourName: "Ana" });
  const first = await op("inspectDevice", { device: "a" });
  const groupId = first.state.group.group_id;
  await action("b", "joinGroup", {
    groupId,
    token: first.state.group.confirmed_snapshot.invite.token,
    as: { kind: "new", name: "Bo" },
  });
  await op("wait", { until: "convergence", devices: ["a", "b"] });
  await op("deviceNetwork", { device: "b", online: false });
  await action("b", "renameGroup", { name: "Offline trip" });
  const offline = await op("inspectDevice", { device: "b" });
  assert.equal(offline.state.online, false);
  assert.equal(offline.state.group.outbox.length, 1);
  await assert.rejects(
    op("wait", { until: "convergence", devices: ["a", "b"], timeoutMs: 50 }),
    (error) =>
      error.message === "wait_timeout" &&
      error.diagnostics.input.devices.length === 2,
  );
  await op("reloadDevice", { device: "b" });
  assert.equal(
    (await op("inspectDevice", { device: "b" })).state.group.outbox.length,
    1,
  );
  await op("deviceNetwork", { device: "b", online: true });
  await op("wait", { until: "convergence", devices: ["a", "b"] });
  assert.equal(
    (await op("inspectDevice", { device: "a" })).state.group.confirmed_snapshot
      .group.name,
    "Offline trip",
  );
  await op("serverNetwork", { available: false });
  await action("a", "renameGroup", { name: "During outage" });
  assert.equal((await op("inspectDevice", { device: "a" })).state.online, true);
  await op("serverNetwork", { available: true });
  await op("wait", {
    until: "recovery",
    devices: ["a", "b"],
    timeoutMs: 45000,
  });
  await op("wait", { until: "convergence", devices: ["a", "b"] });
  await op("serverProcess", { running: false });
  await action("b", "renameGroup", { name: "During stop" });
  await op("serverProcess", { running: true });
  await op("wait", {
    until: "convergence",
    devices: ["a", "b"],
    timeoutMs: 45000,
  });
  // Drop the response after the real Worker has committed a request.
  await op("deviceNetwork", { device: "a", online: true, latencyMs: 1000 });
  const beforeInflight = lab.sequence;
  const inflight = action("a", "renameGroup", { name: "Response lost" });
  const deadline = Date.now() + 10000;

  while (
    !(await lab.lines("timeline")).some(
      (entry) =>
        entry.sequence > beforeInflight &&
        entry.kind === "response.received" &&
        entry.detail.device === "a",
    )
  ) {
    if (Date.now() > deadline) throw new Error("inflight_request_timeout");
    await delay(20);
  }

  await op("serverNetwork", { available: false });
  await inflight;
  assert.ok(
    (await lab.lines("timeline")).some(
      (entry) =>
        entry.sequence > beforeInflight && entry.kind === "response.lost",
    ),
  );
  await op("deviceNetwork", { device: "a", online: true, latencyMs: 0 });
  await op("serverNetwork", { available: true });
  await op("wait", {
    until: "convergence",
    devices: ["a", "b"],
    timeoutMs: 45000,
  });
  const allStores = await op("inspectStores");
  assert.ok(allStores.some((store) => store.store.includes("d1")));
  assert.ok(
    allStores.some((store) => store.store.includes(`${path.sep}do${path.sep}`)),
  );
  await op("checkpoint", { name: "joined" });
  await action("a", "renameGroup", { name: "After checkpoint" });
  await op("wait", { until: "convergence", devices: ["a", "b"] });
  await op("restore", { name: "joined" });
  await op("wait", { until: "convergence", devices: ["a", "b"] });
  assert.equal(
    (await op("inspectDevice", { device: "a" })).state.group.confirmed_snapshot
      .group.name,
    "Response lost",
  );
  await lab.close();
  await lab.init();
  await op("wait", { until: "convergence", devices: ["a", "b"] });
  assert.equal(
    (await op("inspectDevice", { device: "a" })).state.group.session.identity
      .id,
    first.state.group.session.identity.id,
  );
  await op("replay", {
    steps: [
      {
        operation: "action",
        input: {
          device: "a",
          name: "renameGroup",
          input: { name: "Replayed trip" },
        },
      },
      {
        operation: "wait",
        input: { until: "convergence", devices: ["a", "b"] },
      },
    ],
  });
  assert.equal(
    (await op("inspectDevice", { device: "b" })).state.group.confirmed_snapshot
      .group.name,
    "Replayed trip",
  );
  const diagnostic = await op("export");
  assert.ok(diagnostic.steps.length > 15);
  assert.ok(
    diagnostic.timeline.some((entry) => entry.kind === "realtime.message"),
  );
  assert.ok(
    diagnostic.timeline.every(
      (entry, i, entries) => !i || entry.sequence > entries[i - 1].sequence,
    ),
  );
  await op("freshStart");
  assert.deepEqual((await op("status")).devices, []);
  assert.deepEqual((await op("inspectServer")).groups, []);
  console.log(`Lab acceptance passed: ${root}`);
} finally {
  await lab.close();
}
