/**
 * The lab page's server side: Server (status, switches, checkpoints and the
 * last result), Timeline (a filtered live log), Server state (groups,
 * identities, stores and the raw data) and Operations (each lab operation as a
 * form built from its schema).
 */

import { ago, card, chip, facts, h, isContainer, jsonTree, money, muted, plural, readableError, rows, runnableList, tabbed, words } from "./views.mjs";

// Where each lab operation is listed, and what it does.
const catalog = {
  addDevice: ["Devices", "Open a new device of either kind."],
  removeDevice: ["Devices", "Close a device and delete its storage."],
  reloadDevice: ["Devices", "Reload the device's page."],
  inspectDevice: ["Devices", "Read the app's state, actions and diagnostics."],
  action: ["Devices", "Invoke one of the app's actions on a device."],
  input: ["Devices", "Send a click, typing, a key or a wheel to a device."],
  deviceNetwork: ["Devices", "Take a device offline or online, with optional latency."],
  deviceScreen: ["Devices", "Resize a device's screen."],
  deviceForeground: ["Devices", "Signal that the device returned to the foreground."],
  deviceNavigate: ["Devices", "Go back or forward through the device's history."],
  deviceCapabilities: ["Devices", "Set clipboard and share support and the clipboard text (in-page only)."],
  serverNetwork: ["Server", "Make the server reachable or unreachable for every device."],
  serverProcess: ["Server", "Start or stop the local Worker process."],
  inspectServer: ["Server", "Read identities and groups as the server holds them."],
  inspectStores: ["Server", "Read every D1 and Durable Object table. Stops the Worker briefly."],
  replaceRows: ["Server", "Replace one table's rows. Take a checkpoint first."],
  checkpoint: ["Environment", "Save server stores and browser profiles under a name."],
  restore: ["Environment", "Replace the environment with a saved checkpoint."],
  freshStart: ["Environment", "Empty the environment's stores and profiles; checkpoints stay."],
  wait: ["Environment", "Wait until devices converge, drain their outbox or recover."],
  replay: ["Environment", "Run recorded steps in order on the current environment."],
  export: ["Environment", "Collect the timeline, steps and diagnostics."],
  status: ["Lab", "The supervisor's status."],
  discover: ["Lab", "Every operation's schema, the app's actions and the stores."],
  timeline: ["Lab", "The ordered record of everything that happened."],
  reloadHost: ["Lab", "Reload the page that hosts in-page devices."],
  shutdown: ["Lab", "Stop the lab supervisor and its Worker."],
};

const confirming = new Set(["removeDevice", "replaceRows", "restore", "freshStart", "reloadHost", "shutdown"]);

const examples = { addDevice: { device: "alice", kind: "inpage" }, checkpoint: { name: "before-sync" } };

// Device and checkpoint fields offer the ones that exist.
function withChoices(name, schema) {
  const properties = { ...schema.properties };

  if (properties.device && name !== "addDevice") properties.device = { ...properties.device, choices: "device" };

  if (name === "restore") properties.name = { ...properties.name, choices: "checkpoint" };

  if (name === "wait") properties.devices = { ...properties.devices, items: { ...properties.devices.items, choices: "device" } };

  return { ...schema, properties };
}

/** A row of mutually exclusive buttons for one server switch. */
function segmented(label, operation, key, options, run) {
  const row = h("div", "control-row");
  const group = h("div", "segmented");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Server " + label.toLowerCase());

  const buttons = options.map(([text, value]) => {
    const button = h("button", "", text);

    button.onclick = () => run(operation, { [key]: value });

    return [button, value];
  });

  group.append(...buttons.map(([button]) => button));
  row.append(h("span", "", label), group);

  return {
    element: row,
    set: (current) => {
      for (const [button, value] of buttons) button.setAttribute("aria-pressed", String(value === current));
    },
  };
}

function serverPanel(run, download) {
  const root = h("div", "insp srv-pane");
  const chips = h("div", "insp-chips");
  const details = h("div");
  const process = segmented("Process", "serverProcess", "running", [["Running", true], ["Stopped", false]], run);
  const network = segmented("Network", "serverNetwork", "available", [["Available", true], ["Unavailable", false]], run);
  const switches = h("div", "srv-switches");
  switches.append(process.element, network.element);

  const saved = h("div");
  const name = Object.assign(h("input"), { type: "text", placeholder: "Checkpoint name", pattern: "[a-zA-Z0-9_-]{1,48}" });
  name.setAttribute("aria-label", "Checkpoint name");
  const save = h("button", "", "Save");
  const form = h("form", "srv-inline");
  form.append(name, save);

  form.onsubmit = async (event) => {
    event.preventDefault();

    if (!name.value.trim()) return name.focus();

    if (await run("checkpoint", { name: name.value.trim() })) name.value = "";
  };

  const fresh = h("button", "danger", "Fresh start…");

  fresh.onclick = () => {
    if (confirm("Fresh start? This empties the server stores and every device's storage. Checkpoints stay.")) void run("freshStart");
  };

  const exportButton = h("button", "ghost", "Download diagnostics & steps");
  exportButton.onclick = download;
  const environment = h("div", "tools");
  environment.append(fresh, exportButton);

  const error = h("p", "insp-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const resultTitle = h("span", "srv-result-title");
  const result = jsonTree({ filter: false });
  const last = card("Last result", resultTitle, result.element);
  last.hidden = true;

  root.append(
    card("Status", chips, details),
    card("Switches", switches),
    card("Checkpoints", saved, form),
    card("Environment", environment),
    error,
    last,
  );

  let shownCheckpoints = null;

  return {
    element: root,
    update(status) {
      chips.replaceChildren(
        chip(status.running ? "Running" : "Stopped", status.running ? "good" : "bad"),
        chip(status.available ? "Available" : "Unavailable", status.available ? "good" : "bad"),
        chip(plural(status.devices.length, "device")),
      );
      const host = status.host;

      details.replaceChildren(
        facts([
          ["Worker", `127.0.0.1:${status.workerPort}`],
          ["In-page host", !host?.connected ? "none connected" : host.headless ? "headless browser" : "a lab page"],
          ["Events", status.sequence.toLocaleString()],
          ["Environment", status.root?.split(/[\\/]/).at(-1)],
        ]),
      );
      process.set(status.running);
      network.set(status.available);
      const checkpoints = status.checkpoints ?? [];

      if (checkpoints.join("\n") === shownCheckpoints) return;
      shownCheckpoints = checkpoints.join("\n");

      saved.replaceChildren(
        rows(
          checkpoints,
          (checkpoint) => {
            const restore = h("button", "ghost", "Restore…");

            restore.onclick = () => {
              if (confirm(`Restore "${checkpoint}"? This replaces the current stores and device storage.`)) void run("restore", { name: checkpoint });
            };

            return [h("span", "srv-mono", checkpoint), restore];
          },
          "No checkpoints yet.",
        ),
      );
    },
    showRunning(title) {
      error.hidden = true;
      last.hidden = false;
      resultTitle.textContent = `${title} · running…`;
      result.element.hidden = true;
    },
    showResult(title, value) {
      error.hidden = true;
      last.hidden = false;
      resultTitle.textContent = `${title} · ${new Date().toLocaleTimeString()}`;
      result.element.hidden = false;
      result.update(isContainer(value) ? value : { result: value });
    },
    showError(message) {
      error.textContent = message;
      error.hidden = false;
    },
  };
}

// The lab polls these every few seconds to draw the page.
const polling = new Set(["status", "timeline", "inspectServer", "inspectDevice", "discover", "deviceScreen"]);

const categoryOf = (kind) => {
  const head = kind.split(".")[0];

  return ["request", "response", "realtime"].includes(head) ? "network" : head;
};

const categories = [
  ["", "Every kind"],
  ["operation", "Operations"],
  ["app", "App"],
  ["network", "Network"],
  ["device", "Devices"],
  ["server", "Server"],
  ["host", "Host page"],
];

const clock = (at) => {
  const time = new Date(at);

  return time.toLocaleTimeString([], { hour12: false }) + "." + String(time.getMilliseconds()).padStart(3, "0");
};

// A short, readable line for each kind of record.
function summary({ kind, detail = {} }) {
  if (kind === "operation") {
    const rest = Object.entries(detail.input ?? {}).filter(([key]) => key !== "device");
    const values = rest.map(([key, value]) => `${key}: ${isContainer(value) ? JSON.stringify(value) : value}`).join(", ");

    return words(detail.operation) + (values ? ` (${values.length > 120 ? values.slice(0, 120) + "…" : values})` : "");
  }

  if (kind === "app" && detail.kind === "action") {
    const action = detail.detail ?? {};

    return `${words(action.name ?? "action")} · ${action.status ?? ""}${action.origin ? ` from ${action.origin}` : ""}${action.durationMs === undefined ? "" : ` in ${action.durationMs}ms`}`;
  }

  if (kind === "app") return `${words(detail.kind ?? "app")} snapshot`;

  if (kind === "request" || kind === "response.received") return `${detail.method} ${detail.path}${kind === "request" ? "" : " · received"}`;

  if (kind === "response") return `${detail.method} ${detail.path} → ${detail.status}`;

  if (kind === "realtime.message") {
    try {
      return "Realtime " + (JSON.parse(detail.data).type ?? "message");
    } catch {
      return "Realtime message";
    }
  }

  if (kind.startsWith("device.")) return `${words(kind.slice(7))}${detail.kind ? ` (${detail.kind})` : ""}${detail.storage ? `, storage ${detail.storage}` : ""}`;

  if (kind === "server.started") return `Server started on port ${detail.port}`;

  return words(kind.replace(/\./g, " "));
}

function timelinePanel(fetchSince) {
  const root = h("div", "insp tl");
  const search = Object.assign(h("input", "insp-search"), { type: "search", placeholder: "Filter events…" });
  search.setAttribute("aria-label", "Filter events");
  const category = h("select");
  category.setAttribute("aria-label", "Kind of event");

  for (const [value, label] of categories) category.append(Object.assign(h("option", "", label), { value }));
  const device = h("select");
  device.setAttribute("aria-label", "Device");
  const hidePolling = Object.assign(h("input"), { type: "checkbox", checked: true });
  const pollingLabel = h("label", "insp-check");
  pollingLabel.append(hidePolling, "Hide lab polling");
  const pause = h("button", "ghost", "Pause");
  const count = h("span", "insp-muted tl-count");
  const tools = h("div", "insp-tools tl-tools");
  tools.append(search, category, device, pollingLabel, pause, count);
  const list = h("ol", "tl-list");
  root.append(tools, list);

  const entries = [];
  const pending = new Map();
  let after = 0;
  let paused = false;
  let devices = "";

  const outcomeText = (entry) => {
    if (!entry.outcome) return entry.record.kind === "operation" ? "…" : "";

    const took = Date.parse(entry.outcome.at) - Date.parse(entry.record.at);

    return entry.outcome.error ? "failed" : `${took}ms`;
  };

  const paint = (entry) => {
    entry.status.textContent = outcomeText(entry);
    entry.row.dataset.outcome = entry.outcome ? (entry.outcome.error ? "failed" : "done") : "";

    if (entry.outcome?.error) entry.note.textContent = entry.outcome.error.replace(/^(Error: )+/, "");
  };

  const build = (record) => {
    const row = h("li", "tl-row");
    const head = h("button", "tl-head");
    head.setAttribute("aria-expanded", "false");
    const kind = h("span", "tl-kind", record.kind);
    kind.dataset.category = categoryOf(record.kind);
    const who = record.detail?.device ?? record.detail?.input?.device ?? "";
    const status = h("span", "tl-status");
    const note = h("span", "tl-error");
    head.append(h("span", "tl-time", clock(record.at)), kind, h("span", "tl-device", who), h("span", "tl-summary", summary(record)), status);
    row.append(head, note);
    const entry = { record, row, status, note, who, text: [record.kind, who, summary(record)].join(" ").toLowerCase() };
    let tree = null;

    head.onclick = () => {
      const open = head.getAttribute("aria-expanded") !== "true";
      head.setAttribute("aria-expanded", String(open));

      if (open && !tree) {
        tree = jsonTree({ filter: false, open: ["$.detail"] });
        const shown = { sequence: record.sequence, at: record.at, kind: record.kind, detail: record.detail };

        if (entry.outcome) shown.outcome = entry.outcome;
        tree.update(shown);
        row.append(tree.element);
      }

      if (tree) tree.element.hidden = !open;
    };

    return entry;
  };

  const visible = (entry) => {
    const { record } = entry;
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);

    if (category.value && categoryOf(record.kind) !== category.value) return false;

    if (device.value && entry.who !== device.value) return false;

    if (hidePolling.checked && record.kind === "operation" && polling.has(record.detail?.operation) && !entry.outcome?.error) return false;

    return terms.every((term) => entry.text.includes(term));
  };

  const draw = () => {
    const shown = [];

    for (let i = entries.length - 1; i >= 0 && shown.length < 500; i--) if (visible(entries[i])) shown.push(entries[i].row);
    list.replaceChildren(...shown);

    if (!shown.length) list.append(h("li", "hint tl-empty", entries.length ? "No events match." : "No events yet."));
    count.textContent = `${shown.length < 500 ? shown.length : "500+"} shown of ${entries.length}`;
  };

  let typing = null;

  search.oninput = () => {
    clearTimeout(typing);

    typing = setTimeout(draw, 150);
  };

  category.onchange = draw;

  device.onchange = draw;

  hidePolling.onchange = draw;

  pause.onclick = () => {
    paused = !paused;
    pause.textContent = paused ? "Resume" : "Pause";
    pause.setAttribute("aria-pressed", String(paused));

    if (!paused) draw();
  };

  // Each finished or failed operation completes the oldest open one of its name.
  const add = (record) => {
    if (record.kind === "operation.done" || record.kind === "operation.failed") {
      const open = pending.get(record.detail?.operation);
      const entry = open?.shift();

      if (entry) {
        entry.outcome = { at: record.at };

        if (record.detail.error) entry.outcome.error = String(record.detail.error);
        paint(entry);

        return;
      }
    }

    const entry = build(record);
    entries.push(entry);

    if (record.kind === "operation") {
      const name = record.detail?.operation;

      if (!pending.has(name)) pending.set(name, []);
      pending.get(name).push(entry);
    }

    paint(entry);
  };

  return {
    element: root,
    async update(status) {
      const names = status.devices.join("\n");

      if (names !== devices) {
        devices = names;
        const kept = device.value;
        device.replaceChildren(Object.assign(h("option", "", "Every device"), { value: "" }));

        for (const id of status.devices) device.append(Object.assign(h("option", "", id), { value: id }));
        device.value = status.devices.includes(kept) ? kept : "";
      }

      // The first read starts from recent history; later reads bring only what is new.
      const records = await fetchSince(after, after ? 5000 : 2000);

      for (const record of records) add(record);

      after = records.at(-1)?.sequence ?? after;

      // Only the latest events are kept.
      if (entries.length > 4000) {
        for (const entry of entries.splice(0, entries.length - 3000)) pending.get(entry.record.detail?.operation)?.splice(0, 1);
      }

      if (!paused) draw();
    },
  };
}

const shortId = (id) => (id?.length > 10 ? id.slice(0, 8) + "…" : (id ?? ""));

function groupCard(group) {
  const snapshot = group.snapshot ?? {};
  const members = snapshot.members ?? [];
  const expenses = snapshot.expenses ?? [];
  const totals = new Map();

  for (const expense of expenses) totals.set(expense.currency, (totals.get(expense.currency) ?? 0) + expense.total);
  const names = h("div", "insp-chips");

  for (const member of members) names.append(chip(member.display_name, member.status === "active" ? "good" : undefined));

  const title = h("div", "srv-group-title");
  title.append(h("strong", "", snapshot.group?.name ?? "Unnamed group"), muted(shortId(snapshot.group?.id)));
  const node = h("section", "srv-group");

  node.append(
    title,
    facts([
      ["Revision", group.revision],
      ["Created", snapshot.group?.created_at ? ago(snapshot.group.created_at) : ""],
      ["Members", members.length ? names : muted("none")],
      [
        "Expenses",
        expenses.length
          ? `${plural(expenses.length, "expense")}, ${[...totals].map(([currency, amount]) => money({ amount, currency })).join(" + ")}`
          : "none",
      ],
      ["Repayments", String(snapshot.settlements?.length ?? 0)],
      ["Access", plural(snapshot.access_grants?.length ?? 0, "identity", "identities")],
      ["Connected", plural(group.subscribers?.length ?? 0, "identity", "identities")],
      ["Invite", snapshot.invite?.token ? h("span", "srv-mono", snapshot.invite.token) : "none"],
    ]),
  );

  return node;
}

function storesPane(api) {
  const pane = h("div", "insp-overview");
  const load = h("button", "", "Load stores");
  const note = h("p", "hint", "Reading the stores stops the Worker for a moment, so they load only when asked.");
  const list = h("div", "srv-stores");
  const tools = h("div", "tools");
  tools.append(load, note);
  pane.append(tools, list);

  const table = ({ columns, rows: records }) => {
    if (!records.length) return h("p", "hint", "No rows.");
    const wrap = h("div", "srv-table");
    const grid = h("table");
    const head = h("tr");

    for (const column of columns) head.append(h("th", "", column.name));
    grid.append(head);

    for (const record of records) {
      const line = h("tr");

      for (const column of columns) {
        const value = record[column.name];
        const text = value === null ? "null" : String(value);
        const cell = h("td", "", text.length > 80 ? text.slice(0, 80) + "…" : text);
        cell.title = text;
        line.append(cell);
      }

      grid.append(line);
    }

    wrap.append(grid);

    return wrap;
  };

  load.onclick = async () => {
    load.disabled = true;
    load.textContent = "Loading…";

    try {
      const stores = await api("inspectStores");
      list.replaceChildren();

      for (const store of stores) {
        const [, , kind, file] = store.store.split(/[\\/]/);
        const label = kind?.includes("D1") ? "D1 database" : kind?.split("-").at(-1) ?? store.store;
        const total = store.tables.reduce((sum, t) => sum + t.rows.length, 0);
        const details = h("details", "srv-store");
        const head = h("summary");
        head.append(h("strong", "", label), muted(`${shortId(file)} · ${plural(total, "row")}`));
        details.append(head);

        for (const t of store.tables) {
          const inner = h("details", "srv-store-table");
          const title = h("summary");
          title.append(h("span", "srv-mono", t.table), muted(plural(t.rows.length, "row")));
          inner.append(title);

          inner.ontoggle = () => {
            if (inner.open && inner.children.length === 1) inner.append(table(t));
          };

          details.append(inner);
        }

        list.append(details);
      }

      load.textContent = "Reload stores";
    } catch (error) {
      list.replaceChildren(h("p", "insp-error", readableError(error)));
      load.textContent = "Load stores";
    } finally {
      load.disabled = false;
    }
  };

  return pane;
}

function statePanel(api) {
  const groups = h("div", "insp-overview");
  const identities = h("div", "insp-overview");
  const data = jsonTree({ open: ["$.groups"] });
  let latest = null;
  let shown = "";

  const render = (selected) => {
    if (!latest) return;

    if (selected === "data") return data.update(latest);
    const text = JSON.stringify(latest);

    if (text === shown) return;
    shown = text;

    if (!latest.running) groups.replaceChildren(h("p", "hint", "The Worker is stopped; start it to read groups."));
    else groups.replaceChildren(...(latest.groups ?? []).map(groupCard));

    if (latest.running && !latest.groups?.length) groups.append(h("p", "hint", "No groups yet."));
    const people = latest.identities?.identities ?? [];

    identities.replaceChildren(
      rows(
        people,
        (person) => {
          const revoked = person.devices.filter((d) => d.revoked_at).length;

          return [
            h("span", "srv-mono", shortId(person.id)),
            muted(`${plural(person.devices.length, "device")}${revoked ? `, ${revoked} revoked` : ""} · ${ago(person.created_at)}`),
          ];
        },
        latest.running ? "No identities yet." : "The Worker is stopped.",
      ),
    );
  };

  const tabs = tabbed(
    "Server state",
    [
      ["groups", "Groups", groups],
      ["identities", "Identities", identities],
      ["stores", "Stores", storesPane(api)],
      ["data", "Data", data.element],
    ],
    (selected) => {
      shown = "";
      data.invalidate();
      render(selected);
    },
  );

  return {
    element: tabs.element,
    update(state) {
      latest = state;
      tabs.setTitle("groups", `Groups (${state.groups?.length ?? 0})`);
      tabs.setTitle("identities", `Identities (${state.identities?.identities?.length ?? 0})`);
      render(tabs.selected());
    },
  };
}

/**
 * Mounts the four panels into their sections. `perform` runs an operation and
 * refreshes the page; `download` saves the diagnostics.
 */
export function createServerUi({ api, perform, download, sections }) {
  // Switches and buttons report through the Server panel.
  const run = async (operation, input = {}) => {
    // Slow operations, such as checkpoints, say they are still going.
    const slow = setTimeout(() => server.showRunning(words(operation)), 300);

    try {
      const result = await perform(operation, input);
      server.showResult(words(operation), result);

      return result ?? {};
    } catch (error) {
      server.showError(readableError(error));
    } finally {
      clearTimeout(slow);
    }
  };

  const server = serverPanel(run, download);
  const timeline = timelinePanel((after, limit) => api("timeline", { after, limit }));
  const state = statePanel(api);
  const operations = runnableList(perform, { placeholder: "Find an operation…", unavailable: "", results: true });
  let schemas = {};

  sections.server.replaceChildren(server.element);
  sections.timeline.replaceChildren(timeline.element);
  sections.state.replaceChildren(state.element);
  const operationsRoot = h("div", "insp");
  operationsRoot.append(operations.element);
  sections.operations.replaceChildren(operationsRoot);

  return {
    run,
    showResult: (title, value) => server.showResult(title, value),
    showError: (message) => server.showError(message),
    setSchemas(next) {
      schemas = next;
    },
    async update(status) {
      server.update(status);

      operations.update(
        Object.entries(schemas).map(([name, schema]) => ({
          name,
          group: catalog[name]?.[0] ?? "Other",
          description: catalog[name]?.[1] ?? "",
          schema: withChoices(name, schema),
          example: examples[name],
          available: true,
          confirms: confirming.has(name),
        })),
        {
          device: status.devices.map((id) => ({ value: id, label: `${id} (${status.deviceKinds[id]})` })),
          checkpoint: (status.checkpoints ?? []).map((name) => ({ value: name, label: name })),
        },
      );

      await timeline.update(status);
      state.update(await api("inspectServer"));
    },
  };
}
