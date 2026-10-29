import {
  attachSeparator,
  createPanel,
  createPanelGroup,
  FILL_ATTRIBUTE,
  reorder,
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

const parsed = z.object({ order: z.array(z.string()).optional() })
  .catchall(z.object({ size: z.number(), collapsed: z.boolean() }))
  .safeParse(saved);

const layout = parsed.success ? parsed.data : {};

const orderGroup = createPanelGroup();

const persist = () => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // The lab remains usable when this browser disallows local storage.
  }
};

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
  const screenWidth = root.closest(".device")?.classList.contains("live") ? 392 : 325;

  const updateWidth = (value) => {
    sized.style.width = Math.abs(value) + "px";

    if (end) root.style.width = screenWidth + 12 + Math.abs(value) + "px";
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

function move(root, panel, before) {
  if (root.moveBefore) root.moveBefore(panel, before);
  else root.insertBefore(panel, before);
}

export function restoreOrder(root) {
  const order = Array.isArray(layout.order) ? layout.order : [];
  const panels = [...root.children];

  panels.sort((a, b) => {
    const rank = (panel) => {
      const index = order.indexOf(panel.dataset.device);

      return index < 0 ? order.length : index;
    };

    return rank(a) - rank(b);
  });

  for (let i = 0; i < panels.length; i++)
    if (root.children[i] !== panels[i]) move(root, panels[i], root.children[i]);
}

function movePanel(panel, to, before) {
  const root = panel.parentElement;
  const panels = [...root.children];
  const from = panels.indexOf(panel);

  if (to < 0 || to >= panels.length || from === to) {
    if (before) reorder.play(before, orderGroup.axes);

    return;
  }

  before ??= reorder.measure(root, orderGroup.axes);

  move(root, panel, to > from ? panels[to].nextElementSibling : panels[to]);
  reorder.play(before, orderGroup.axes);
  layout.order = [...root.children].map((child) => child.dataset.device);
  persist();
  document.getElementById("layout-announcement").textContent = `${panel.dataset.device} moved to position ${to + 1}`;
}

/**
 * Pointer drag: the card follows the pointer, the others slide aside to open its
 * new place and a slot marks where it lands. The DOM moves once, on release, so
 * live in-page devices keep their nodes and state.
 */
function startDrag(panel, startX) {
  const root = panel.parentElement;
  const panels = [...root.children];
  const from = panels.indexOf(panel);
  const rects = panels.map((child) => child.getBoundingClientRect());
  const rootRect = root.getBoundingClientRect();
  const startScroll = root.scrollLeft;
  const width = rects[from].width;
  const gap = parseFloat(getComputedStyle(root).columnGap) || 0;
  const slot = document.createElement("div");
  let to = from;

  slot.className = "reorder-slot";
  slot.style.width = width + "px";
  slot.style.height = rects[from].height + "px";
  slot.style.top = rects[from].top - rootRect.top + root.scrollTop + "px";
  root.dataset.reordering = "";
  panel.dataset.dragging = "";
  root.append(slot);

  const place = () => {
    const left = to > from ? rects[to].right - width : rects[to].left;

    slot.style.left = left - rootRect.left + startScroll + "px";
  };

  place();

  const update = (clientX) => {
    const dx = clientX - startX + root.scrollLeft - startScroll;
    const center = rects[from].left + width / 2 + dx;

    panel.style.transform = `translateX(${dx}px)`;
    to = from;

    for (let i = 0; i < panels.length; i++) {
      const middle = rects[i].left + rects[i].width / 2;

      if (i > from && center > middle) to = i;

      if (i < from && center < middle && to === from) to = i;
    }

    for (let i = 0; i < panels.length; i++) {
      if (i === from) continue;
      const shift = from < i && i <= to ? -(width + gap) : to <= i && i < from ? width + gap : 0;

      panels[i].style.translate = shift ? `${shift}px 0` : "";
    }

    place();
  };

  const finish = (commit) => {
    const before = reorder.measure(root, orderGroup.axes);

    root.dataset.settling = "";
    slot.remove();
    delete root.dataset.reordering;
    delete panel.dataset.dragging;
    panel.style.transform = "";

    for (const child of panels) child.style.translate = "";

    before.delete(slot);

    if (commit) movePanel(panel, to, before);
    else reorder.play(before, orderGroup.axes);

    requestAnimationFrame(() => delete root.dataset.settling);
  };

  return { update, finish };
}

/** Drag only from the handle, leaving the live screen's pointer input alone. */
export function addReorderHandle(panel, heading, id) {
  const handle = document.createElement("button");

  handle.className = "reorder-handle ghost";
  handle.setAttribute("aria-label", `Move ${id}`);
  handle.title = "Drag to reorder, or use Left and Right arrow keys. Escape cancels a drag.";
  heading.prepend(handle);

  let start = null,
    drag = null;

  const end = (commit) => {
    drag?.finish(commit);
    drag = null;
    start = null;
  };

  handle.onkeydown = (event) => {
    if (event.key === "Escape" && drag) {
      event.preventDefault();
      end(false);

      return;
    }

    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;

    if (!step || drag) return;
    event.preventDefault();
    movePanel(panel, [...panel.parentElement.children].indexOf(panel) + step);
  };

  handle.onpointerdown = (event) => {
    if (event.button !== 0) return;
    start = event.clientX;
    handle.setPointerCapture(event.pointerId);
  };

  handle.onpointerup = () => end(true);

  handle.onpointercancel = () => end(false);

  handle.onlostpointercapture = () => {
    if (drag) end(false);
  };

  handle.onpointermove = (event) => {
    if (start === null) return;

    if (!drag) {
      if (Math.abs(event.clientX - start) < 4) return;
      drag = startDrag(panel, start);
    }

    const root = panel.parentElement;
    const box = root.getBoundingClientRect();

    if (event.clientX > box.right - 40) root.scrollLeft += 24;

    if (event.clientX < box.left + 40) root.scrollLeft -= 24;

    drag.update(event.clientX);
  };
}
