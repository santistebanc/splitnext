import { mountSplit, restoreOrder, addReorderHandle, zoomOf, saveZoom } from "./panels.mjs";

const $ = (id) => document.getElementById(id);

mountSplit($("workspace"), $("server-panel"), $("devices-area"), $("server-toggle"), "server", 320, 240, 520);

const headless = new URLSearchParams(location.search).get("host") === "headless";

let hostRole = "unknown",
  labHost = null;

let schemas = {};

// Preview draws a screen at half its size, so more devices fit side by side.
const previewZoom = 0.5;

const zoomLevels = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5];

// A browser opens about six connections to the supervisor. When this page hosts
// in-page devices, an operation can wait on this page's own host results, so
// operations never take the connections those results, events and screens need.
const apiLimit = 3;

let apiActive = 0;

const apiWaiting = [];

async function api(operation, input = {}) {
  if (apiActive >= apiLimit) await new Promise((resolve) => apiWaiting.push(resolve));
  apiActive++;

  try {
    const response = await fetch("/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, input }),
    });

    const data = await response.json();

    if (!response.ok) throw Error(JSON.stringify(data));

    return data;
  } finally {
    apiActive--;
    apiWaiting.shift()?.();
  }
}

function showError(e) {
  $("error").textContent = String(e);
}

async function run(operation, input) {
  $("error").textContent = "";

  try {
    const result = await api(operation, input);
    $("result").textContent = JSON.stringify(result, null, 2);
    $("result-box").hidden = false;
    await requestRefresh();

    return result;
  } catch (e) {
    showError(e);
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;

  if (text !== undefined) node.textContent = text;

  return node;
}

/** Buttons for one exclusive setting; the current value is pressed. */
function segmented(label, options) {
  const group = element("div", "segmented");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);

  const buttons = options.map(([text, value, onclick]) => {
    const button = element("button", "", text);
    button.setAttribute("aria-pressed", "false");
    button.onclick = onclick;
    group.append(button);

    return [value, button];
  });

  group.select = (current) => {
    for (const [value, button] of buttons) button.setAttribute("aria-pressed", String(value === current));
  };

  return group;
}

function devicePanel(id, mode) {
  const panel = element("article", mode === "slot" ? "device live" : "device");
  panel.dataset.mode = mode;
  const title = element("h2", "", id);
  const kind = element("span", "kind chip", mode === "slot" ? "in-page · live" : "");
  const offline = element("span", "chip offline-badge", "Offline");
  offline.hidden = true;
  title.append(kind, offline);
  const heading = element("div", "device-heading");
  heading.append(title);
  addReorderHandle(panel, heading, id);
  const toggle = element("button", "ghost", "Inspector");
  toggle.setAttribute("aria-label", "Toggle inspector for " + id);
  heading.append(toggle);
  panel.append(heading);
  const split = element("div", "device-split");
  const screen = element("div", "device-screen");
  const inspector = element("div", "inspector");
  split.append(screen, inspector);
  panel.append(split);
  const tools = element("div", "tools");

  const network = segmented("Network for " + id, [
    ["Online", true, () => run("deviceNetwork", { device: id, online: true })],
    ["Offline", false, () => run("deviceNetwork", { device: id, online: false })],
  ]);

  const reload = element("button", "", "Reload");
  reload.onclick = () => run("reloadDevice", { device: id });
  const remove = element("button", "danger end", "Remove");

  remove.onclick = () => {
    if (confirm(`Remove ${id} and delete its data?`)) void run("removeDevice", { device: id });
  };

  tools.append(network, reload, remove);
  inspector.append(tools);

  // The screen keeps its size in CSS pixels; zoom only changes how large it is drawn here.
  const defaultScreen = { width: 390, height: 780 };
  let current = { ...defaultScreen };
  let resizing = false;
  // A headless host is screenshot and clicked by the supervisor at the screen's own size.
  let zoom = headless ? 1 : zoomOf(id, previewZoom);
  const bar = element("div", "screen-bar");
  const frame = element("div", "screen-frame");
  const sizeLabel = element("span", "screen-size");
  const zoomSelect = element("select");
  zoomSelect.setAttribute("aria-label", "Zoom for " + id);

  for (const value of zoomLevels) {
    const option = element("option", "", Math.round(value * 100) + "%");
    option.value = String(value);
    zoomSelect.append(option);
  }

  // Refreshes leave the size alone until the device has taken the new one.
  const commit = async () => {
    resizing = true;

    try {
      await run("deviceScreen", { device: id, ...current });
    } finally {
      resizing = false;
    }
  };

  const setScreen = (next) => {
    if (next.width === current.width && next.height === current.height) return;
    current = next;
    apply();
    void commit();
  };

  const setZoom = (value) => {
    zoom = value;
    saveZoom(id, value);
    apply();
  };

  const presets = segmented("Screen preset for " + id, [
    ["Preview", "preview", () => { setZoom(previewZoom); setScreen(defaultScreen); }],
    ["Full", "full", () => { setZoom(1); setScreen(defaultScreen); }],
  ]);

  zoomSelect.onchange = () => setZoom(Number(zoomSelect.value));

  const apply = () => {
    frame.style.width = current.width * zoom + 2 + "px";
    frame.style.height = current.height * zoom + 2 + "px";

    if (slot) {
      slot.style.zoom = String(zoom);
      slot.style.width = current.width + "px";
      slot.style.height = current.height + "px";
    }

    sizeLabel.textContent = `${current.width} × ${current.height}`;

    if (!zoomLevels.includes(zoom)) zoomSelect.append(Object.assign(element("option", "", Math.round(zoom * 100) + "%"), { value: String(zoom) }));
    zoomSelect.value = String(zoom);
    const standard = current.width === defaultScreen.width && current.height === defaultScreen.height;
    presets.select(standard && zoom === previewZoom ? "preview" : standard && zoom === 1 ? "full" : null);
  };

  bar.append(presets, zoomSelect, sizeLabel);
  screen.append(bar, frame);

  // The device itself lives here, in this document; nothing is mirrored.
  const slot = mode === "slot" ? element("div", "slot") : null;

  if (slot) {
    frame.append(slot);
    // HTMLElement.slot is a string attribute: this only marks the panel as live.
    panel.slot = id;
    labHost?.attach(id, slot);
  }

  // Dragging the corner gives the app a larger or smaller screen, at this zoom.
  const grip = element("button", "screen-resize");
  grip.setAttribute("aria-label", "Resize screen of " + id);
  grip.title = "Drag to resize the screen, or use the arrow keys. Shift moves 50 pixels.";
  const clamp = (value, min, max) => Math.round(Math.min(max, Math.max(min, value)));
  let start = null;

  grip.onpointerdown = (event) => {
    if (event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY, ...current };
    resizing = true;
    frame.dataset.resizing = "";
    grip.setPointerCapture(event.pointerId);
  };

  grip.onpointermove = (event) => {
    if (!start) return;
    current = {
      width: clamp(start.width + (event.clientX - start.x) / zoom, 240, 1600),
      height: clamp(start.height + (event.clientY - start.y) / zoom, 320, 1600),
    };
    apply();
  };

  const release = () => {
    if (!start) return;
    const from = start;
    start = null;
    resizing = false;
    delete frame.dataset.resizing;

    if (from.width !== current.width || from.height !== current.height) void commit();
  };

  grip.onpointerup = release;

  grip.onpointercancel = release;

  let keyed = null;

  grip.onkeydown = (event) => {
    const step = event.shiftKey ? 50 : 10;
    const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;

    if (!dx && !dy) return;
    event.preventDefault();
    current = { width: clamp(current.width + dx, 240, 1600), height: clamp(current.height + dy, 320, 1600) };
    resizing = true;
    apply();
    clearTimeout(keyed);

    keyed = setTimeout(() => void commit(), 400);
  };

  const image = element("img", "screen");
  image.alt = `Actual app screen for ${id}`;
  image.tabIndex = 0;
  // A screen that cannot be mirrored here says where the device is instead of a broken image.
  const placeholder = element("div", "screen-placeholder", "Waiting for this device’s screen.");
  placeholder.hidden = true;

  image.onerror = () => {
    image.hidden = true;
    placeholder.hidden = false;
  };

  image.onload = () => {
    image.hidden = false;
    placeholder.hidden = true;
  };

  // Points on the drawn image map to the screenshot's own pixels, whatever the zoom.
  const pointOf = (e) => {
    const r = image.getBoundingClientRect();

    return {
      x: ((e.clientX - r.left) * (image.naturalWidth || current.width)) / r.width,
      y: ((e.clientY - r.top) * (image.naturalHeight || current.height)) / r.height,
    };
  };

  image.onclick = (e) => {
    image.focus();
    void run("input", { device: id, kind: "click", ...pointOf(e) });
  };

  image.onkeydown = (e) => {
    e.preventDefault();

    void run("input", {
      device: id,
      kind: e.key.length === 1 ? "type" : "key",
      text: e.key === " " ? " " : e.key,
    });
  };

  // A scroll gesture fires dozens of wheel events: they are summed and sent one at a time.
  let wheel = null,
    wheeling = false;

  const sendWheel = async () => {
    wheeling = true;

    while (wheel) {
      const input = wheel;
      wheel = null;
      await run("input", input);
    }

    wheeling = false;
  };

  image.onwheel = (e) => {
    e.preventDefault();
    const point = pointOf(e);

    wheel = {
      device: id,
      kind: "wheel",
      x: (wheel?.x ?? 0) + e.deltaX,
      y: (wheel?.y ?? 0) + e.deltaY,
      pointerX: point.x,
      pointerY: point.y,
    };

    if (!wheeling) void sendWheel();
  };

  if (mode !== "slot") frame.append(image, placeholder);
  frame.append(grip);
  apply();
  const details = element("details");
  details.open = true;
  const summary = element("summary", "", "State, drafts, outbox & action schemas");
  const pre = element("pre");
  details.append(summary, pre);
  inspector.append(details);
  panel.dataset.device = id;
  panel.image = mode === "slot" ? null : image;
  panel.state = pre;
  const action = element("div", "action");
  const actionLabel = element("label", "label", "App action");
  const actionSelect = element("select");
  actionSelect.id = "action-" + id;
  actionLabel.htmlFor = actionSelect.id;
  actionSelect.setAttribute("aria-label", "App action for " + id);
  const actionReason = element("p", "hint");
  const actionInput = element("textarea");
  actionInput.setAttribute("aria-label", "App action input for " + id);
  const invoke = element("button", "primary", "Invoke app action");

  const choose = () => {
    const chosen = panel.actions.find((a) => a.name === actionSelect.value);

    if (chosen) {
      actionInput.value = JSON.stringify(chosen.example ?? {}, null, 2);
      actionReason.textContent = chosen.availability.available
        ? chosen.description
        : chosen.availability.reason;
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

  panel.updateState = (state) => {
    pre.textContent = JSON.stringify(state, null, 2);
    network.select(state.online);

    if (!resizing && state.screen) {
      current = state.screen;
      apply();
    }

    offline.hidden = state.online !== false;

    if (mode !== "slot") kind.textContent = state.kind === "inpage" ? "in-page" : "browser";

    if (state.kind === "inpage")
      placeholder.textContent = "This device runs live in the lab page that hosts in-page devices. Open that page to see and use it.";
    panel.actions = state.actions;

    if (!actionSelect.options.length) {
      for (const a of state.actions) {
        const option = element("option", "", a.name);
        option.value = a.name;
        actionSelect.append(option);
      }

      choose();
    }

    const chosen = state.actions.find((a) => a.name === actionSelect.value);
    actionReason.textContent = chosen?.availability.available
      ? chosen.description
      : chosen?.availability.reason;
  };

  action.append(actionLabel, actionSelect, actionReason, actionInput, invoke);
  inspector.append(action);

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

function showStatus(status) {
  const count = `${status.devices.length} ${status.devices.length === 1 ? "device" : "devices"}`;

  const chips = [
    [status.running ? "Running" : "Stopped", status.running ? "good" : "bad"],
    [status.available ? "Available" : "Unavailable", status.available ? "good" : "bad"],
    [count],
  ].map(([text, tone]) => {
    const chip = element("span", "chip", text);

    if (tone) chip.dataset.tone = tone;

    return chip;
  });

  $("status").replaceChildren(...chips);
  $("device-count").textContent = count;

  for (const button of document.querySelectorAll("[data-server]"))
    button.setAttribute("aria-pressed", String(JSON.parse(button.dataset.input)[button.dataset.server] === status[button.dataset.server]));
}

let refreshing = null,
  refreshAgain = false;

/** One refresh at a time; requests during it are folded into one more. */
function requestRefresh() {
  if (refreshing) {
    refreshAgain = true;

    return refreshing;
  }

  refreshing = (async () => {
    try {
      do {
        refreshAgain = false;
        await refresh();
      } while (refreshAgain);
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

async function refresh() {
  const status = await api("status");
  showStatus(status);
  showHosting(status);

  for (const panel of [...$("devices").children])
    if (panel.dataset.device && !status.devices.includes(panel.dataset.device)) removePanel(panel);

  for (const id of status.devices) {
    const mode = modeOf(status.deviceKinds[id]);

    if (!mode) continue;
    const p = panelFor(id, mode);

    if (p.image) p.image.src = `/screen?device=${encodeURIComponent(id)}&t=${Date.now()}`;
    p.updateState(await api("inspectDevice", { device: id }));
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
    void requestRefresh().catch(showError);
  }, 4000);
  // Screen mirroring observes the same pages; it never creates another app instance.
  setInterval(() => {
    for (const p of $("devices").children)
      if (p.image && !p.image.hidden)
        p.image.src = `/screen?device=${encodeURIComponent(p.dataset.device)}&t=${Date.now()}`;
  }, 1500);
}
