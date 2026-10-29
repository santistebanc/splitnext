import { createInspector } from "./inspector.mjs";
import { createServerUi } from "./server-ui.mjs";
import { readableError } from "./views.mjs";
import { mountSplit, zoomOf, saveZoom, fullPanelOf, saveFullPanel, createDock, section, split } from "./panels.mjs";

const $ = (id) => document.getElementById(id);

const headless = new URLSearchParams(location.search).get("host") === "headless";

const devicePanels = new Map();

const empty = $("empty-devices");

// Device panels go beside the other devices, or where the placeholder says devices go.
const dock = headless
  ? null
  : createDock($("workspace"), {
      initial: () =>
        split("row", [
          split("column", [section(["server"], 2), section(["timeline", "state", "operations"], 3)], 1),
          section(["devices"], 3),
        ]),
      near: (id) => id === "devices" || id.startsWith("device:"),
    });

const fixedPanels = Object.entries({ server: "server-panel", timeline: "timeline-panel", state: "state-panel", operations: "operations-panel" }).map(
  ([id, element]) => [id, $(element)],
);

/** The placeholder shows only while there are no devices. */
function syncEmpty() {
  if (!dock) return;

  if (!devicePanels.size && !dock.has("devices")) dock.add("devices", empty, { title: "Devices", placeholder: true });

  if (devicePanels.size && dock.has("devices")) dock.remove("devices");
}

if (dock) {
  for (const [id, element] of fixedPanels) dock.add(id, element, { title: element.dataset.title });
  syncEmpty();
} else {
  // The headless host shows only devices.
  document.documentElement.dataset.headless = "";

  for (const element of [...fixedPanels.map(([, panel]) => panel), empty]) element.hidden = true;
}

let hostRole = "unknown",
  labHost = null;

// Fit (the default) draws each screen as large as its viewport allows, up to 100%.
const fitZoom = 0;

const zoomLevels = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5];

const defaultScreen = { width: 390, height: 780 };

const minScreen = { width: 240, height: 320 };

const maxScreen = 1600;

// The space around a drawn screen and the width of its resize handles, in page pixels.
const stageMargin = 16;

const handleSize = 12;

// The phones and tablets Chrome's device toolbar lists, in CSS pixels.
const screenPresets = [
  ["iPhone SE", 375, 667],
  ["iPhone 12 Pro", 390, 844],
  ["iPhone 14 Pro Max", 430, 932],
  ["Pixel 7", 412, 915],
  ["Samsung Galaxy S8+", 360, 740],
  ["iPad Mini", 768, 1024],
  ["iPad Air", 820, 1180],
];

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

async function download() {
  try {
    const data = await api("export");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = "splitnext-experiment.json";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    showError(e);
  }
}

const serverUi = createServerUi({
  api,
  async perform(operation, input) {
    try {
      return await api(operation, input);
    } finally {
      void requestRefresh().catch(showError);
    }
  },
  download,
  sections: { server: $("server-panel"), timeline: $("timeline-panel"), state: $("state-panel"), operations: $("operations-panel") },
});

function showError(e) {
  serverUi.showError(readableError(e));
}

// Device controls report through the Server panel.
const run = (operation, input) => serverUi.run(operation, input);

function element(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;

  if (text !== undefined) node.textContent = text;

  return node;
}

function devicePanel(id, mode) {
  const panel = element("article", mode === "slot" ? "device live" : "device");
  panel.dataset.mode = mode;
  panel.setAttribute("aria-label", id);
  const toggle = element("button", "ghost", "Inspector");
  toggle.setAttribute("aria-label", "Toggle inspector for " + id);
  const body = element("div", "device-split");
  const screen = element("div", "device-screen");
  const toolbar = element("div", "device-toolbar");
  const viewport = element("div", "device-viewport");
  const inspector = element("div", "inspector");
  // A thin bar across the whole panel holds the device's own controls; the screen's are in its toolbar.
  const bar = element("div", "device-bar");
  screen.append(toolbar, viewport);
  body.append(screen, inspector);
  panel.append(bar, body);

  const labelled = (node, label) => {
    node.setAttribute("aria-label", label + " for " + id);
    node.title = label;

    return node;
  };

  const option = (text, value) => Object.assign(element("option", "", text), { value: String(value) });

  // One toggle: it shows whether the device is online, and a click flips it.
  const network = labelled(element("button", "ghost network-toggle"), "Network");
  let online = true;

  const showNetwork = (value) => {
    online = value;
    network.textContent = online ? "Online" : "Offline";
    network.dataset.tone = online ? "good" : "bad";
    network.setAttribute("aria-pressed", String(online));
    network.title = online ? "Online: click to take this device offline" : "Offline: click to bring this device online";
  };

  showNetwork(true);

  network.onclick = () => {
    showNetwork(!online);
    void run("deviceNetwork", { device: id, online });
  };

  const reload = labelled(element("button", "ghost", "Reload"), "Reload");
  reload.onclick = () => run("reloadDevice", { device: id });

  panel.close = () => {
    if (confirm(`Remove ${id} and delete its data?`)) void run("removeDevice", { device: id });
  };

  // The screen keeps its size in CSS pixels; zoom only changes how large it is drawn here.
  let current = { ...defaultScreen };
  let resizing = false;
  // A headless host is screenshot and clicked by the supervisor at the screen's own size.
  let zoom = headless ? 1 : zoomOf(id, fitZoom);
  // While a handle is dragged the drawn scale holds still, so the edge follows the pointer.
  let heldScale = null;
  // Full panel keeps the screen as large as the view beside the inspector, as that view resizes.
  let fullPanel = !headless && fullPanelOf(id);
  const stage = element("div", "screen-stage");
  const frame = element("div", "screen-frame");
  stage.append(frame);
  viewport.append(stage);

  const dimensions = labelled(element("select"), "Dimensions");
  dimensions.append(option("Responsive", "responsive"), option("Full panel", "full-panel"));

  for (const [name] of screenPresets) dimensions.append(option(name, name));

  const sizeInput = (label, min, max) => {
    const input = labelled(element("input", "screen-dimension"), label);
    Object.assign(input, { type: "number", min, max, step: 1 });

    return input;
  };

  const widthInput = sizeInput("Width", minScreen.width, maxScreen);
  const heightInput = sizeInput("Height", minScreen.height, maxScreen);
  const zoomSelect = labelled(element("select"), "Zoom");
  const fitOption = option("Fit to window", fitZoom);
  zoomSelect.append(fitOption);

  for (const value of zoomLevels) zoomSelect.append(option(Math.round(value * 100) + "%", value));

  const rotate = labelled(element("button", "ghost icon", "⟲"), "Rotate");
  const times = element("span", "times", "×");
  const divider = () => element("span", "toolbar-divider");
  toolbar.append(dimensions, widthInput, times, heightInput, divider(), zoomSelect, rotate);
  bar.append(network, reload, element("span", "bar-spacer"), toggle);

  const clamp = (value, min, max) => Math.round(Math.min(max, Math.max(min, value)));

  const bounded = ({ width, height }) => ({
    width: clamp(width, minScreen.width, maxScreen),
    height: clamp(height, minScreen.height, maxScreen),
  });

  // A full-panel screen fills the viewport edge to edge: no margin, handles or border.
  const border = () => (fullPanel ? 0 : 2);

  // The room the viewport leaves for a drawn screen, its border included.
  const room = () =>
    fullPanel
      ? { width: viewport.clientWidth, height: viewport.clientHeight }
      : {
          width: viewport.clientWidth - 2 * stageMargin - handleSize,
          height: viewport.clientHeight - 2 * stageMargin - handleSize,
        };

  // Fit draws the whole screen inside the viewport, never larger than its own pixels.
  const fitScale = () => {
    const { width, height } = room();

    return Math.max(0.1, Math.min(1, width / (current.width + border()), height / (current.height + border())));
  };

  const scale = () => heldScale ?? (zoom === fitZoom ? fitScale() : zoom);

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
    next = bounded(next);

    if (next.width === current.width && next.height === current.height) {
      apply();

      return;
    }

    current = next;
    apply();
    void commit();
  };

  const setFullPanel = (on) => {
    if (fullPanel === on) return;
    fullPanel = on;
    saveFullPanel(id, on);
  };

  let filling = null;

  // A full-panel screen is the room at the chosen zoom (100% under Fit). While the view keeps
  // resizing, the screen follows at once and the device takes its size when the view settles.
  const fill = (settle = 0) => {
    const drawn = zoom === fitZoom ? 1 : zoom;
    const next = bounded({ width: (room().width - border()) / drawn, height: (room().height - border()) / drawn });

    if (next.width === current.width && next.height === current.height) return apply();
    current = next;
    resizing = true;
    apply();
    clearTimeout(filling);

    filling = setTimeout(() => void commit(), settle);
  };

  const setZoom = (value) => {
    zoom = value;
    saveZoom(id, value);

    if (fullPanel) fill();
    else apply();
  };

  zoomSelect.onchange = () => setZoom(Number(zoomSelect.value));

  dimensions.onchange = () => {
    setFullPanel(dimensions.value === "full-panel");

    if (fullPanel) return fill();
    const preset = screenPresets.find(([name]) => name === dimensions.value);

    if (preset) setScreen({ width: preset[1], height: preset[2] });
    else apply();
  };

  // Any other way of sizing the screen leaves full panel.
  const resize = (next) => {
    setFullPanel(false);
    setScreen(next);
  };

  widthInput.onchange = () => resize({ ...current, width: Number(widthInput.value) || current.width });

  heightInput.onchange = () => resize({ ...current, height: Number(heightInput.value) || current.height });

  rotate.onclick = () => resize({ width: current.height, height: current.width });

  const apply = () => {
    const drawn = scale();
    viewport.toggleAttribute("data-full", fullPanel);
    stage.style.width = current.width * drawn + border() + "px";
    stage.style.height = current.height * drawn + border() + "px";

    if (slot) {
      slot.style.zoom = String(drawn);
      slot.style.width = current.width + "px";
      slot.style.height = current.height + "px";
    }

    if (document.activeElement !== widthInput) widthInput.value = String(current.width);

    if (document.activeElement !== heightInput) heightInput.value = String(current.height);

    const preset = screenPresets.find(([, width, height]) => width === current.width && height === current.height);
    dimensions.value = fullPanel ? "full-panel" : preset ? preset[0] : "responsive";
    fitOption.textContent = `Fit to window (${Math.round(fitScale() * 100)}%)`;

    if (![fitZoom, ...zoomLevels].includes(zoom)) zoomSelect.append(option(Math.round(zoom * 100) + "%", zoom));
    zoomSelect.value = String(zoom);
  };

  if (!headless)
    new ResizeObserver(() => {
      if (heldScale || !viewport.clientWidth) return;

      if (fullPanel) fill(300);
      else if (zoom === fitZoom) apply();
    }).observe(viewport);

  // The device itself lives here, in this document; nothing is mirrored.
  const slot = mode === "slot" ? element("div", "slot") : null;

  if (slot) {
    frame.append(slot);
    // HTMLElement.slot is a string attribute: this only marks the panel as live.
    panel.slot = id;
    labHost?.attach(id, slot);
  }

  // Like Chrome's responsive mode, the right and bottom edges and their corner resize the screen.
  // The stage is centred horizontally, so a width change moves the right edge by half of it.
  const handle = (edge, label, cursorClass) => {
    const grip = element("button", "screen-handle " + cursorClass);
    grip.dataset.edge = edge;
    grip.setAttribute("aria-label", label + " of " + id);
    grip.title = "Drag to resize the screen, or use the arrow keys. Shift moves 50 pixels.";
    const horizontal = edge.includes("x");
    const vertical = edge.includes("y");
    let start = null;

    grip.onpointerdown = (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY, ...current };
      heldScale = scale();
      resizing = true;
      setFullPanel(false);
      frame.dataset.resizing = "";
      grip.setPointerCapture(event.pointerId);
    };

    grip.onpointermove = (event) => {
      if (!start) return;

      current = bounded({
        width: horizontal ? start.width + (2 * (event.clientX - start.x)) / heldScale : start.width,
        height: vertical ? start.height + (event.clientY - start.y) / heldScale : start.height,
      });

      apply();
    };

    const release = () => {
      if (!start) return;
      const from = start;
      start = null;
      heldScale = null;
      resizing = false;
      delete frame.dataset.resizing;
      apply();

      if (from.width !== current.width || from.height !== current.height) void commit();
    };

    grip.onpointerup = release;

    grip.onpointercancel = release;

    let keyed = null;

    grip.onkeydown = (event) => {
      const step = event.shiftKey ? 50 : 10;
      const dx = !horizontal ? 0 : event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
      const dy = !vertical ? 0 : event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;

      if (!dx && !dy) return;
      event.preventDefault();
      setFullPanel(false);
      current = bounded({ width: current.width + dx, height: current.height + dy });
      resizing = true;
      apply();
      clearTimeout(keyed);

      keyed = setTimeout(() => void commit(), 400);
    };

    return grip;
  };

  stage.append(
    handle("x", "Resize width", "edge-x"),
    handle("y", "Resize height", "edge-y"),
    handle("xy", "Resize screen", "edge-xy"),
  );

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
  apply();
  panel.dataset.device = id;
  panel.image = mode === "slot" ? null : image;

  // Inline actions report their own outcome next to their form.
  const perform = async (name, input) => {
    try {
      return await api("action", { device: id, name, input });
    } finally {
      void requestRefresh().catch(showError);
    }
  };

  const details = createInspector(id, perform);
  inspector.append(details.element);

  panel.updateState = (state) => {
    details.update(state);
    showNetwork(state.online !== false);

    if (!resizing && state.screen) {
      current = state.screen;
      apply();
    }

    // The tab says whether the device is online and where it runs.
    const where = mode === "slot" ? "in-page · live" : state.kind === "inpage" ? "in-page" : "browser";

    dock?.setTitle("device:" + id, id, state.online === false ? "bad" : "good", where);

    if (state.kind === "inpage")
      placeholder.textContent = "This device runs live in the lab page that hosts in-page devices. Open that page to see and use it.";
  };

  panel.mountSplit = () => {
    panel.disposeSplit = mountSplit(body, inspector, screen, toggle, "inspector:" + id, 340, 240, 640, true);
  };

  return panel;
}

function removePanel(panel) {
  const id = panel.dataset.device;

  if (panel.slot) labHost?.detach(id);
  panel.disposeSplit?.();
  devicePanels.delete(id);

  if (dock) dock.remove("device:" + id);
  else panel.remove();

  syncEmpty();
}

function panelFor(id, mode) {
  let p = devicePanels.get(id);

  if (p && p.dataset.mode !== mode) {
    removePanel(p);
    p = null;
  }

  if (!p) {
    p = devicePanel(id, mode);
    devicePanels.set(id, p);

    if (dock)
      dock.add("device:" + id, p, { title: id, tone: "good", detail: mode === "slot" ? "in-page · live" : "", onClose: p.close });
    else $("workspace").append(p);

    p.mountSplit();
    syncEmpty();
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

  for (const panel of [...devicePanels.values()])
    if (!status.devices.includes(panel.dataset.device)) removePanel(panel);

  // Places kept for devices that no longer exist.
  for (const id of dock?.ids() ?? [])
    if (id.startsWith("device:") && !status.devices.includes(id.slice("device:".length))) dock.remove(id);

  for (const id of status.devices) {
    const mode = modeOf(status.deviceKinds[id]);

    if (!mode) continue;
    const p = panelFor(id, mode);

    if (p.image) p.image.src = `/screen?device=${encodeURIComponent(id)}&t=${Date.now()}`;
    p.updateState(await api("inspectDevice", { device: id }));
  }

  if (!headless) await serverUi.update(status);
}

$("add").onclick = () =>
  serverUi.run("addDevice", {
    device: `device-${Date.now()}`,
    kind: $("kind").value,
  });

$("refresh").onclick = () => refresh().catch(showError);

$("reset-layout").onclick = () => dock?.reset();

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

      for (const panel of [...devicePanels.values()])
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
    serverUi.setSchemas((await api("discover")).operations);
    await refresh();
  } catch (e) {
    showError(e);
  }

  setInterval(() => {
    void requestRefresh().catch(showError);
  }, 4000);
  // Screen mirroring observes the same pages; it never creates another app instance.
  setInterval(() => {
    for (const p of devicePanels.values())
      if (p.image?.checkVisibility())
        p.image.src = `/screen?device=${encodeURIComponent(p.dataset.device)}&t=${Date.now()}`;
  }, 1500);
}
