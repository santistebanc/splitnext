import {
  attachSeparator,
  createPanel,
  createPanelGroup,
  FILL_ATTRIBUTE,
  SEPARATOR_ATTRIBUTE,
} from "motion-panels";

import { z } from "zod";

const storageKey = "splitnext:lab:layout:v1";

let saved;

try {
  saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
} catch {
  saved = {};
}

// Entries are checked where they are read, so one stale entry costs only itself.
const layout = z.record(z.string(), z.unknown()).safeParse(saved).data ?? {};

const persist = () => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // The lab remains usable when this browser disallows local storage.
  }
};

/** How large a device's screen is drawn in this page; the screen keeps its own size. */
export function zoomOf(id, fallback) {
  const zoom = z.record(z.string(), z.number()).safeParse(layout.zoom).data?.[id];

  return Number.isFinite(zoom) ? zoom : fallback;
}

export function saveZoom(id, zoom) {
  layout.zoom = { ...z.record(z.string(), z.number()).safeParse(layout.zoom).data, [id]: zoom };
  persist();
}

/** Bind core motion values to DOM while keeping panel contents mounted. */
export function mountSplit(root, sized, fill, toggle, key, defaultSize, minSize, maxSize, end = false) {
  const group = createPanelGroup();
  const stored = layout[key];
  let size = Number.isFinite(stored?.size) ? Math.min(maxSize, Math.max(minSize, stored.size)) : defaultSize;
  let collapsed = stored?.collapsed === true;
  const content = document.createElement("div");

  content.className = "panel-content";
  content.append(...sized.childNodes);
  sized.append(content);
  fill.setAttribute(FILL_ATTRIBUTE, "");
  const separator = document.createElement("div");

  separator.className = "split-separator";
  separator.setAttribute(SEPARATOR_ATTRIBUTE, "");
  separator.setAttribute("role", "separator");
  separator.setAttribute("aria-orientation", "vertical");
  separator.setAttribute("aria-label", end ? "Resize inspector" : "Resize server panel");
  separator.title = "Drag or use arrow keys to resize. Enter to collapse. Double-click to reset.";
  separator.tabIndex = 0;

  if (end) root.append(fill, separator, sized);
  else root.insertBefore(separator, fill);

  const updateWidth = (value) => {
    sized.style.width = Math.abs(value) + "px";
  };

  const options = () => ({
    size,
    defaultSize,
    minSize,
    maxSize,
    collapsed,
    overshoot: false,
    onSizeChange(value) {
      size = value;
      sync();
    },
    onCollapsedChange(value) {
      collapsed = value;
      sync();
    },
  });

  const controller = createPanel(group, options());

  const updateToggle = () => {
    toggle.setAttribute("aria-expanded", String(!collapsed));
    content.inert = collapsed;
  };

  const sync = () => {
    layout[key] = { size, collapsed };
    persist();
    updateToggle();
    controller.sync(options());
  };

  updateWidth(controller.motion.size.get());
  content.style.width = size + "px";
  updateToggle();
  const stopSize = controller.motion.size.on("change", updateWidth);

  const stopContent = controller.motion.content.on("change", (value) => {
    content.style.width = value + "px";
  });

  const detach = controller.attach(sized);
  const detachSeparator = attachSeparator(separator, group, controller);

  toggle.onclick = () => {
    collapsed = !collapsed;
    sync();
  };

  return () => {
    detachSeparator();
    detach();
    stopSize();
    stopContent();
    controller.destroy();
  };
}


/*
 * The dock: the page is a tree of splits whose leaves are sections, and each
 * section shows its panels as tabs. A panel moves by dragging its tab onto
 * another section's tabs or body, or onto a section's edge to split it.
 * Panel elements are only ever moved, never rebuilt, so live in-page devices
 * keep their nodes and state.
 */

const nodeSchema = z.lazy(() =>
  z.union([
    z.object({ id: z.string(), size: z.number().positive(), panels: z.array(z.string()), active: z.string().nullable() }),
    z.object({ id: z.string(), size: z.number().positive(), direction: z.enum(["row", "column"]), children: z.array(nodeSchema).min(1) }),
  ]),
);

let nodeCount = 0;

const nodeId = () => `node-${Date.now().toString(36)}-${nodeCount++}`;

export const section = (panels, size = 1) => ({ id: nodeId(), size, panels, active: panels[0] ?? null });

export const split = (direction, children, size = 1) => ({ id: nodeId(), size, direction, children });

const minSize = 120;

function move(parent, node, before) {
  if (node.parentNode === parent && node.nextSibling === before) return;

  if (parent.moveBefore && parent.isConnected && node.isConnected) parent.moveBefore(node, before);
  else parent.insertBefore(node, before);
}

function sections(node, parent = null, found = []) {
  if (node.children) for (const child of node.children) sections(child, node, found);
  else found.push({ node, parent });

  return found;
}

function parentOf(tree, target) {
  if (!tree.children) return null;

  for (const child of tree.children) {
    if (child === target) return tree;
    const found = parentOf(child, target);

    if (found) return found;
  }

  return null;
}

/** Drops empty sections, giving their room to the next sibling or else the previous, and splits left with one child. */
function prune(node) {
  if (!node.children) return node.panels.length ? node : null;
  const kept = [];
  let freed = 0;

  for (const child of node.children) {
    const result = prune(child);

    if (!result) {
      freed += child.size;

      continue;
    }

    result.size += freed;
    freed = 0;
    kept.push(result);
  }

  if (!kept.length) return null;
  kept[kept.length - 1].size += freed;

  if (kept.length === 1) {
    kept[0].size = node.size;

    return kept[0];
  }

  node.children = kept;

  return node;
}

/**
 * @param root the element the dock fills
 * @param options.initial builds the default tree
 * @param options.near places a panel the tree does not know yet: after the last section holding a panel it matches
 */
export function createDock(root, { initial, near }) {
  const panels = new Map();
  const elements = new Map();
  const stored = nodeSchema.safeParse(layout.dock);
  let tree = stored.success ? stored.data : initial();
  let drag = null;

  const announce = (text) => {
    document.getElementById("layout-announcement").textContent = text;
  };

  const save = () => {
    layout.dock = tree;
    persist();
  };

  const titleOf = (id) => panels.get(id)?.title ?? id;

  const sectionOf = (id) => sections(tree).find(({ node }) => node.panels.includes(id));

  const shown = (node) => node.panels.filter((id) => panels.has(id));

  const commit = (focus) => {
    tree = prune(tree) ?? initial();
    save();
    render();

    if (focus) root.querySelector(`[role="tab"][data-panel="${CSS.escape(focus)}"]`)?.focus();
  };

  function edge(target, id, side) {
    const direction = side === "left" || side === "right" ? "row" : "column";
    const after = side === "right" || side === "bottom";
    const parent = parentOf(tree, target);
    const fresh = section([id]);

    if (parent?.direction === direction) {
      fresh.size = target.size / 2;
      target.size /= 2;
      parent.children.splice(parent.children.indexOf(target) + (after ? 1 : 0), 0, fresh);

      return;
    }

    const wrapper = split(direction, after ? [target, fresh] : [fresh, target], target.size);

    target.size = 1;

    if (parent) parent.children[parent.children.indexOf(target)] = wrapper;
    else tree = wrapper;
  }

  function place(id) {
    const anchor = sections(tree).findLast(({ node }) => node.panels.some(near));

    if (!anchor) {
      const fresh = section([id], tree.size);

      if (tree.children && tree.direction === "row") tree.children.push(fresh);
      else tree = split("row", [tree, fresh]);

      return;
    }

    // A section that only holds placeholders takes the panel as a tab.
    if (!shown(anchor.node).some((other) => !panels.get(other)?.placeholder)) {
      anchor.node.panels.push(id);
      anchor.node.active = id;

      return;
    }

    const parent = anchor.parent;

    if (parent?.direction !== "row") {
      edge(anchor.node, id, "right");

      return;
    }

    // Like sections share their room with the newcomer; the others keep theirs.
    const group = parent.children.filter((child) => !child.children && child.panels.some(near));
    const total = group.reduce((sum, child) => sum + child.size, 0);
    const fresh = section([id], anchor.node.size);
    const scale = total / (total + fresh.size);

    parent.children.splice(parent.children.indexOf(anchor.node) + 1, 0, fresh);

    for (const child of [...group, fresh]) child.size *= scale;
  }

  function take(id) {
    const from = sectionOf(id)?.node;

    if (!from) return;
    from.panels.splice(from.panels.indexOf(id), 1);

    if (from.active === id) from.active = shown(from)[0] ?? null;
  }

  /** Moves a panel to a drop target: a tab position, a section's body or one of its edges. */
  function drop(id, target) {
    if (target.zone === "tabs" || target.zone === "center") {
      const before = target.zone === "tabs" ? shown(target.node)[target.index] : undefined;

      if (before === id) return;
      take(id);
      const at = before === undefined ? target.node.panels.length : target.node.panels.indexOf(before);

      target.node.panels.splice(at, 0, id);
      target.node.active = id;
    } else {
      take(id);
      edge(target.node, id, target.zone);
    }

    commit(id);
    announce(`${titleOf(id)} moved`);
  }

  function activate(node, id, focus) {
    node.active = id;
    commit(focus ? id : null);
  }

  /** Where a dragged tab would land, or null over anything that is not a section. */
  function targetAt(x, y, id) {
    const element = document.elementFromPoint(x, y)?.closest(".dock-section");
    const node = element && sections(tree).find((entry) => entry.node.id === element.dataset.section)?.node;

    if (!node) return null;
    const alone = node.panels.includes(id) && shown(node).length === 1;
    const strip = element.tabs.getBoundingClientRect();

    if (y <= strip.bottom) {
      const tabs = [...element.tabs.children];

      let index = tabs.findIndex((tab) => {
        const box = tab.getBoundingClientRect();

        return x < box.left + box.width / 2;
      });

      if (index < 0) index = tabs.length;
      const line = index < tabs.length ? tabs[index].getBoundingClientRect().left : (tabs.at(-1)?.getBoundingClientRect().right ?? strip.left);

      return { node, zone: "tabs", index, box: { left: line - 1, top: strip.top, width: 3, height: strip.height } };
    }

    const box = element.body.getBoundingClientRect();

    const fx = (x - box.left) / box.width,
      fy = (y - box.top) / box.height;

    const [side, distance] = [["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]].sort((a, b) => a[1] - b[1])[0];
    const zone = distance < 0.25 && !alone ? side : "center";

    if (zone === "center" && node.panels.includes(id)) return null;

    const half = {
      center: {},
      left: { width: box.width / 2 },
      right: { left: box.left + box.width / 2, width: box.width / 2 },
      top: { height: box.height / 2 },
      bottom: { top: box.top + box.height / 2, height: box.height / 2 },
    };

    return { node, zone, box: { left: box.left, top: box.top, width: box.width, height: box.height, ...half[zone] } };
  }

  function startDrag(id, tab, x, y) {
    const ghost = document.createElement("div");
    const indicator = document.createElement("div");

    ghost.className = "dock-ghost";
    ghost.textContent = titleOf(id);
    indicator.className = "dock-drop";
    indicator.hidden = true;
    document.body.append(ghost, indicator);
    root.dataset.dragging = "";
    tab.dataset.dragging = "";
    let target = null;

    const update = (px, py) => {
      ghost.style.translate = `${px + 12}px ${py + 12}px`;
      target = targetAt(px, py, id);
      indicator.hidden = !target;
      indicator.dataset.zone = target?.zone ?? "";

      if (target) for (const [key, value] of Object.entries(target.box)) indicator.style[key] = value + "px";
    };

    const finish = (commitDrop) => {
      ghost.remove();
      indicator.remove();
      delete root.dataset.dragging;
      delete tab.dataset.dragging;

      if (commitDrop && target) drop(id, target);
    };

    update(x, y);

    return { update, finish };
  }

  function tabFor(node, id, active) {
    const panel = panels.get(id);
    const tab = document.createElement("button");
    const label = document.createElement("span");

    tab.className = "dock-tab";
    tab.dataset.panel = id;
    tab.id = "tab-" + panel.element.id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(active));
    tab.setAttribute("aria-controls", panel.element.id);
    tab.tabIndex = active ? 0 : -1;
    tab.title = "Drag onto another section, or onto an edge to split it. Alt+Arrow keys move it; Escape cancels a drag.";
    label.textContent = panel.title;
    tab.append(label);

    if (panel.detail) {
      const detail = document.createElement("span");

      detail.className = "dock-tab-detail";
      detail.textContent = panel.detail;
      tab.append(detail);
    }

    if (panel.tone) tab.dataset.tone = panel.tone;

    let start = null;

    const end = (commitDrop) => {
      start = null;
      const current = drag;

      drag = null;
      current?.finish(commitDrop);

      return Boolean(current);
    };

    tab.onpointerdown = (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      tab.setPointerCapture(event.pointerId);
    };

    tab.onpointermove = (event) => {
      if (!start) return;

      if (!drag) {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) return;
        drag = startDrag(id, tab, event.clientX, event.clientY);
      }

      drag.update(event.clientX, event.clientY);
    };

    tab.onpointerup = () => {
      if (start && !end(true)) activate(node, id, true);
    };

    tab.onpointercancel = () => end(false);

    tab.onlostpointercapture = () => {
      if (drag) end(false);
    };

    tab.onkeydown = (event) => {
      if (event.key === "Escape" && drag) {
        event.preventDefault();
        end(false);

        return;
      }

      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;

      if (!step) return;
      event.preventDefault();
      const ids = shown(node);
      const index = ids.indexOf(id);

      if (event.altKey && event.shiftKey) {
        const all = sections(tree).filter((entry) => shown(entry.node).length);
        const next = all[all.findIndex((entry) => entry.node === node) + step]?.node;

        if (next) drop(id, { node: next, zone: "center" });
      } else if (event.altKey) {
        const other = ids[index + step];

        if (!other) return;
        node.panels.splice(node.panels.indexOf(id), 1);
        node.panels.splice(node.panels.indexOf(other) + (step > 0 ? 1 : 0), 0, id);
        commit(id);
        announce(`${titleOf(id)} moved to tab ${index + step + 1}`);
      } else if (ids[index + step]) activate(node, ids[index + step], true);
    };

    return tab;
  }

  function separator(direction, items, index) {
    const handle = document.createElement("div");
    const horizontal = direction === "row";

    handle.className = "dock-separator";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", horizontal ? "vertical" : "horizontal");
    handle.setAttribute("aria-label", "Resize sections");
    handle.title = "Drag or use arrow keys to resize. Double-click to share evenly.";
    handle.tabIndex = 0;

    const lengths = () => items.map(({ element }) => element.getBoundingClientRect()[horizontal ? "width" : "height"]);

    const show = () => handle.setAttribute("aria-valuenow", String(Math.round(lengths()[index])));

    const resize = (from, delta) => {
      const pair = from[index] + from[index + 1];
      const first = Math.min(pair - minSize, Math.max(minSize, from[index] + delta));

      items.forEach((item, i) => {
        item.node.size = i === index ? first : i === index + 1 ? pair - first : from[i];
        item.element.style.flexGrow = String(item.node.size);
      });
      show();
    };

    let start = null;

    handle.onpointerdown = (event) => {
      if (event.button !== 0) return;
      start = { at: horizontal ? event.clientX : event.clientY, lengths: lengths() };
      handle.dataset.resizing = "";
      handle.setPointerCapture(event.pointerId);
    };

    handle.onpointermove = (event) => {
      if (start) resize(start.lengths, (horizontal ? event.clientX : event.clientY) - start.at);
    };

    handle.onpointerup = () => {
      if (!start) return;
      start = null;
      delete handle.dataset.resizing;
      save();
    };

    handle.onpointercancel = handle.onpointerup;

    handle.onkeydown = (event) => {
      const keys = horizontal ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
      const step = (event.shiftKey ? 64 : 16) * (event.key === keys[1] ? 1 : event.key === keys[0] ? -1 : 0);

      if (!step) return;
      event.preventDefault();
      resize(lengths(), step);
      save();
    };

    handle.ondblclick = () => {
      const from = lengths();

      resize(from, (from[index + 1] - from[index]) / 2);
      save();
    };

    requestAnimationFrame(show);

    return handle;
  }

  /** What shows: sections with known panels, and splits that still divide something. */
  function view(node) {
    if (!node.children) return shown(node).length ? { node, sizeNode: node } : null;
    const children = node.children.map(view).filter(Boolean);

    if (children.length === 1) return { ...children[0], sizeNode: node };

    return children.length ? { node, sizeNode: node, children } : null;
  }

  function elementFor(node) {
    let element = elements.get(node.id);

    if (!element) {
      element = document.createElement("div");

      if (node.children) element.className = "dock-split";
      else {
        element.className = "dock-section";
        element.dataset.section = node.id;
        element.tabs = document.createElement("div");
        element.tabs.className = "dock-tabs";
        element.tabs.setAttribute("role", "tablist");
        element.body = document.createElement("div");
        element.body.className = "dock-body";
        element.append(element.tabs, element.body);
      }

      elements.set(node.id, element);
    }

    return element;
  }

  // Elements are placed first and stale ones removed last, so no panel is detached on its way.
  function render() {
    if (drag) return;
    const used = new Set();
    const filled = [];

    const fill = (parent, children) => {
      children.forEach((child, i) => move(parent, child, parent.children[i] ?? null));
      filled.push([parent, children.length]);
    };

    const draw = (item) => {
      const element = elementFor(item.node);

      used.add(item.node.id);
      element.style.flexGrow = String(item.sizeNode.size);

      return element;
    };

    const layoutOf = (item, element) => {
      const { node } = item;

      if (item.children) {
        element.dataset.direction = node.direction;
        const drawn = item.children.map(draw);
        const items = item.children.map((child, i) => ({ node: child.sizeNode, element: drawn[i] }));

        fill(element, drawn.flatMap((child, i) => (i ? [separator(node.direction, items, i - 1), child] : [child])));
        item.children.forEach((child, i) => layoutOf(child, drawn[i]));

        return;
      }

      const ids = shown(node);

      if (!ids.includes(node.active)) node.active = ids[0];
      const focused = document.activeElement?.closest?.(".dock-tab")?.dataset.panel;

      element.tabs.replaceChildren(...ids.map((id) => tabFor(node, id, id === node.active)));
      fill(element.body, ids.map((id) => panels.get(id).element));

      for (const id of ids) panels.get(id).element.hidden = id !== node.active;

      if (focused && ids.includes(focused)) element.tabs.querySelector(`[data-panel="${CSS.escape(focused)}"]`)?.focus();
    };

    const top = view(tree);
    const topElement = top && draw(top);

    fill(root, topElement ? [topElement] : []);

    if (top) layoutOf(top, topElement);

    for (const [parent, count] of filled.reverse()) while (parent.children.length > count) parent.lastElementChild.remove();

    for (const id of elements.keys()) if (!used.has(id)) elements.delete(id);
  }

  return {
    /** Shows a panel where the tree keeps it, or places it as `near` says. */
    add(id, element, { title = id, tone, detail, placeholder = false } = {}) {
      element.id ||= "panel-" + id.replace(/[^\w-]/g, "-");
      element.classList.add("dock-panel");
      element.setAttribute("role", "tabpanel");
      element.setAttribute("aria-labelledby", "tab-" + element.id);
      panels.set(id, { element, title, tone, detail, placeholder });

      if (!sectionOf(id)) {
        place(id);
        save();
      }

      render();
    },
    remove(id) {
      const panel = panels.get(id);

      panels.delete(id);
      take(id);
      panel?.element.remove();
      commit();
    },
    /** Every panel the tree places, shown or not. */
    ids: () => sections(tree).flatMap(({ node }) => node.panels),
    has: (id) => panels.has(id),
    setTitle(id, title, tone, detail) {
      const panel = panels.get(id);

      if (!panel || (panel.title === title && panel.tone === tone && panel.detail === detail)) return;
      Object.assign(panel, { title, tone, detail });
      render();
    },
    reset() {
      tree = initial();

      for (const id of panels.keys()) if (!sectionOf(id)) place(id);

      commit();
      announce("Layout reset");
    },
  };
}
