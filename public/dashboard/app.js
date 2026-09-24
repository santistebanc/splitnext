import {
  ClientOfflineError,
  SplitnextRequestError,
  SyncLab,
} from '/sdk/splitnext-lab.js';

const elements = {
  health: document.querySelector('#health-status'),
  ready: document.querySelector('#ready-status'),
  initialize: document.querySelector('#initialize-devices'),
  createForm: document.querySelector('#create-group-form'),
  joinForm: document.querySelector('#join-group-form'),
  joinGroupId: document.querySelector('#join-group-id'),
  setupSummary: document.querySelector('#setup-summary'),
  serverToggle: document.querySelector('#toggle-server'),
  serverRevision: document.querySelector('#server-revision'),
  serverIdentityList: document.querySelector('#server-identity-list'),
  serverGroupSummary: document.querySelector('#server-group-summary'),
  serverMemberList: document.querySelector('#server-member-list'),
  serverSubscribers: document.querySelector('#server-subscribers'),
  serverIncoming: document.querySelector('#server-incoming'),
  serverState: document.querySelector('#server-state'),
  refreshServer: document.querySelector('#refresh-server'),
  resetServer: document.querySelector('#reset-server'),
  clearServerTraffic: document.querySelector('#clear-server-traffic'),
  toast: document.querySelector('#toast'),
};

const deviceViews = Object.fromEntries(
  [...document.querySelectorAll('[data-device]')].map((root) => [
    root.dataset.device,
    {
      root,
      toggle: root.querySelector('[data-action="toggle-device"]'),
      realtimeToggle: root.querySelector('[data-action="toggle-realtime"]'),
      realtimeEvents: root.querySelector('[data-role="realtime-events"]'),
      identity: root.querySelector('[data-role="identity"]'),
      revision: root.querySelector('[data-role="revision"]'),
      groupEditor: root.querySelector('[data-role="group-editor"]'),
      memberList: root.querySelector('[data-role="member-list"]'),
      actions: root.querySelector('[data-role="actions"]'),
      sync: root.querySelector('[data-action="sync"]'),
      leave: root.querySelector('[data-action="leave"]'),
      rejoin: root.querySelector('[data-action="rejoin"]'),
      addMemberForm: root.querySelector('[data-action-form="add-member"]'),
      commands: root.querySelector('[data-role="commands"]'),
      requests: root.querySelector('[data-role="requests"]'),
      clearTraffic: root.querySelector('[data-action="clear-traffic"]'),
      rawState: root.querySelector('[data-role="raw-state"]'),
    },
  ]),
);

const lab = new SyncLab({
  baseUrl: window.location.origin,
  onChange: () => renderAll(),
});

const state = lab.state;

await Promise.all([checkDependencies(), lab.refreshServer()]);

bindEvents();

renderAll();

async function checkDependencies() {
  const [health, ready] = await lab.checkDependencies();

  renderDependency(elements.health, health.status === 'fulfilled', 'Worker');
  renderDependency(elements.ready, ready.status === 'fulfilled', 'Storage');
}

function renderDependency(element, available, label) {
  element.textContent = `${label} ${available ? 'ready' : 'unavailable'}`;
  element.className = `status ${available ? 'ok' : 'error'}`;
}

function bindEvents() {
  elements.initialize.addEventListener('click', initializeDevices);
  elements.createForm.addEventListener('submit', createGroup);
  elements.joinForm.addEventListener('submit', joinGroup);
  elements.serverToggle.addEventListener('click', toggleServer);
  elements.refreshServer.addEventListener('click', refreshServer);
  elements.resetServer.addEventListener('click', resetServer);
  elements.clearServerTraffic.addEventListener('click', () => {
    lab.clearServerTraffic();
  });

  for (const [key, view] of Object.entries(deviceViews)) {
    view.toggle.addEventListener('click', () => toggleDevice(key));
    view.realtimeToggle.addEventListener('click', () => toggleRealtime(key));
    view.sync.addEventListener('click', () => synchronizeDevice(key));
    view.leave.addEventListener('click', () => leaveGroup(key));
    view.rejoin.addEventListener('click', () => rejoinGroup(key));
    view.clearTraffic.addEventListener('click', () => clearDeviceTraffic(key));
    view.actions.addEventListener('click', (event) => beginRename(event, key));
    view.addMemberForm.addEventListener('submit', (event) =>
      addMember(event, key),
    );
    view.memberList.addEventListener('submit', (event) =>
      performMemberAction(event, key),
    );
  }
}

async function initializeDevices() {
  setBusy(elements.initialize, true, 'Initializing…');

  try {
    await lab.initializeDevices();
    showToast('Both independent device identities are ready');
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(elements.initialize, false, 'Initialize both devices');
    renderAll();
  }
}

async function createGroup(event) {
  event.preventDefault();

  const button = event.submitter;
  const fields = new FormData(elements.createForm);

  setBusy(button, true, 'Creating…');

  try {
    const replica = await lab.createGroup({
      name: readText(fields, 'name'),
      currency_code: readText(fields, 'currency_code'),
      creator_member_name: readText(fields, 'creator_member_name'),
    });

    elements.joinGroupId.value = replica.group_id;
    rememberGroup(replica.group_id);
    showToast('Device 1 created the authoritative group');
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(button, false, 'Create group');
    renderAll();
  }
}

async function joinGroup(event) {
  event.preventDefault();

  const button = event.submitter;
  const fields = new FormData(elements.joinForm);
  const groupId = readText(fields, 'group_id');

  setBusy(button, true, 'Joining…');

  try {
    await lab.joinGroup(groupId, readText(fields, 'display_name'));
    rememberGroup(groupId);
    showToast('Device 2 joined and received its own local replica');
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(button, false, 'Join group');
    renderAll();
  }
}

async function toggleDevice(key) {
  const device = state.devices[key];
  const goingOnline = !device.online;

  try {
    await lab.toggleDevice(key);
  } catch (error) {
    showToast(describeError(error), true);

    return;
  }

  if (!goingOnline) {
    showToast(`${device.label} is offline. New changes stay in its outbox.`);

    return;
  }

  showToast(`${device.label} is online and reconciled.`);
}

function toggleRealtime(key) {
  const device = state.devices[key];

  lab.toggleRealtime(key);
  showToast(
    device.realtime
      ? `${device.label} subscribed to revision announcements`
      : `${device.label} stopped listening; sync manually or turn Live back on to catch up`,
  );
}

async function toggleServer() {
  const goingOnline = !state.server.online;

  showToast(
    goingOnline
      ? 'Server is available again. Online devices are delivering their outboxes.'
      : 'Server outage simulated. Devices keep working and queue changes locally.',
  );

  try {
    await lab.toggleServer();
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    renderAll();
  }
}

async function synchronizeDevice(key, announce = true) {
  try {
    const replica = await lab.syncDevice(key);

    if (announce && replica) {
      showToast(`${state.devices[key].label} synchronized successfully`);
    }
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    renderAll();
  }
}

/** Clicking a group or member name, or its pencil button, starts a rename. */
function beginRename(event, key) {
  const trigger =
    event.target instanceof Element
      ? event.target.closest('[data-action="edit-name"], [data-role="name-label"]')
      : null;

  const line = trigger?.closest('.name-line');
  const button = line?.querySelector('[data-action="edit-name"]');

  if (!line || !button || button.disabled || line.classList.contains('editing')) {
    return;
  }

  event.preventDefault();

  if (line.dataset.edit === 'group') {
    const seen = currentGroupName(key);

    if (seen === undefined) return;

    editInline(line, seen, (name) =>
      runMutation(key, () => lab.renameGroup(key, name, seen), 'Group renamed'),
    );

    return;
  }

  const memberId = memberIdOf(line);
  const seen = currentMemberName(key, memberId);

  if (seen === undefined) return;

  editInline(line, seen, (name) =>
    runMutation(
      key,
      () => lab.renameMember(key, memberId, name, seen),
      'Member renamed',
    ),
  );
}

/**
 * Swaps a name label for a text field. Enter or leaving the field saves a
 * changed name; Escape, or a blank or unchanged name, just closes it. The
 * rename carries the name seen when editing began, so a concurrent rename by
 * another device produces a conflict notice instead of being overwritten.
 */
function editInline(line, seen, save) {
  const input = document.createElement('input');
  let finished = false;

  const finish = (commit) => {
    if (finished) return;

    finished = true;
    line.classList.remove('editing');
    input.remove();

    const name = input.value.trim();

    if (!commit || name === seen) return;

    if (!name) {
      showToast('A name cannot be empty; the previous name was kept', true);

      return;
    }

    void save(name);
  };

  input.className = 'name-input';
  input.value = seen;
  input.maxLength = 100;
  input.setAttribute('aria-label', `New name for ${seen}`);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  line.classList.add('editing');
  line.append(input);
  input.focus();
  input.select();
}

function currentGroupName(key) {
  return state.devices[key].replica?.projected_snapshot?.group.name;
}

function currentMemberName(key, memberId) {
  return state.devices[key].replica?.projected_snapshot?.members.find(
    ({ id }) => id === memberId,
  )?.display_name;
}

function memberIdOf(element) {
  return element instanceof Element
    ? element.closest('[data-member-id]')?.dataset.memberId
    : undefined;
}

async function addMember(event, key) {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = new FormData(form);

  await runMutation(key, () => lab.addMember(key, readText(fields, 'display_name')), 'Member addition recorded');
  form.reset();
}

async function performMemberAction(event, key) {
  event.preventDefault();

  const form = event.target;

  if (!(form instanceof HTMLFormElement)) return;

  const memberId = form.dataset.memberId;
  const intent = event.submitter?.value;
  let operation;
  let message;

  if (!intent) return;

  if (intent === 'prefer') {
    const sharedWith = otherUsersOf(key, memberId);

    operation = () => lab.selectPreferredMember(key, memberId);
    message = sharedWith.length
      ? `Preferred “you” member updated. Heads up: ${sharedWith.join(', ')} also uses this member`
      : 'Preferred “you” member updated';
  } else {
    operation = () => lab.removeMember(key, memberId);
    message = 'Member removal recorded';
  }

  await runMutation(key, operation, message);
}

function otherUsersOf(key, memberId) {
  const device = state.devices[key];
  const snapshot = device.replica?.projected_snapshot;
  const identityId = device.session?.identity.id;

  return (snapshot?.access_grants ?? [])
    .filter(
      (grant) =>
        grant.preferred_member_id === memberId &&
        !grant.hidden_at &&
        grant.identity_id !== identityId,
    )
    .map((grant) => grant.actor_handle);
}

async function leaveGroup(key) {
  await runMutation(
    key,
    () => lab.leaveGroup(key),
    'Group hidden and preferred member cleared',
  );
}

async function rejoinGroup(key) {
  try {
    const replica = await lab.rejoinGroup(key);

    const member = replica.projected_snapshot.members.find(
      ({ id }) => id === replica.projected_snapshot.access_grants.find(
        ({ identity_id }) => identity_id === replica.session.identity.id,
      )?.preferred_member_id,
    );

    showToast(`${state.devices[key].label} rejoined using ${member?.display_name ?? 'an active member'}`);
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    renderAll();
  }
}

async function runMutation(key, operation, successMessage) {
  const device = state.devices[key];

  if (!device.session || !state.groupId) return;

  try {
    const replica = await operation();

    if (!replica?.outbox.length) {
      showToast(successMessage);
    } else if (!device.online) {
      showToast(`${successMessage}; queued locally while offline`);
    } else {
      showToast(`${successMessage}; queued until the server is reachable`);
    }
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    renderAll();
  }
}

async function refreshServer() {
  try {
    await lab.refreshServer();
    showToast('Authoritative server state refreshed');
  } catch (error) {
    showToast(describeError(error), true);
  }
}

async function resetServer() {
  const confirmed = window.confirm(
    'Erase every identity and every group this dashboard has created or joined, then start over with two new devices?',
  );

  if (!confirmed) return;

  setBusy(elements.resetServer, true, 'Resetting…');

  try {
    const cleared = await lab.reset(rememberedGroups());

    localStorage.removeItem(rememberedGroupsKey);
    elements.joinGroupId.value = '';
    showToast(
      `Server data erased (${cleared.length} group${cleared.length === 1 ? '' : 's'}). Initialize the devices to start again.`,
    );
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(elements.resetServer, false, 'Reset data');
    renderAll();
  }
}

// Durable Objects cannot be listed, so the dashboard remembers which groups it
// has touched across reloads in order to erase them on reset.
const rememberedGroupsKey = 'splitnext-lab-groups';

function rememberedGroups() {
  try {
    const stored = JSON.parse(localStorage.getItem(rememberedGroupsKey) ?? '[]');

    // Anything unexpected would make the server reject the whole reset.
    return Array.isArray(stored)
      ? stored.filter((id) => /^[A-Za-z0-9_-]{22}$/.test(id))
      : [];
  } catch {
    return [];
  }
}

function rememberGroup(groupId) {
  const groups = new Set(rememberedGroups());

  groups.add(groupId);
  localStorage.setItem(rememberedGroupsKey, JSON.stringify([...groups].slice(-100)));
}

function clearDeviceTraffic(key) {
  lab.clearDeviceTraffic(key);
}

function renderAll() {
  renderSetup();
  renderDevice('one');
  renderDevice('two');
  renderServer();
}

function renderSetup() {
  const initialized = Object.values(state.devices).every(
    (device) => device.session,
  );

  const createButton = elements.createForm.querySelector('button[type="submit"]');
  const joinButton = elements.joinForm.querySelector('button[type="submit"]');

  createButton.disabled = !initialized || !state.devices.one.online;
  joinButton.disabled =
    !initialized ||
    !state.devices.two.online ||
    !elements.joinGroupId.value ||
    Boolean(
      state.devices.two.replica?.confirmed_snapshot &&
      !state.devices.two.replica.hidden,
    );
  elements.initialize.disabled = initialized;
  elements.initialize.textContent = initialized
    ? 'Devices initialized'
    : 'Initialize both devices';

  if (!initialized) {
    elements.setupSummary.textContent =
      'Initialize the two independent device identities to begin.';
  } else if (!state.groupId) {
    elements.setupSummary.textContent =
      'Both devices are ready. Create a group from Device 1.';
  } else {
    const joined = Boolean(state.devices.two.replica?.confirmed_snapshot);

    elements.setupSummary.textContent = joined
      ? `Group ${String(state.groupId)} is present on both devices. Try taking one offline.`
      : `Group ${String(state.groupId)} exists on Device 1 and the server. Device 2 can join now.`;
  }
}

function renderDevice(key) {
  const device = state.devices[key];
  const view = deviceViews[key];
  const replica = device.replica;
  const snapshot = replica?.projected_snapshot;

  renderConnection(view.toggle, device.online);
  renderRealtimeToggle(view.realtimeToggle, device);
  renderRealtimeEvents(view.realtimeEvents, device.realtimeEvents);
  view.identity.textContent = device.session
    ? `Identity ${shortId(device.session.identity.id)} · Device ${shortId(device.session.device.id)}`
    : 'Identity not initialized';
  view.revision.textContent = replica?.revision ?? '—';

  renderGroupEditor(view.groupEditor, snapshot?.group ?? null);

  if (!snapshot) {
    view.memberList.replaceChildren();
  } else {
    renderMembers(view.memberList, snapshot, device.session?.identity.id, true);
  }

  renderCommands(key);
  renderTraffic(key);

  const hasActiveGroup = Boolean(snapshot) && !replica?.hidden;

  for (const control of view.actions.querySelectorAll('button, input, select')) {
    control.disabled = !hasActiveGroup;
  }

  view.leave.disabled = !hasActiveGroup || !device.online;
  view.sync.disabled = !hasActiveGroup || !device.online;
  view.rejoin.hidden = !replica?.hidden;
  view.rejoin.disabled = !replica?.hidden || !device.online;
  view.rawState.textContent = JSON.stringify(
    replica ?? {
      online: device.online,
      session: device.session,
      group_id: state.groupId,
      message: 'No local group data',
    },
    null,
    2,
  );
}

// The label keeps updating while a rename is open; only its field is left alone.
function renderGroupEditor(element, group) {
  element.querySelector('[data-role="name-label"]').textContent =
    group?.name ?? 'No group';
  element.querySelector('[data-role="group-detail"]').textContent = group
    ? `${group.currency_code} · ${group.id}`
    : '';
}

function renderGroupSummary(element, group) {
  element.replaceChildren();
  const title = document.createElement('strong');
  const detail = document.createElement('p');

  title.textContent = group.name;
  detail.className = 'member-note';
  detail.textContent = `${group.currency_code} · ${group.id}`;
  element.append(title, detail);
}

function renderMembers(element, snapshot, identityId, editable = false) {
  const members = snapshot.members.filter(({ status }) => status === 'active');

  const preferredByMember = (member) =>
    snapshot.access_grants.filter(
      (grant) => grant.preferred_member_id === member.id && !grant.hidden_at,
    );

  if (!editable) {
    element.replaceChildren(
      ...members.map((member) => {
        const row = document.createElement('div');
        const name = document.createElement('span');
        const note = document.createElement('span');

        row.className = 'member-row server-member';
        name.className = 'member-name';
        name.textContent = member.display_name;
        note.className = 'member-note';
        note.textContent = describeUsers(preferredByMember(member), null);
        row.append(name, note);

        return row;
      }),
    );

    return;
  }

  // Rows are updated in place so a background synchronization never
  // replaces, and thereby closes and saves, an open rename field.
  const existing = new Map(
    [...element.children].map((row) => [row.dataset.memberId, row]),
  );

  members.forEach((member, index) => {
    const row = existing.get(member.id) ?? createMemberRow(member.id);

    existing.delete(member.id);
    updateMemberRow(row, member, preferredByMember(member), identityId);

    if (element.children[index] !== row) {
      element.insertBefore(row, element.children[index] ?? null);
    }
  });

  for (const row of existing.values()) row.remove();
}

function createMemberRow(memberId) {
  const row = document.createElement('form');
  const line = document.createElement('div');
  const name = document.createElement('span');
  const edit = document.createElement('button');
  const prefer = document.createElement('button');
  const remove = document.createElement('button');
  const users = document.createElement('span');

  row.className = 'member-row';
  row.dataset.memberId = memberId;
  line.className = 'name-line';
  line.dataset.edit = 'member';
  name.className = 'editable-name';
  name.dataset.role = 'name-label';
  edit.type = 'button';
  edit.className = 'edit-button';
  edit.dataset.action = 'edit-name';
  edit.textContent = '✎';
  line.append(name, edit);
  prefer.type = 'submit';
  prefer.name = 'intent';
  prefer.value = 'prefer';
  remove.type = 'submit';
  remove.name = 'intent';
  remove.value = 'remove';
  remove.className = 'remove-button';
  remove.textContent = 'Delete';
  users.dataset.role = 'member-users';
  row.append(line, prefer, remove, users);

  return row;
}

function updateMemberRow(row, member, preferredBy, identityId) {
  const name = row.querySelector('[data-role="name-label"]');
  const edit = row.querySelector('[data-action="edit-name"]');
  const prefer = row.querySelector('button[value="prefer"]');
  const users = row.querySelector('[data-role="member-users"]');
  const isYou = preferredBy.some((grant) => grant.identity_id === identityId);

  name.textContent = member.display_name;
  edit.title = `Rename ${member.display_name}`;
  edit.setAttribute('aria-label', `Rename ${member.display_name}`);
  prefer.className = `you-button${isYou ? ' selected' : ''}`;
  prefer.textContent = isYou ? 'You' : 'Set as you';
  users.className = `member-users${preferredBy.length > 1 ? ' shared' : ''}`;
  users.textContent = describeUsers(preferredBy, identityId);
}

// Several identities may use the same member, so list every actor handle.
function describeUsers(preferredBy, identityId) {
  if (preferredBy.length === 0) return 'Not used by anyone';

  const handles = preferredBy.map((grant) =>
    grant.identity_id === identityId
      ? `${grant.actor_handle} (you)`
      : grant.actor_handle,
  );

  return `Used by ${handles.join(', ')}`;
}

function renderCommands(key) {
  const device = state.devices[key];
  const element = deviceViews[key].commands;

  element.replaceChildren();

  if (device.commands.length === 0) {
    element.innerHTML = '<span class="empty">No commands.</span>';

    return;
  }

  for (const entry of device.commands) {
    const card = document.createElement('div');
    const summary = document.createElement('strong');
    const status = document.createElement('span');
    const detail = document.createElement('small');

    card.className = `command-card ${entry.status}`;
    summary.textContent = summarizeCommand(entry.command);
    status.className = 'command-status';
    status.textContent = entry.status.replace('_', ' ');
    detail.textContent = `${shortId(entry.command.command_id)}${entry.detail ? ` · ${describeReason(entry.detail)}` : ''}`;
    card.append(summary, status, detail);
    element.append(card);
  }
}

function describeReason(reason) {
  return reason === 'member_merged'
    ? 'already added by someone else; merged into that member'
    : reason;
}

function renderTraffic(key) {
  const device = state.devices[key];
  const view = deviceViews[key];

  renderRequestList(view.requests, device.requests);
}

function renderRequestList(element, entries, { showSource = false } = {}) {
  element.replaceChildren();

  if (entries.length === 0) {
    element.innerHTML = '<span class="empty">No requests.</span>';

    return;
  }

  for (const entry of entries) {
    const item = document.createElement('details');
    const summary = document.createElement('summary');
    const method = document.createElement('span');
    const endpoint = document.createElement('code');
    const important = document.createElement('span');
    const result = document.createElement('span');
    const time = document.createElement('span');
    const exchange = document.createElement('div');
    const outcome = requestOutcome(entry);

    item.className = `request-card ${outcome}`;
    method.className = `method method-${entry.method.toLowerCase()}`;
    endpoint.className = 'endpoint';
    important.className = 'request-important';
    result.className = 'request-result';
    time.className = 'request-time';
    exchange.className = 'exchange';
    method.textContent = entry.method;
    endpoint.textContent = entry.path;
    important.textContent = showSource
      ? `${entry.from} · ${summarizeRequest(entry)}`
      : summarizeRequest(entry);
    result.textContent = summarizeResult(entry.result);
    time.textContent = entry.at;

    summary.append(method, endpoint, important, result, time);
    exchange.append(
      renderExchangeBlock('Request body', entry.body),
      renderExchangeBlock(
        'Response',
        entry.result?.kind === 'network_error'
          ? { error: entry.result.error }
          : entry.result?.body ?? 'Waiting for response…',
      ),
    );
    item.append(summary, exchange);
    element.append(item);
  }
}

function renderExchangeBlock(label, value) {
  const block = document.createElement('section');
  const heading = document.createElement('strong');
  const content = document.createElement('pre');

  block.className = 'exchange-block';
  heading.textContent = label;
  content.textContent = formatJson(value);
  block.append(heading, content);

  return block;
}

function requestOutcome(entry) {
  if (!entry.result) return 'pending';

  if (entry.result.kind === 'network_error' || entry.result.status >= 400) {
    return 'error';
  }

  return 'success';
}

function summarizeResult(result) {
  if (!result) return 'Pending';

  if (result.kind === 'network_error') {
    return `Network error · ${result.duration_ms}ms`;
  }

  return `${result.status} · ${result.duration_ms}ms`;
}

function summarizeRequest(entry) {
  const body = entry.body;

  if (entry.path === '/identities/anonymous') return 'Create anonymous identity';

  if (Array.isArray(body?.commands)) {
    if (body.commands.length === 0) {
      return `Check for changes after revision ${body.known_revision}`;
    }

    return body.commands.map(summarizeCommand).join(' · ');
  }

  if (body?.creator_member_name) {
    return `${body.name} · ${body.currency_code} · creator ${body.creator_member_name}`;
  }

  if (body?.preferred_member) {
    const preferred = body.preferred_member;

    return preferred.kind === 'new'
      ? `Join as new member ${preferred.display_name}`
      : `Join as existing member ${shortId(preferred.member_id)}`;
  }

  if (body === null) return 'No request body';

  return summarizeFields(body);
}

function summarizeCommand(command) {
  const payload = command.payload ?? {};

  switch (command.type) {
    case 'group.rename':
      return `Rename group to ${payload.name}`;
    case 'member.create':
      return `Add member ${payload.display_name}`;
    case 'member.rename':
      return `Rename member to ${payload.display_name}`;
    case 'member.archive':
      return `Delete member ${shortId(payload.member_id)}`;
    case 'preference.set':
      return `Set “you” to ${shortId(payload.member_id)}`;
    case 'group.leave':
      return 'Leave group';
    default:
      return command.type;
  }
}

function summarizeFields(value) {
  const serialized = JSON.stringify(value) ?? String(value);

  return serialized.length > 100
    ? `${serialized.slice(0, 97)}…`
    : serialized;
}

function formatJson(value) {
  return JSON.stringify(value, null, 2) ?? String(value);
}

function renderServer() {
  const snapshot = state.server.snapshot;

  renderConnection(elements.serverToggle, state.server.online);
  elements.serverRevision.textContent = state.server.revision ?? '—';
  elements.refreshServer.disabled = !state.server.online;
  elements.resetServer.disabled = !state.server.online;

  renderIdentityDirectory();
  renderSubscribers();

  if (snapshot) {
    renderGroupSummary(elements.serverGroupSummary, snapshot.group);
    renderMembers(elements.serverMemberList, snapshot, null);
  } else {
    elements.serverGroupSummary.innerHTML = '<p class="empty">The latest server snapshot will appear after group creation.</p>';
    elements.serverMemberList.replaceChildren();
  }

  elements.serverState.textContent = JSON.stringify(
    {
      online: state.server.online,
      identity_directory: state.server.identityDirectory,
      revision: state.server.revision,
      snapshot: state.server.snapshot,
    },
    null,
    2,
  );
  renderServerTraffic();
}

function renderIdentityDirectory() {
  const directory = state.server.identityDirectory;

  if (!directory) {
    elements.serverIdentityList.innerHTML =
      '<span class="empty">Inspection unavailable outside local development.</span>';

    return;
  }

  if (directory.identities.length === 0) {
    elements.serverIdentityList.innerHTML =
      '<span class="empty">No identities.</span>';

    return;
  }

  elements.serverIdentityList.replaceChildren(
    ...directory.identities.map((identity) => {
      const row = document.createElement('div');
      row.className = 'directory-identity';

      const heading = document.createElement('strong');
      heading.textContent = `Identity ${identity.id}`;
      row.append(heading);

      for (const device of identity.devices) {
        const deviceRow = document.createElement('span');
        deviceRow.className = 'directory-device';
        deviceRow.textContent = `Device ${device.id} · ${device.revoked_at ? 'revoked' : 'active'}`;
        row.append(deviceRow);
      }

      return row;
    }),
  );
}

function renderServerTraffic() {
  renderRequestList(elements.serverIncoming, state.server.incoming, {
    showSource: true,
  });
}

function renderRealtimeToggle(button, device) {
  const status = device.realtime ? device.realtimeStatus : 'off';

  const labels = {
    off: device.realtime ? 'Live idle' : 'Live off',
    connecting: 'Live …',
    open: 'Live',
    disconnected: 'Live retrying',
  };

  button.className = `realtime-toggle ${status}`;
  button.textContent = labels[status];
  button.setAttribute('aria-pressed', String(device.realtime));
}

function renderRealtimeEvents(element, events) {
  if (events.length === 0) {
    element.innerHTML = '<span class="empty">No realtime activity.</span>';

    return;
  }

  element.replaceChildren(
    ...events.map((event) => {
      const row = document.createElement('div');
      const time = document.createElement('time');
      const detail = document.createElement('span');

      row.className = `realtime-event ${event.phase}`;
      time.textContent = event.at;
      detail.textContent = event.detail;
      row.append(time, detail);

      return row;
    }),
  );
}

function renderSubscribers() {
  const subscribers = state.server.subscribers;

  if (subscribers.length === 0) {
    elements.serverSubscribers.innerHTML = '<span class="empty">No subscribers.</span>';

    return;
  }

  elements.serverSubscribers.replaceChildren(
    ...subscribers.map((identityId) => {
      const row = document.createElement('div');

      const label = Object.values(state.devices).find(
        (device) => device.session?.identity.id === identityId,
      )?.label;

      row.className = 'realtime-event open';
      row.textContent = `${label ?? 'Identity'} · ${shortId(identityId)}`;

      return row;
    }),
  );
}

function renderConnection(button, online) {
  button.className = `connection-toggle ${online ? 'online' : 'offline'}`;
  button.textContent = online ? 'Online' : 'Offline';
}

function readText(formData, name) {
  return String(formData.get(name) ?? '').trim();
}

function shortId(value) {
  if (!value) return '—';

  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

let toastTimer;

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast visible ${error ? 'error' : ''}`;
  toastTimer = setTimeout(() => {
    elements.toast.className = 'toast';
  }, 4200);
}

function describeError(error) {
  if (error instanceof ClientOfflineError) {
    return 'This action requires the device to be online.';
  }

  if (error instanceof SplitnextRequestError) {
    return `Server rejected the request: ${error.code}`;
  }

  if (error instanceof Error) {
    if (error.message === 'server_offline') return 'The simulated server is offline.';

    if (error.message === 'device_offline') return 'This device is offline.';

    return error.message;
  }

  return 'Unexpected error';
}

