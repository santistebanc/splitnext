/**
 * Building blocks shared by the device inspector and the server panels: small
 * DOM helpers, forms built from JSON Schemas, a searchable list of runnable
 * entries, and a collapsible JSON tree. All of them keep open forms, typed
 * values and expanded nodes across refreshes.
 */

export function h(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;

  if (text !== undefined) node.textContent = text;

  return node;
}

// recordExpense reads as "Record expense".
export const words = (name) => {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export function ago(time) {
  const seconds = Math.round((Date.now() - Date.parse(time)) / 1000);

  if (!Number.isFinite(seconds)) return "";

  if (seconds < 60) return `${Math.max(0, seconds)}s ago`;

  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;

  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;

  return new Date(time).toLocaleDateString();
}

// Amounts are in minor units.
export const money = ({ amount, currency }) =>
  `${amount < 0 ? "−" : ""}${(Math.abs(amount) / 100).toFixed(2)} ${currency}`;

export const plural = (count, one, many = one + "s") => `${count} ${count === 1 ? one : many}`;

export const chip = (text, tone) => {
  const node = h("span", "chip", text);

  if (tone) node.dataset.tone = tone;

  return node;
};

export const muted = (text) => h("span", "insp-muted", text);

/** A titled block; empty children are left out. */
export function card(title, ...children) {
  const node = h("section", "insp-card");
  node.append(h("h3", "", title), ...children.filter(Boolean));

  return node;
}

/** Rows of label and value; values may be nodes. */
export function facts(rows) {
  const list = h("dl", "insp-facts");

  for (const [label, value] of rows) {
    if (value === undefined || value === null || value === "") continue;
    const dd = h("dd");
    dd.append(value instanceof Node ? value : String(value));
    list.append(h("dt", "", label), dd);
  }

  return list;
}

export function rows(items, render, empty) {
  if (!items?.length) return empty ? h("p", "hint", empty) : null;
  const list = h("ul", "insp-rows");

  for (const item of items) {
    const li = h("li");
    li.append(...render(item).filter(Boolean));
    list.append(li);
  }

  return list;
}

// Everything shown here is parsed JSON: a value is a container, or one of four kinds of leaf.
export const isContainer = (value) => Object(value) === value;

export const leafKind = (value) =>
  value === null ? "null" : value === true || value === false ? "boolean" : Number.isFinite(value) ? "number" : "string";

/** Tabs over panes; only the selected pane is shown, and `onSelect` hears each change. */
export function tabbed(label, entries, onSelect = () => {}) {
  const root = h("div", "insp");
  const strip = h("div", "insp-tabs");
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-label", label);
  root.append(strip);
  const buttons = new Map();
  let selected = entries[0][0];

  const select = (key) => {
    selected = key;

    for (const [name, { button, pane }] of buttons) {
      button.setAttribute("aria-selected", String(name === key));
      pane.hidden = name !== key;
    }

    onSelect(key);
  };

  for (const [key, title, pane] of entries) {
    const button = h("button", "insp-tab", title);
    button.setAttribute("role", "tab");
    button.onclick = () => select(key);
    buttons.set(key, { button, pane });
    strip.append(button);
    root.append(pane);
  }

  select(selected);

  return {
    element: root,
    selected: () => selected,
    select,
    setTitle: (key, title) => (buttons.get(key).button.textContent = title),
  };
}

/** One form control per input property; `read` returns the input or throws a readable error. */
function fieldFor(name, schema, required, example, options) {
  const wrap = h("label", "insp-field");
  wrap.append(h("span", "insp-field-name", words(name) + (required ? " *" : "")));
  const initial = example ?? schema.default;
  let control;
  let read;
  let refreshChoices = () => {};

  const listOf = (source) =>
    source.choices ? (options?.[source.choices] ?? []) : (source.enum ?? []).map((value) => ({ value, label: String(value) }));

  if (schema.type === "array" && (schema.items?.choices || schema.items?.enum)) {
    // A list of known values is a set of checkboxes.
    control = h("div", "insp-choices");

    refreshChoices = (next) => {
      options = next;
      const kept = new Set([...control.querySelectorAll("input:checked")].map((box) => box.value));
      control.replaceChildren();
      const list = listOf(schema.items);

      if (!list.length) control.append(muted("No options right now"));

      for (const choice of list) {
        const option = h("label", "insp-check");
        const box = Object.assign(h("input"), { type: "checkbox", value: String(choice.value), checked: kept.has(String(choice.value)) });
        option.append(box, choice.label);
        control.append(option);
      }
    };

    refreshChoices(options);

    read = () => {
      const values = [...control.querySelectorAll("input:checked")].map((box) => box.value);

      return values.length ? values : undefined;
    };
  } else if (schema.choices || schema.enum) {
    control = h("select");

    refreshChoices = (next) => {
      options = next;
      const list = listOf(schema);
      const kept = control.value || (initial === undefined ? "" : String(initial));
      control.replaceChildren();

      if (!required || !list.length) control.append(Object.assign(h("option", "", list.length ? "—" : "No options right now"), { value: "" }));

      for (const choice of list) control.append(Object.assign(h("option", "", choice.label), { value: String(choice.value) }));

      if ([...control.options].some((o) => o.value === kept)) control.value = kept;
    };

    refreshChoices(options);
    read = () => control.value || undefined;
  } else if (schema.type === "boolean" && required) {
    control = Object.assign(h("input"), { type: "checkbox", checked: initial === true });
    wrap.classList.add("insp-check");
    read = () => control.checked;
  } else if (schema.type === "boolean") {
    // An optional switch says nothing until it is set either way.
    control = h("select");
    control.append(Object.assign(h("option", "", "—"), { value: "" }), Object.assign(h("option", "", "Yes"), { value: "true" }), Object.assign(h("option", "", "No"), { value: "false" }));
    control.value = initial === undefined ? "" : String(initial);
    read = () => (control.value === "" ? undefined : control.value === "true");
  } else if (schema.type === "string") {
    control = Object.assign(h("input"), { type: "text", placeholder: example === undefined ? "" : String(example) });

    if (schema.maxLength) control.maxLength = schema.maxLength;
    read = () => control.value || undefined;
  } else if (schema.type === "number" || schema.type === "integer") {
    control = Object.assign(h("input"), { type: "number", value: schema.default === undefined ? "" : String(schema.default) });

    if (schema.minimum !== undefined) control.min = schema.minimum;

    if (schema.maximum !== undefined) control.max = schema.maximum;

    if (example !== undefined) control.placeholder = String(example);
    read = () => (control.value === "" ? undefined : Number(control.value));
  } else {
    // Lists and objects are typed as JSON, starting from the example.
    control = h("textarea");
    control.value = initial === undefined ? "" : JSON.stringify(initial, null, 2);
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

/** An error from the lab API carries its JSON body; show only its message. */
export function readableError(error) {
  let message = String(error?.message ?? error);

  try {
    message = JSON.parse(message).error ?? message;
  } catch {
    // Not a JSON error body: keep the message as it is.
  }

  return message.replace(/^Error: /, "");
}

/**
 * A searchable, grouped list of things to run. Each entry is
 * `{ name, group, description, schema, example, available, reason, confirms, running }`;
 * opening one shows a form built from its schema. With `results`, a run's
 * result is shown as a tree under its form.
 */
export function runnableList(perform, { placeholder, unavailable = "Show unavailable", results = false } = {}) {
  const pane = h("div", "insp-actions");
  const search = Object.assign(h("input", "insp-search"), { type: "search", placeholder });
  search.setAttribute("aria-label", placeholder);
  const showAll = Object.assign(h("input"), { type: "checkbox" });
  const showAllLabel = h("label", "insp-check insp-toggle");
  const hiddenCount = h("span", "insp-muted");
  showAllLabel.append(showAll, unavailable + " ", hiddenCount);
  const tools = h("div", "insp-tools");
  tools.append(search, showAllLabel);
  const groups = h("div", "insp-groups");
  pane.append(tools, groups);
  const entries = new Map();
  const sections = new Map();
  let latest = { items: [], options: {} };

  const filter = () => {
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let hidden = 0;

    for (const entry of entries.values()) {
      const text = [entry.item.name, words(entry.item.name), entry.item.description].join(" ").toLowerCase();
      const matches = terms.every((term) => text.includes(term));
      const available = entry.item.available;

      if (matches && !available && !showAll.checked) hidden++;
      entry.row.hidden = !matches || (!available && !showAll.checked && !entry.open);
    }

    for (const section of sections.values()) section.hidden = ![...section.querySelectorAll(".insp-action")].some((row) => !row.hidden);
    showAllLabel.hidden = !hidden && !showAll.checked;
    hiddenCount.textContent = hidden ? `(${hidden})` : "";
  };

  search.oninput = filter;

  showAll.onchange = filter;

  const build = (item) => {
    const row = h("div", "insp-action");
    const head = h("button", "insp-action-head");
    head.setAttribute("aria-expanded", "false");
    const note = h("span", "insp-action-note");
    head.append(h("span", "insp-action-name", words(item.name)), note);
    const form = h("form", "insp-form");
    form.hidden = true;
    const properties = Object.entries(item.schema?.properties ?? {});
    const required = new Set(item.schema?.required ?? []);

    const fields = properties.map(([key, schema]) => [
      key,
      fieldFor(key, schema, required.has(key), schema.choices ? undefined : item.example?.[key], latest.options),
    ]);

    const runButton = h("button", "primary", properties.length ? "Run" : "Run now");
    runButton.type = "submit";
    const outcome = h("p", "insp-outcome");
    const description = h("p", "hint");
    const result = results ? jsonTree({ filter: false }) : null;

    if (result) result.element.hidden = true;
    form.append(description, ...fields.map(([, field]) => field.element), runButton, outcome, ...(result ? [result.element] : []));
    row.append(head, form);
    const entry = { item, row, open: false };

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

      if (entry.item.confirms && !confirm(`${words(entry.item.name)}? ${entry.item.description}`)) return;
      runButton.disabled = true;
      outcome.textContent = "Running…";

      try {
        const value = await perform(entry.item.name, input);
        const { status, ...rest } = isContainer(value) && !Array.isArray(value) ? value : {};
        const detail = !result && Object.keys(rest).length ? ": " + JSON.stringify(rest).slice(0, 200) : ".";
        outcome.textContent = (status && status !== "done" ? words(String(status)) : "Done") + detail;
        outcome.dataset.tone = "good";

        if (result) {
          result.element.hidden = !isContainer(value) || !Object.keys(value).length;
          result.update(value);
        }
      } catch (error) {
        outcome.textContent = readableError(error);
        outcome.dataset.tone = "bad";
      } finally {
        runButton.disabled = !entry.item.available;
      }
    };

    entry.update = (next, options) => {
      entry.item = next;
      row.toggleAttribute("data-unavailable", !next.available);
      description.textContent = next.available ? next.description : `${next.description} Unavailable: ${next.reason}`;
      note.textContent = next.running ? "running…" : next.available ? next.description : next.reason;
      head.title = next.available ? next.description : next.reason;
      runButton.disabled = !next.available;

      for (const [, field] of fields) field.refreshChoices(options);
    };

    return entry;
  };

  return {
    element: pane,
    count: () => latest.items.filter((item) => item.available).length,
    update(items, options = {}) {
      latest = { items, options };

      for (const item of items) {
        let entry = entries.get(item.name);

        if (!entry) {
          entry = build(item);
          entries.set(item.name, entry);
          const title = item.group ?? "Other";
          let section = sections.get(title);

          if (!section) {
            section = h("section", "insp-group");
            section.append(h("h3", "", title));
            sections.set(title, section);
            groups.append(section);
          }

          section.append(entry.row);
        }

        entry.update(item, options);
      }

      filter();
    },
  };
}

/**
 * A collapsible tree of JSON; children render when opened. With `filter`, a
 * search box opens the path to every match and Copy JSON copies it all.
 */
export function jsonTree({ filter = true, open: initiallyOpen = [] } = {}) {
  const pane = h("div", filter ? "insp-data" : "insp-result");
  const search = Object.assign(h("input", "insp-search"), { type: "search", placeholder: "Filter keys and values…" });
  search.setAttribute("aria-label", "Filter data");
  const copy = h("button", "ghost", "Copy JSON");
  const tree = h("div", "insp-tree");

  if (filter) {
    const tools = h("div", "insp-tools");
    tools.append(search, copy);
    pane.append(tools);
  }

  pane.append(tree);
  const opened = new Set(initiallyOpen);
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

    if (!isContainer(data)) tree.append(leaf(data));
    else for (const [k, v] of Object.entries(data)) tree.append(node(k, v, `$.${k}`, open));

    if (matches && !matches.size) tree.append(h("p", "hint", "Nothing matches."));
  };

  let typing = null;

  search.oninput = () => {
    clearTimeout(typing);

    typing = setTimeout(draw, 150);
  };

  return {
    element: pane,
    /** Redraws only when the data changed, or after `invalidate`. */
    update(value) {
      data = value;
      const text = JSON.stringify(value);

      if (text === shown) return;
      shown = text;
      draw();
    },
    invalidate() {
      shown = "";
    },
  };
}
