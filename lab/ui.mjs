import { mountSplit, restoreOrder, addReorderHandle } from "./panels.mjs";

const $ = (id) => document.getElementById(id);

mountSplit($("workspace"), $("server-panel"), $("devices-area"), $("server-toggle"), "server", 320, 240, 520);

const headless = new URLSearchParams(location.search).get("host") === "headless";

let hostRole = "unknown",
  labHost = null;

let schemas = {};

async function api(operation, input = {}) {
  const response = await fetch("/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, input }),
  });

  const data = await response.json();

  if (!response.ok) throw Error(JSON.stringify(data));

  return data;
}

function showError(e) {
  $("error").textContent = String(e);
}

async function run(operation, input) {
  $("error").textContent = "";

  try {
    const result = await api(operation, input);
    $("result").textContent = JSON.stringify(result, null, 2);
    await refresh();

    return result;
  } catch (e) {
    showError(e);
  }
}

function devicePanel(id, mode) {
  const panel = document.createElement("article");
  panel.className = mode === "slot" ? "device live" : "device";
  panel.dataset.mode = mode;
  const title = document.createElement("h2");
  title.textContent = id;
  const kind = document.createElement("span");
  kind.className = "kind";
  kind.textContent = mode === "slot" ? "in-page · live" : "";
  title.append(kind);
  const heading = document.createElement("div");
  heading.className = "device-heading";
  heading.append(title);
  addReorderHandle(panel, heading, id);
  const toggle = document.createElement("button");
  toggle.textContent = "Inspector";
  toggle.setAttribute("aria-label", "Toggle inspector for " + id);
  heading.append(toggle);
  panel.append(heading);
  const split = document.createElement("div");
  split.className = "device-split";
  const screen = document.createElement("div");
  screen.className = "device-screen";
  const inspector = document.createElement("div");
  inspector.className = "inspector";
  split.append(screen, inspector);
  panel.append(split);
  const tools = document.createElement("div");
  tools.className = "tools";

  for (const [label, operation, input] of [
    ["Offline", "deviceNetwork", { device: id, online: false }],
    ["Online", "deviceNetwork", { device: id, online: true }],
    ["Reload", "reloadDevice", { device: id }],
  ]) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => run(operation, input);
    tools.append(b);
  }

  const remove = document.createElement("button");
  remove.textContent = "Remove";
  remove.onclick = () => {
    if (confirm(`Remove ${id} and delete its data?`)) void run("removeDevice", { device: id });
  };

  tools.append(remove);
  inspector.append(tools);

  if (mode === "slot") {
    // The device itself lives here, in this document; nothing is mirrored.
    const slot = document.createElement("div");
    slot.className = "slot";
    screen.append(slot);
    panel.slot = slot;
    labHost?.attach(id, slot);
  }

  const image = document.createElement("img");
  image.className = "screen";
  image.alt = `Actual app screen for ${id}`;
  image.tabIndex = 0;
  image.onclick = (e) => {    image.focus();
    const r = image.getBoundingClientRect();
    void run("input", {
      device: id,
      kind: "click",
      x: ((e.clientX - r.left) * 390) / r.width,
      y: ((e.clientY - r.top) * 780) / r.height,
    });
  };

  image.onkeydown = (e) => {
    e.preventDefault();    void run("input", {
      device: id,
      kind: e.key.length === 1 ? "type" : "key",
      text: e.key === " " ? " " : e.key,
    });
  };

  image.onwheel = (e) => {
    e.preventDefault();
    const r = image.getBoundingClientRect();
    void run("input", {
      device: id,
      kind: "wheel",
      x: e.deltaX,
      y: e.deltaY,
      pointerX: (e.clientX - r.left) * 390 / r.width,
      pointerY: (e.clientY - r.top) * 780 / r.height,
    });
  };

  if (mode !== "slot") screen.append(image);
  const details = document.createElement("details");
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = "State, drafts, outbox & action schemas";
  const pre = document.createElement("pre");
  details.append(summary, pre);
  inspector.append(details);
  panel.dataset.device = id;
  panel.image = mode === "slot" ? null : image;
  panel.state = pre;
  const actionSelect = document.createElement("select");
  actionSelect.setAttribute("aria-label", "App action for " + id);
  const actionInput = document.createElement("textarea");
  actionInput.setAttribute("aria-label", "App action input for " + id);
  const actionReason = document.createElement("p");
  const invoke = document.createElement("button");
  invoke.textContent = "Invoke app action";

  const choose = () => {
    const action = panel.actions.find((a) => a.name === actionSelect.value);

    if (action) {
      actionInput.value = JSON.stringify(action.example ?? {}, null, 2);
      actionReason.textContent = action.availability.available
        ? action.description
        : action.availability.reason;
    }
  };

  actionSelect.onchange = choose;
  invoke.onclick = () => {
    try {
      void run("action", {
        device: id,
        name: actionSelect.value,
        input: JSON.parse(actionInput.value),
      });
    } catch (e) {
      showError(e);
    }
  };

  panel.updateActions = (actions) => {
    panel.actions = actions;

    if (!actionSelect.options.length) {
      for (const a of actions) {
        const option = document.createElement("option");
        option.value = a.name;
        option.textContent = a.name;
        actionSelect.append(option);
      }

      choose();
    }

    const action = actions.find((a) => a.name === actionSelect.value);
    actionReason.textContent = action?.availability.available
      ? action.description
      : action?.availability.reason;
  };

  inspector.append(actionSelect, actionReason, actionInput, invoke);
  panel.mountSplit = () => {
    panel.disposeSplit = mountSplit(split, inspector, screen, toggle, "inspector:" + id, 300, 200, 440, true);
  };

  return panel;
}

function removePanel(panel) {
  if (panel.slot) labHost?.detach(panel.dataset.device);
  panel.disposeSplit?.();
  panel.remove();
}

function panelFor(id, mode) {
  let p = [...$("devices").children].find((p) => p.dataset.device === id);

  if (p && p.dataset.mode !== mode) {
    removePanel(p);
    p = null;
  }

  if (!p) {
    p = devicePanel(id, mode);
    $("devices").append(p);
    p.mountSplit();
    restoreOrder($("devices"));
  }

  return p;
}

// An in-page device's place waits until this page knows whether it hosts.
const modeOf = (kind) =>
  kind !== "inpage" ? "image" : hostRole === "host" ? "slot" : hostRole === "viewer" ? "image" : null;

function showHosting(status) {
  const mine = hostRole === "host";
  $("hosting").textContent = mine
    ? "Hosting in-page devices in this page."
    : status?.host?.connected
      ? `In-page devices are hosted ${status.host.headless ? "headlessly" : "in another page"}; screens here are mirrored.`
      : "";
}

async function refresh() {
  const status = await api("status");
  $("status").textContent =
    `${status.running ? "Running" : "Stopped"} · ${status.available ? "Available" : "Unavailable"} · ${status.devices.length} devices`;
  showHosting(status);

  for (const panel of [...$("devices").children])
    if (!status.devices.includes(panel.dataset.device)) removePanel(panel);

  for (const id of status.devices) {
    const mode = modeOf(status.deviceKinds[id]);

    if (!mode) continue;
    const p = panelFor(id, mode);

    if (p.image) p.image.src = `/screen?device=${encodeURIComponent(id)}&t=${Date.now()}`;
    const state = await api("inspectDevice", { device: id });
    p.state.textContent = JSON.stringify(state, null, 2);
    p.updateActions(state.actions);
  }

  $("timeline").textContent = JSON.stringify(
    (await api("timeline")).slice(-20).map((e) => ({
      sequence: e.sequence,
      at: e.at,
      kind: e.kind,
      operation: e.detail.operation,
      device: e.detail.device,
    })),
    null,
    2,
  );
  $("server").textContent = JSON.stringify(
    await api("inspectServer"),
    null,
    2,
  );
}

$("add").onclick = () =>
  run("addDevice", {
    device: `device-${Date.now()}`,
    kind: $("kind").value,
  });

$("refresh").onclick = () => refresh().catch(showError);

document
  .querySelectorAll("[data-op]")
  .forEach(
    (b) =>
      (b.onclick = () => run(b.dataset.op, JSON.parse(b.dataset.input))),
  );

$("operation").onchange = () => {
  $("schema").textContent = JSON.stringify(
    schemas[$("operation").value],
    null,
    2,
  );
};

$("run").onclick = () => {
  try {
    void run($("operation").value, JSON.parse($("input").value));
  } catch (e) {
    showError(e);
  }
};

$("export").onclick = async () => {
  try {
    const data = await api("export");
    $("timeline").textContent = JSON.stringify(
      data.timeline.slice(-40),
      null,
      2,
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      }),
    );
    a.download = "splitnext-experiment.json";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    showError(e);
  }
};

// Reports and results reach the supervisor in the order they happened.
let sent = Promise.resolve();

const post = (path, body) => {
  const request = sent.then(() =>
    fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Errors carry their message into the report instead of vanishing.
      body: JSON.stringify(body ?? {}, (key, value) =>
        value instanceof Error
          ? { name: value.name, message: value.message }
          : value,
      ),
    }),
  );

  sent = request.catch(() => undefined);

  return request;
};

// Whole-state snapshots are large and change in bursts: only the latest
// of each per device is kept for each quarter second.
const latest = new Map();

const coalescedReport = (report) => {
  const record = report.detail;

  if (report.name !== "app" || !["state", "ui"].includes(record.kind))
    return void post("/host/report", report);
  const first = latest.size === 0;
  latest.set(record.device + ":" + record.kind, report);

  if (first)
    setTimeout(() => {
      const reports = [...latest.values()];
      latest.clear();

      for (const next of reports) void post("/host/report", next);
    }, 250);
};

// Rendering in-page devices: the supervisor drives this page as their host.
async function handleCall({ id, command }) {
  try {
    let value = {};

    if (command.type === "sync") {
      labHost.sync(command.devices);
      const ids = labHost.ids();

      for (const panel of [...$("devices").children])
        if (panel.slot && !ids.includes(panel.dataset.device))
          removePanel(panel);

      for (const device of ids) panelFor(device, "slot");
      value = { ids };
    } else if (command.type === "gate") {
      labHost.gate(command.open, command.epoch);
    } else if (command.type === "device") {
      value = await labHost.call(command.device, command.command);
    }

    await post("/host/result", { id, ok: true, value });
  } catch (e) {
    await post("/host/result", { id, ok: false, error: String(e) });
  }
}

const channel = new EventSource(
  headless ? "/host/events?headless=1" : "/host/events",
);

channel.addEventListener("init", async (event) => {
  const init = JSON.parse(event.data);
  hostRole = init.role;

  if (init.role !== "host") return;

  if (!window.splitnextLabHostMount)
    return showError("The app bundle with the in-page host is not built: run npm run frontend:build.");
  labHost ??= window.splitnextLabHostMount({
    workerOrigin: init.workerOrigin,
    gate: { open: true, epoch: 0 },
    report: coalescedReport,
  });
  await post("/host/ready");
  showHosting();
});

channel.addEventListener("call", (event) =>
  void handleCall(JSON.parse(event.data)),
);

channel.addEventListener("reload", () => location.reload());

if (!headless) {
  try {
    schemas = (await api("discover")).operations;

    for (const name of Object.keys(schemas)) {
      const option = document.createElement("option");
      option.textContent = name;
      $("operation").append(option);
    }

    $("operation").value = "status";
    $("operation").onchange();
    await refresh();
  } catch (e) {
    showError(e);
  }

  setInterval(() => {
    void refresh().catch(showError);
  }, 4000);
  // Screen mirroring observes the same pages; it never creates another app instance.
  setInterval(() => {
    for (const p of $("devices").children)
      if (p.image)
        p.image.src = `/screen?device=${encodeURIComponent(p.dataset.device)}&t=${Date.now()}`;
  }, 1500);
}
