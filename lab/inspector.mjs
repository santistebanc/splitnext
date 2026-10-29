/**
 * A device's inspector: an Overview of what the app is doing, its Actions as
 * forms built from their input schemas, and its Data as a collapsible tree.
 */

import { ago, card, chip, facts, h, isContainer, jsonTree, money, muted, plural, rows, runnableList, tabbed, words } from "./views.mjs";

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
          muted(plural(g.member_count, "member")),
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

// The app's actions as runnable entries.
const runnable = (action) => ({
  name: action.name,
  group: action.group,
  description: action.description,
  schema: action.inputSchema,
  example: action.example,
  available: action.availability.available,
  reason: action.availability.reason,
  confirms: action.confirms,
  running: action.running?.length > 0,
});

export function createInspector(id, perform) {
  const overviewPane = h("div", "insp-overview");
  const actions = runnableList(perform, { placeholder: "Find an action…" });
  const data = jsonTree({ open: ["$.state"] });
  let latest = null;

  const render = (selected) => {
    if (!latest) return;

    if (selected === "overview") overviewPane.replaceChildren(overview(latest));

    if (selected === "data") data.update(latest);
  };

  const tabs = tabbed(
    "Inspector for " + id,
    [
      ["overview", "Overview", overviewPane],
      ["actions", "Actions", actions.element],
      ["data", "Data", data.element],
    ],
    (selected) => {
      data.invalidate();
      render(selected);
    },
  );

  return {
    element: tabs.element,
    update(state) {
      latest = state;
      actions.update((state.actions ?? []).map(runnable), state.inputOptions ?? {});
      tabs.setTitle("actions", `Actions (${actions.count()})`);
      render(tabs.selected());
    },
  };
}
