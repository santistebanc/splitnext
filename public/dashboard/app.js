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
  serverIncoming: document.querySelector('#server-incoming'),
  serverState: document.querySelector('#server-state'),
  refreshServer: document.querySelector('#refresh-server'),
  clearServerTraffic: document.querySelector('#clear-server-traffic'),
  toast: document.querySelector('#toast'),
};

const deviceViews = Object.fromEntries(
  [...document.querySelectorAll('[data-device]')].map((root) => [
    root.dataset.device,
    {
      root,
      toggle: root.querySelector('[data-action="toggle-device"]'),
      identity: root.querySelector('[data-role="identity"]'),
      revision: root.querySelector('[data-role="revision"]'),
      groupSummary: root.querySelector('[data-action-form="rename-group"]'),
      memberList: root.querySelector('[data-role="member-list"]'),
      actions: root.querySelector('[data-role="actions"]'),
      sync: root.querySelector('[data-action="sync"]'),
      leave: root.querySelector('[data-action="leave"]'),
      rejoin: root.querySelector('[data-action="rejoin"]'),
      renameGroupForm: root.querySelector('[data-action-form="rename-group"]'),
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
  elements.clearServerTraffic.addEventListener('click', () => {
    lab.clearServerTraffic();
  });

  for (const [key, view] of Object.entries(deviceViews)) {
    view.toggle.addEventListener('click', () => toggleDevice(key));
    view.sync.addEventListener('click', () => synchronizeDevice(key));
    view.leave.addEventListener('click', () => leaveGroup(key));
    view.rejoin.addEventListener('click', () => rejoinGroup(key));
    view.clearTraffic.addEventListener('click', () => clearDeviceTraffic(key));
    view.renameGroupForm.addEventListener('submit', (event) =>
      renameGroup(event, key),
    );
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

function toggleServer() {
  lab.toggleServer();
  showToast(
    state.server.online
      ? 'Server is available again. Bring devices online or sync manually.'
      : 'Server outage simulated. Device requests will fail but outboxes remain safe.',
  );
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

async function renameGroup(event, key) {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);

  await runMutation(key, () => lab.renameGroup(key, readText(fields, 'name')), 'Group rename recorded');
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

  const fields = new FormData(form);
  const memberId = readText(fields, 'member_id');
  const intent = event.submitter?.value;
  let operation;
  let message;

  if (intent === 'prefer') {
    operation = () => lab.selectPreferredMember(key, memberId);
    message = 'Preferred “you” member updated';
  } else if (intent === 'rename') {
    const displayName = readText(fields, 'display_name');

    if (!displayName) {
      showToast('Enter a new member name before renaming', true);

      return;
    }

    operation = () => lab.renameMember(key, memberId, displayName);
    message = 'Member rename recorded';
  } else {
    operation = () => lab.removeMember(key, memberId);
    message = 'Member removal recorded';
  }

  await runMutation(key, operation, message);
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
    await operation();
    showToast(
      device.online
        ? successMessage
        : `${successMessage}; queued locally while offline`,
    );
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
  view.identity.textContent = device.session
    ? `Identity ${shortId(device.session.identity.id)} · Device ${shortId(device.session.device.id)}`
    : 'Identity not initialized';
  view.revision.textContent = replica?.revision ?? '—';

  if (!snapshot) {
    renderEmptyGroupEditor(view.groupSummary);
    view.memberList.replaceChildren();
  } else {
    renderGroupSummary(view.groupSummary, snapshot.group);
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

function renderGroupSummary(element, group) {
  const input = element.querySelector('input[name="name"]');
  const existingDetail = element.querySelector('[data-role="group-detail"]');

  if (input && existingDetail) {
    if (document.activeElement !== input) input.value = group.name;

    existingDetail.textContent = `${group.currency_code} · ${group.id}`;

    return;
  }

  element.replaceChildren();
  const title = document.createElement('strong');
  const detail = document.createElement('p');

  title.textContent = group.name;
  detail.className = 'member-note';
  detail.textContent = `${group.currency_code} · ${group.id}`;
  element.append(title, detail);
}

function renderEmptyGroupEditor(element) {
  const input = element.querySelector('input[name="name"]');
  const detail = element.querySelector('[data-role="group-detail"]');

  if (input && document.activeElement !== input) input.value = '';

  if (detail) detail.textContent = 'No group';
}

function renderMembers(element, snapshot, identityId, editable = false) {
  element.replaceChildren();

  for (const member of snapshot.members.filter(({ status }) => status === 'active')) {
    const preferredBy = snapshot.access_grants.filter(
      (grant) => grant.preferred_member_id === member.id && !grant.hidden_at,
    );

    const isYou = preferredBy.some((grant) => grant.identity_id === identityId);
    const row = document.createElement(editable ? 'form' : 'div');

    row.className = `member-row${editable ? '' : ' server-member'}`;

    if (!editable) {
      const name = document.createElement('span');
      const note = document.createElement('span');

      name.className = 'member-name';
      name.textContent = member.display_name;
      note.className = 'member-note';
      note.textContent = preferredBy.length
        ? preferredBy.map(({ actor_handle }) => actor_handle).join(', ')
        : 'Not preferred';
      row.append(name, note);
      element.append(row);

      continue;
    }

    const memberId = document.createElement('input');
    const name = document.createElement('input');
    const save = document.createElement('button');
    const prefer = document.createElement('button');
    const remove = document.createElement('button');

    memberId.type = 'hidden';
    memberId.name = 'member_id';
    memberId.value = member.id;
    name.name = 'display_name';
    name.value = member.display_name;
    name.maxLength = 100;
    name.required = true;
    name.setAttribute('aria-label', `${member.display_name} name`);
    save.type = 'submit';
    save.name = 'intent';
    save.value = 'rename';
    save.textContent = 'Save';
    prefer.type = 'submit';
    prefer.name = 'intent';
    prefer.value = 'prefer';
    prefer.className = `you-button${isYou ? ' selected' : ''}`;
    prefer.textContent = isYou ? 'You' : 'Set as you';
    remove.type = 'submit';
    remove.name = 'intent';
    remove.value = 'remove';
    remove.className = 'remove-button';
    remove.textContent = 'Delete';
    row.append(memberId, name, save, prefer, remove);
    element.append(row);
  }
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
    detail.textContent = `${shortId(entry.command.command_id)}${entry.detail ? ` · ${entry.detail}` : ''}`;
    card.append(summary, status, detail);
    element.append(card);
  }
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

  renderIdentityDirectory();

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
