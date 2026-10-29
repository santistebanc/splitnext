/**
 * A device's inspector: an Overview of what the app is doing, its Actions as
 * forms built from their input schemas, and its Data as a collapsible tree.
 * It keeps open forms, typed values and expanded nodes across refreshes.
 */

function h(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;

  if (text !== undefined) node.textContent = text;

  return node;
}

// recordExpense reads as "Record expense".
const words = (name) => {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

function ago(time) {
  const seconds = Math.round((Date.now() - Date.parse(time)) / 1000);

  if (!Number.isFinite(seconds)) return "";

  if (seconds < 60) return `${Math.max(0, seconds)}s ago`;

  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;

  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;

  return new Date(time).toLocaleDateString();
}

// Amounts are in minor units.
const money = ({ amount, currency }) =>
  `${amount < 0 ? "−" : ""}${(Math.abs(amount) / 100).toFixed(2)} ${currency}`;

const chip = (text, tone) => {
  const node = h("span", "chip", text);

  if (tone) node.dataset.tone = tone;

  return node;
};

/** A titled block of the Overview; empty blocks are left out. */
function card(title, ...children) {
  const node = h("section", "insp-card");
  node.append(h("h3", "", title), ...children.filter(Boolean));

  return node;
}

/** Rows of label and value; values may be nodes. */
function facts(rows) {
  const list = h("dl", "insp-facts");

  for (const [label, value] of rows) {
    if (value === undefined || value === null || value === "") continue;
    const dd = h("dd");
    dd.append(value instanceof Node ? value : String(value));
    list.append(h("dt", "", label), dd);
  }

  return list;
}

function rows(items, render, empty) {
  if (!items?.length) return empty ? h("p", "hint", empty) : null;
  const list = h("ul", "insp-rows");

  for (const item of items) {
    const li = h("li");
    li.append(...render(item).filter(Boolean));
    list.append(li);
  }

  return list;
}

const muted = (text) => h("span", "insp-muted", text);

// Everything here is parsed JSON: a value is a container, or one of four kinds of leaf.
const isContainer = (value) => Object(value) === value;

const leafKind = (value) =>
  value === null ? "null" : value === true || value === false ? "boolean" : Number.isFinite(value) ? "number" : "string";

// The app UI state that holds forms; the rest of it is navigation and bookkeeping.
const forms = ["create", "join", "settings", "expense", "repayment", "memberEdit", "confirmation", "removal"];

/** Draft fields that hold something, so untouched forms stay out of the way. */
function drafts(ui) {
  const out = [];

  for (const form of forms) {
    const value = ui?.[form];

    if (!isContainer(value)) continue;

    if (form === "settings" && value.name === value.expectedName) continue;

    const filled = Object.entries(value).filter(
      ([key, field]) =>
        !["currency", "expectedVersion", "expectedName", "mode", "revision"].includes(key) &&
        field !== "" &&
        field !== null &&
        field !== false &&
        !(Array.isArray(field) && !field.length) &&
        !isContainer(field),
    );

    if (filled.length) out.push([form, filled]);
  }

  return out;
}

function overview(state) {
  const app = state.state ?? {};
  const group = app.group;
  const snapshot = group?.projected_snapshot;
  const ui = app.ui ?? {};
  const members = new Map((snapshot?.members ?? []).map((m) => [m.id, m.display_name]));
  const fragment = document.createDocumentFragment();

  const status = h("div", "insp-chips");

  status.append(
    chip(app.ready ? (ui.phase ?? "ready") : "starting", app.ready ? "good" : "bad"),
    chip(state.online === false ? "Offline" : "Online", state.online === false ? "bad" : "good"),
    app.reachable === false ? chip("Server unreachable", "bad") : chip("Server reachable", "good"),
  );

  if (ui.view) status.append(chip("View: " + ui.view));

  if (state.screen) status.append(chip(`${state.screen.width} × ${state.screen.height}`));

  fragment.append(card("Status", status, app.syncError ? h("p", "insp-error", String(app.syncError.message ?? app.syncError)) : null));

  if (group) {
    const you = app.groups?.find((g) => g.group_id === group.group_id);
    const outbox = group.outbox ?? [];

    fragment.append(
      card(
        "Open group",
        facts([
          ["Name", snapshot?.group?.name],
          ["You", you?.you_name],
          ["Your balance", you?.you_balances?.map(money).join(", ") || undefined],
          ["Revision", group.revision],
          ["Synced", group.last_synced_at ? ago(group.last_synced_at) : "never"],
          ["Outbox", outbox.length ? chip(`${outbox.length} pending`, "bad") : "empty"],
        ]),
        rows(
          snapshot?.members,
          (m) => [h("span", "", m.display_name), m.status !== "active" ? muted(m.status) : null],
        ),
        rows(outbox, (c) => [h("span", "", c.kind ?? c.command?.kind ?? c.type ?? "command"), muted(c.command_id ?? c.id ?? "")]),
        rows(group.notices, (n) => [h("span", "insp-error", n.message ?? n.kind ?? JSON.stringify(n))]),
      ),
    );

    const expenses = (snapshot?.expenses ?? []).filter((e) => !e.removed_at).slice(-5).reverse();

    if (expenses.length)
      fragment.append(
        card(
          "Latest expenses",
          rows(expenses, (e) => [
            h("span", "", e.description),
            muted(money({ amount: e.total, currency: e.currency })),
            muted(e.paid?.map((p) => members.get(p.member_id) ?? "?").join(", ") ?? ""),
          ]),
        ),
      );
  }

  fragment.append(
    card(
      "Groups",
      rows(
        app.groups,
        (g) => [
          h("span", "", g.name),
          g.status !== "active" ? muted(g.status) : null,
          muted(`${g.member_count} ${g.member_count === 1 ? "member" : "members"}`),
          muted(g.you_balances?.map(money).join(", ") ?? ""),
          g.pending_commands ? chip(`${g.pending_commands} pending`, "bad") : null,
        ],
        "No groups on this device.",
      ),
    ),
  );

  const filled = drafts(ui);

  if (filled.length)
    fragment.append(
      card(
        "Drafts",
        rows(filled, ([form, fields]) => [
          h("strong", "", words(form)),
          muted(fields.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(" · ")),
        ]),
      ),
    );

  if (group?.activity?.length)
    fragment.append(
      card(
        "Recent activity",
        rows(group.activity.slice(-6).reverse(), (a) => [
          h("span", "", a.change?.action ?? "change"),
          muted(a.actor_member_name ?? a.actor_handle ?? ""),
          muted(ago(a.occurred_at)),
        ]),
      ),
    );

  if (state.diagnostics?.events?.length)
    fragment.append(
      card(
        "Network",
        rows(state.diagnostics.events.slice(0, 6), (e) => [
          h("span", "", e.operation ?? e.kind),
          e.operation ? muted(e.kind) : null,
          e.duration_ms !== undefined ? muted(e.duration_ms + " ms") : null,
          muted(ago(e.time)),
        ]),
      ),
    );

  return fragment;
}

/** One form control per input property; `read` returns the input or throws a readable error. */
function fieldFor(name, schema, required, example, options) {
  const wrap = h("label", "insp-field");
  const title = h("span", "insp-field-name", words(name) + (required ? " *" : ""));
  wrap.append(title);
  let control;
  let read;
  let refreshChoices = () => {};

  const choices = schema.choices ? options?.[schema.choices] : schema.enum?.map((value) => ({ value, label: String(value) }));

  if (schema.choices || schema.enum) {
    control = h("select");

    refreshChoices = (next) => {
      const list = schema.choices ? (next?.[schema.choices] ?? []) : choices;
      const kept = control.value;
      control.replaceChildren();

      if (!required || !list.length) control.append(Object.assign(h("option", "", list.length ? "—" : "No options right now"), { value: "" }));

      for (const choice of list) control.append(Object.assign(h("option", "", choice.label), { value: String(choice.value) }));

      if ([...control.options].some((o) => o.value === kept)) control.value = kept;
    };

    refreshChoices(options);
    read = () => control.value || undefined;
  } else if (schema.type === "boolean") {
    control = Object.assign(h("input"), { type: "checkbox", checked: example === true });
    wrap.classList.add("insp-check");
    read = () => control.checked;
  } else if (schema.type === "string") {
    control = Object.assign(h("input"), { type: "text", placeholder: example === undefined ? "" : String(example) });

    if (schema.maxLength) control.maxLength = schema.maxLength;
    read = () => control.value || undefined;
  } else if (schema.type === "number" || schema.type === "integer") {
    control = Object.assign(h("input"), { type: "number", placeholder: example === undefined ? "" : String(example) });
    read = () => (control.value === "" ? undefined : Number(control.value));
  } else {
    // Lists and objects are typed as JSON, starting from the example.
    control = h("textarea");
    control.value = example === undefined ? "" : JSON.stringify(example, null, 2);
    control.rows = 3;

    read = () => {
      if (!control.value.trim()) return undefined;

      try {
        return JSON.parse(control.value);
      } catch {
        throw Error(`${words(name)} is not valid JSON.`);
      }
    };
  }

  wrap.append(control);

  if (schema.description) wrap.append(h("span", "insp-field-hint", schema.description));

  return { element: wrap, read, refreshChoices };
}

function actionsPane(perform) {
  const pane = h("div", "insp-actions");
  const search = Object.assign(h("input", "insp-search"), { type: "search", placeholder: "Find an action…" });
  search.setAttribute("aria-label", "Find an action");
  const showAll = Object.assign(h("input"), { type: "checkbox" });
  const showAllLabel = h("label", "insp-check insp-toggle");
  const hiddenCount = h("span", "insp-muted");
  showAllLabel.append(showAll, "Show unavailable ", hiddenCount);
  const tools = h("div", "insp-tools");
  tools.append(search, showAllLabel);
  const groups = h("div");
  pane.append(tools, groups);
  const entries = new Map();
  const sections = new Map();
  let latest = { actions: [], inputOptions: {} };

  const filter = () => {
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let hidden = 0;

    for (const entry of entries.values()) {
      const text = [entry.action.name, words(entry.action.name), entry.action.description].join(" ").toLowerCase();
      const matches = terms.every((term) => text.includes(term));
      const available = entry.action.availability.available;

      if (matches && !available && !showAll.checked) hidden++;
      entry.row.hidden = !matches || (!available && !showAll.checked && !entry.open);
    }

    for (const section of sections.values()) section.hidden = ![...section.querySelectorAll(".insp-action")].some((row) => !row.hidden);
    hiddenCount.textContent = hidden ? `(${hidden})` : "";
  };

  search.oninput = filter;

  showAll.onchange = filter;

  const build = (action) => {
    const row = h("div", "insp-action");
    const head = h("button", "insp-action-head");
    head.setAttribute("aria-expanded", "false");
    const name = h("span", "insp-action-name", words(action.name));
    const note = h("span", "insp-action-note");
    head.append(name, note);
    const form = h("form", "insp-form");
    form.hidden = true;
    const properties = Object.entries(action.inputSchema?.properties ?? {});
    const required = new Set(action.inputSchema?.required ?? []);

    const fields = properties.map(([key, schema]) => [
      key,
      fieldFor(key, schema, required.has(key), schema.choices ? undefined : action.example?.[key], latest.inputOptions),
    ]);

    const runButton = h("button", "primary", properties.length ? "Run" : "Run now");
    runButton.type = "submit";
    const outcome = h("p", "insp-outcome");
    const description = h("p", "hint");
    form.append(description, ...fields.map(([, field]) => field.element), runButton, outcome);
    row.append(head, form);
    const entry = { action, row, open: false };

    head.onclick = () => {
      entry.open = !entry.open;
      form.hidden = !entry.open;
      head.setAttribute("aria-expanded", String(entry.open));
      row.toggleAttribute("data-open", entry.open);

      if (entry.open) form.querySelector("input, select, textarea, button")?.focus();
    };

    form.onsubmit = async (event) => {
      event.preventDefault();
      outcome.textContent = "";
      delete outcome.dataset.tone;
      const input = {};

      try {
        for (const [key, field] of fields) {
          const value = field.read();

          if (value !== undefined) input[key] = value;
          else if (required.has(key)) throw Error(`${words(key)} is required.`);
        }
      } catch (error) {
        outcome.textContent = error.message;
        outcome.dataset.tone = "bad";

        return;
      }

      if (entry.action.confirms && !confirm(`${words(entry.action.name)}? ${entry.action.description}`)) return;
      runButton.disabled = true;
      outcome.textContent = "Running…";

      try {
        const result = await perform(entry.action.name, input);
        const { status, ...rest } = isContainer(result) ? result : {};
        const detail = Object.keys(rest).length ? JSON.stringify(rest).slice(0, 200) : "";
        outcome.textContent = (status && status !== "done" ? words(String(status)) : "Done") + (detail ? ": " + detail : ".");
        outcome.dataset.tone = "good";
      } catch (error) {
        outcome.textContent = String(error.message ?? error).replace(/^Error: /, "");
        outcome.dataset.tone = "bad";
      } finally {
        runButton.disabled = false;
      }
    };

    entry.update = (next, options) => {
      entry.action = next;
      const available = next.availability.available;
      row.toggleAttribute("data-unavailable", !available);
      description.textContent = available ? next.description : `${next.description} Unavailable: ${next.availability.reason}`;
      note.textContent = next.running?.length ? "running…" : available ? next.description : next.availability.reason;
      head.title = available ? next.description : next.availability.reason;
      runButton.disabled = !available;

      for (const [, field] of fields) field.refreshChoices(options);
    };

    return entry;
  };

  return {
    element: pane,
    count: () => latest.actions.filter((a) => a.availability.available).length,
    update(state) {
      latest = { actions: state.actions ?? [], inputOptions: state.inputOptions ?? {} };

      for (const action of latest.actions) {
        let entry = entries.get(action.name);

        if (!entry) {
          entry = build(action);
          entries.set(action.name, entry);
          const title = action.group ?? "Other";
          let section = sections.get(title);

          if (!section) {
            section = h("section", "insp-group");
            section.append(h("h3", "", title));
            sections.set(title, section);
            groups.append(section);
          }

          section.append(entry.row);
        }

        entry.update(action, latest.inputOptions);
      }

      filter();
    },
  };
}

/** A collapsible tree of the device's data; children render when opened. */
function dataPane() {
  const pane = h("div", "insp-data");
  const search = Object.assign(h("input", "insp-search"), { type: "search", placeholder: "Filter keys and values…" });
  search.setAttribute("aria-label", "Filter data");
  const copy = h("button", "ghost", "Copy JSON");
  const tools = h("div", "insp-tools");
  tools.append(search, copy);
  const tree = h("div", "insp-tree");
  pane.append(tools, tree);
  const opened = new Set(["$.state"]);
  let data = null;
  let shown = "";

  copy.onclick = async () => {
    await navigator.clipboard?.writeText(JSON.stringify(data, null, 2));
    copy.textContent = "Copied";

    setTimeout(() => (copy.textContent = "Copy JSON"), 1200);
  };

  // Paths whose subtree matches the filter open, so matches are visible.
  const matching = (query) => {
    const paths = new Set();

    const walk = (key, value, path) => {
      let hit = String(key).toLowerCase().includes(query);

      if (isContainer(value)) {
        for (const [k, v] of Object.entries(value)) if (walk(k, v, `${path}.${k}`)) hit = true;

        if (hit) paths.add(path);
      } else if (String(value).toLowerCase().includes(query)) hit = true;

      return hit;
    };

    walk("", data, "$");

    return paths;
  };

  const leaf = (value) => {
    const text = leafKind(value) === "string" ? JSON.stringify(value) : String(value);

    return h("span", "insp-value", text.length > 300 ? text.slice(0, 300) + "…" : text);
  };

  const node = (key, value, path, open) => {
    const entries = isContainer(value) ? Object.entries(value) : null;

    // Leaves, and empty lists and objects, which have nothing to open.
    if (!entries?.length) {
      const row = h("div", "insp-leaf");
      row.dataset.kind = entries ? "empty" : leafKind(value);
      row.append(h("span", "insp-key", key), entries ? muted(Array.isArray(value) ? "[]" : "{}") : leaf(value));

      return row;
    }

    const details = h("details");
    const summary = h("summary");
    summary.append(h("span", "insp-key", key), muted(Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`));
    details.append(summary);
    let rendered = false;

    const render = () => {
      if (rendered) return;
      rendered = true;
      const box = h("div", "insp-children");

      for (const [k, v] of entries) box.append(node(k, v, `${path}.${k}`, open));
      details.append(box);
    };

    details.ontoggle = () => {
      if (details.open) {
        opened.add(path);
        render();
      } else if (!search.value) opened.delete(path);
    };

    if (open(path)) {
      details.open = true;
      render();
    }

    return details;
  };

  const draw = () => {
    const query = search.value.trim().toLowerCase();
    const matches = query ? matching(query) : null;
    const open = matches ? (path) => matches.has(path) : (path) => opened.has(path);
    tree.replaceChildren();

    for (const [k, v] of Object.entries(data ?? {})) tree.append(node(k, v, `$.${k}`, open));

    if (matches && !matches.size) tree.append(h("p", "hint", "Nothing matches."));
  };

  let typing = null;

  search.oninput = () => {
    clearTimeout(typing);

    typing = setTimeout(draw, 150);
  };

  return {
    element: pane,
    update(state, visible) {
      data = state;

      if (!visible) return;
      const text = JSON.stringify(state);

      if (text === shown) return;
      shown = text;
      draw();
    },
    show() {
      shown = "";
    },
  };
}

export function createInspector(id, perform) {
  const root = h("div", "insp");
  const tabs = h("div", "insp-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Inspector for " + id);
  const overviewPane = h("div", "insp-overview");
  const actions = actionsPane(perform);
  const data = dataPane();
  const panes = { overview: overviewPane, actions: actions.element, data: data.element };
  const buttons = {};
  let selected = "overview";
  let latest = null;

  const render = () => {
    if (!latest) return;

    if (selected === "overview") overviewPane.replaceChildren(overview(latest));

    if (selected === "data") data.update(latest, true);
  };

  const select = (name) => {
    selected = name;

    for (const [key, button] of Object.entries(buttons)) {
      button.setAttribute("aria-selected", String(key === name));
      panes[key].hidden = key !== name;
    }

    data.show();
    render();
  };

  for (const [key, label] of [["overview", "Overview"], ["actions", "Actions"], ["data", "Data"]]) {
    const button = h("button", "insp-tab", label);
    button.setAttribute("role", "tab");
    button.onclick = () => select(key);
    buttons[key] = button;
    tabs.append(button);
  }

  root.append(tabs, ...Object.values(panes));
  select("overview");

  return {
    element: root,
    update(state) {
      latest = state;
      actions.update(state);
      buttons.actions.textContent = `Actions (${actions.count()})`;
      render();
    },
  };
}
