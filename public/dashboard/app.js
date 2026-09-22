import {
  SplitnextClient,
  SplitnextRequestError,
} from '/sdk/splitnext-client.js';

const elements = {
  healthStatus: document.querySelector('#health-status'),
  readyStatus: document.querySelector('#ready-status'),
  identityAStatus: document.querySelector('#identity-a-status'),
  identityBStatus: document.querySelector('#identity-b-status'),
  createIdentities: document.querySelector('#create-identities'),
  createGroupForm: document.querySelector('#create-group-form'),
  groupFields: document.querySelector('#group-fields'),
  groupResult: document.querySelector('#group-result'),
  joinDeviceForm: document.querySelector('#join-device-form'),
  syncControls: document.querySelector('#sync-controls'),
  serverRevision: document.querySelector('#server-revision'),
  serverState: document.querySelector('#server-state'),
  serverIncoming: document.querySelector('#server-incoming'),
  activityList: document.querySelector('#activity-list'),
  clearActivity: document.querySelector('#clear-activity'),
  toast: document.querySelector('#toast'),
};

const deviceViews = Object.fromEntries(
  [...document.querySelectorAll('[data-replica]')].map((root) => [
    root.dataset.replica,
    {
      root,
      identityId: root.querySelector('[data-role="identity-id"]'),
      connectionStatus: root.querySelector('[data-role="connection-status"]'),
      toggleConnection: root.querySelector('[data-action="toggle-connection"]'),
      loadSnapshot: root.querySelector('[data-action="load-snapshot"]'),
      syncCurrent: root.querySelector('[data-action="sync-current"]'),
      memberForm: root.querySelector('[data-role="member-form"]'),
      renameForm: root.querySelector('[data-role="rename-form"]'),
      archiveForm: root.querySelector('[data-role="archive-form"]'),
      retryCommand: root.querySelector('[data-action="retry-command"]'),
      pendingCount: root.querySelector('[data-role="pending-count"]'),
      pendingCommands: root.querySelector('[data-role="pending-commands"]'),
      syncMeta: root.querySelector('[data-role="sync-meta"]'),
      localState: root.querySelector('[data-role="local-state"]'),
      outgoingData: root.querySelector('[data-role="outgoing-data"]'),
      incomingData: root.querySelector('[data-role="incoming-data"]'),
    },
  ]),
);

function emptyDevice() {
  return {
    api: null,
    deviceApi: null,
    secret: null,
    session: null,
    hasAccess: false,
    knownRevision: null,
    isOffline: false,
    isSyncing: false,
    pendingCommands: [],
    snapshot: null,
    lastCommand: null,
    outgoing: [],
    incoming: [],
  };
}

const state = {
  devices: { a: emptyDevice(), b: emptyDevice() },
  pendingGroupInput: null,
  pendingJoin: null,
  createdGroup: null,
  server: { revision: null, snapshot: null, incoming: [] },
  activity: [],
};

const systemApi = new SplitnextClient({ baseUrl: window.location.origin });

function createDeviceApi(deviceId) {
  const device = state.devices[deviceId];

  return new SplitnextClient({
    baseUrl: window.location.origin,
    observer: {
      onRequest(event) {
        const transportEntry = {
          method: event.method,
          path: redactPath(event.path),
          body: redactBody(event.body),
        };

        pushLog(device.outgoing, transportEntry);
        pushLog(state.server.incoming, {
          from: `Device ${deviceId.toUpperCase()}`,
          ...transportEntry,
        });
        renderTransport();
      },
      onResponse(event) {
        pushLog(device.incoming, {
          status: event.status,
          body: event.response,
        });
        recordActivity(
          event.method,
          redactPath(event.path),
          event.status,
          event.duration_ms,
        );
        observeServerResponse(event.response);
        renderTransport();
      },
      onNetworkError(event) {
        pushLog(device.incoming, { status: 0, error: 'network_error' });
        recordActivity(
          event.method,
          redactPath(event.path),
          0,
          event.duration_ms,
          'network_error',
        );
        renderTransport();
      },
    },
  });
}

async function refreshDependencies() {
  const [health, ready] = await Promise.allSettled([
    systemApi.health(),
    systemApi.readiness(),
  ]);

  setStatus(elements.healthStatus, health.status === 'fulfilled', 'Worker');
  setStatus(
    elements.readyStatus,
    ready.status === 'fulfilled' && ready.value.ok,
    'Storage',
  );
}

function setStatus(element, available, label) {
  element.textContent = `${label} ${available ? 'ready' : 'unavailable'}`;
  element.className = available ? 'ok' : 'error';
}

async function createIdentities() {
  setBusy(elements.createIdentities, true);

  try {
    for (const deviceId of ['a', 'b']) {
      const device = state.devices[deviceId];

      device.secret ??= generateDeviceSecret();
      device.api ??= createDeviceApi(deviceId);
      device.session = await device.api.createAnonymousIdentity(device.secret);
      device.deviceApi = device.api.forDevice(device.secret);
    }

    showToast('Both device identities are ready');
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(elements.createIdentities, false);
    renderAll();
  }
}

async function createGroup(event) {
  event.preventDefault();

  if (!state.devices.a.session) return;

  const button = event.submitter;
  const fields = new FormData(elements.createGroupForm);

  state.pendingGroupInput ??= {
    group_id: crypto.randomUUID(),
    name: readText(fields, 'name'),
    currency_code: readText(fields, 'currency_code'),
    creator_member_name: readText(fields, 'creator_member_name'),
  };
  setBusy(button, true);

  try {
    const created = await state.devices.a.deviceApi.createGroup(
      state.pendingGroupInput,
    );

    state.createdGroup = created;
    state.pendingGroupInput = null;
    state.devices.a.hasAccess = true;
    state.devices.a.knownRevision = created.group.revision;
    state.devices.a.snapshot = snapshotFromCreatedGroup(created);
    observeServerResponse({
      revision: created.group.revision,
      snapshot: state.devices.a.snapshot,
    });
    showToast('Device A created the group');
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(button, false);
    renderAll();
  }
}

async function joinDeviceB(event) {
  event.preventDefault();

  if (!state.createdGroup || !state.devices.b.session) return;

  const button = event.submitter;
  const fields = new FormData(elements.joinDeviceForm);
  const displayName = readText(fields, 'display_name');

  if (findActiveMemberByName(state.server.snapshot, displayName)) {
    showToast(`An active member named ${displayName} already exists`, true);

    return;
  }

  setBusy(button, true);

  try {
    if (!state.pendingJoin) {
      const link = await state.devices.a.deviceApi.rotateGroupLink(
        state.createdGroup.group.id,
      );

      state.devices.a.knownRevision = link.revision;
      state.devices.a.snapshot = link.snapshot;
      state.pendingJoin = {
        token: link.invite.token,
        memberId: crypto.randomUUID(),
      };
    }

    const joined = await state.devices.b.deviceApi.redeemGroupLink(
      state.createdGroup.group.id,
      state.pendingJoin.token,
      {
        preferred_member: {
          kind: 'new',
          member_id: state.pendingJoin.memberId,
          display_name: displayName,
        },
      },
    );

    state.devices.b.hasAccess = true;
    state.devices.b.knownRevision = joined.revision;
    state.devices.b.snapshot = joined.snapshot;
    state.pendingJoin = null;
    showToast('Device B joined with a separate identity');
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(button, false);
    renderAll();
  }
}

async function syncDevice(deviceId, knownRevision, button, commands, consumesQueue) {
  const device = state.devices[deviceId];

  if (!state.createdGroup || !device.hasAccess) return false;

  device.isSyncing = true;
  setBusy(button, true);
  renderDevice(deviceId);

  try {
    const response = await device.deviceApi.syncGroup(
      state.createdGroup.group.id,
      { known_revision: knownRevision, commands },
    );

    device.knownRevision = response.revision;

    if (response.state.kind === 'snapshot') {
      device.snapshot = response.state.snapshot;
    }

    if (consumesQueue) {
      const acknowledgedIds = new Set(
        response.outcomes.map((outcome) => outcome.command_id),
      );

      device.pendingCommands = device.pendingCommands.filter(
        (command) => !acknowledgedIds.has(command.command_id),
      );
    }

    const unsuccessful = response.outcomes.filter(
      (outcome) => outcome.status !== 'applied' && outcome.status !== 'no_effect',
    );

    if (unsuccessful.length > 0) {
      const reasons = [...new Set(unsuccessful.map((outcome) => outcome.reason))]
        .join(', ');

      showToast(
        `${unsuccessful.length} command${unsuccessful.length === 1 ? '' : 's'} not applied: ${reasons}`,
        true,
      );
    } else {
      showToast(
        `Device ${deviceId.toUpperCase()} received ${response.state.kind}`,
      );
    }

    return true;
  } catch (error) {
    showToast(describeError(error), true);

    return false;
  } finally {
    device.isSyncing = false;
    setBusy(button, false);
    renderAll();
  }
}

function flushDevice(deviceId, button, knownRevision) {
  const commands = [...state.devices[deviceId].pendingCommands];

  return syncDevice(deviceId, knownRevision, button, commands, true);
}

async function toggleConnection(deviceId, button) {
  const device = state.devices[deviceId];

  if (!device.isOffline) {
    device.isOffline = true;
    renderDevice(deviceId);
    showToast(`Device ${deviceId.toUpperCase()} is offline`);

    return;
  }

  device.isOffline = false;
  renderDevice(deviceId);
  await flushDevice(deviceId, button, device.knownRevision);
}

async function createMemberCommand(deviceId, event) {
  event.preventDefault();

  const device = state.devices[deviceId];
  const fields = new FormData(deviceViews[deviceId].memberForm);
  const displayName = readText(fields, 'display_name');

  if (findActiveMemberByName(projectLocalSnapshot(device), displayName)) {
    showToast(`An active member named ${displayName} already exists`, true);

    return;
  }

  const command = {
    command_id: crypto.randomUUID(),
    type: 'member.create',
    payload: {
      member_id: crypto.randomUUID(),
      display_name: displayName,
    },
  };

  enqueueCommand(device, command);
  renderDevice(deviceId);

  if (device.isOffline) {
    showToast(`Queued on Device ${deviceId.toUpperCase()}`);

    return;
  }

  await flushDevice(deviceId, event.submitter, device.knownRevision);
}

async function renameMember(deviceId, event) {
  event.preventDefault();

  const device = state.devices[deviceId];
  const fields = new FormData(deviceViews[deviceId].renameForm);
  const memberId = readText(fields, 'member_id');
  const localSnapshot = projectLocalSnapshot(device);

  const member = localSnapshot?.members.find(
    (candidate) => candidate.id === memberId,
  );

  if (!member) {
    showToast('Load a snapshot and select a member first', true);

    return;
  }

  const displayName = readText(fields, 'display_name');

  if (
    findActiveMemberByName(localSnapshot, displayName, member.id)
  ) {
    showToast(`An active member named ${displayName} already exists`, true);

    return;
  }

  const command = {
    command_id: crypto.randomUUID(),
    type: 'member.rename',
    payload: {
      member_id: member.id,
      expected_display_name: member.display_name,
      display_name: displayName,
    },
  };

  enqueueCommand(device, command);
  renderDevice(deviceId);

  if (device.isOffline) {
    showToast(`Queued rename on Device ${deviceId.toUpperCase()}`);

    return;
  }

  await flushDevice(deviceId, event.submitter, device.knownRevision);
}

async function archiveMember(deviceId, event) {
  event.preventDefault();

  const device = state.devices[deviceId];
  const fields = new FormData(deviceViews[deviceId].archiveForm);
  const memberId = readText(fields, 'member_id');

  const member = projectLocalSnapshot(device)?.members.find(
    (candidate) => candidate.id === memberId && candidate.status === 'active',
  );

  if (!member) {
    showToast('Load a snapshot and select an active member first', true);

    return;
  }

  const command = {
    command_id: crypto.randomUUID(),
    type: 'member.archive',
    payload: { member_id: member.id },
  };

  enqueueCommand(device, command);
  renderDevice(deviceId);

  if (device.isOffline) {
    showToast(`Queued archive on Device ${deviceId.toUpperCase()}`);

    return;
  }

  await flushDevice(deviceId, event.submitter, device.knownRevision);
}

function enqueueCommand(device, command) {
  device.lastCommand = command;
  device.pendingCommands.push(command);
}

async function retryCommand(deviceId, button) {
  const device = state.devices[deviceId];

  if (!device.lastCommand || device.isOffline) return;

  const commandIsPending = device.pendingCommands.some(
    (command) => command.command_id === device.lastCommand.command_id,
  );

  if (commandIsPending) {
    await flushDevice(deviceId, button, device.knownRevision);

    return;
  }

  await syncDevice(
    deviceId,
    device.knownRevision,
    button,
    [device.lastCommand],
    false,
  );
}

function renderAll() {
  renderIdentities();
  renderGroup();
  renderDevice('a');
  renderDevice('b');
  renderServer();
}

function renderIdentities() {
  renderIdentity(elements.identityAStatus, state.devices.a);
  renderIdentity(elements.identityBStatus, state.devices.b);
  elements.createIdentities.hidden = Boolean(
    state.devices.a.session && state.devices.b.session,
  );
  elements.groupFields.disabled = !state.devices.a.session;
}

function renderIdentity(element, device) {
  if (!device.session) {
    element.textContent = 'Not initialized.';

    return;
  }

  const { identity, device: identityDevice } = device.session;

  element.innerHTML = `<dl><div><dt>Identity</dt><dd>${escapeHtml(identity.id)}</dd></div><div><dt>Credential</dt><dd>${escapeHtml(identityDevice.id)}</dd></div></dl>`;
}

function renderGroup() {
  if (!state.createdGroup) {
    elements.groupResult.textContent = state.devices.a.session
      ? 'Device A can create the group.'
      : 'Create both device identities first.';
    elements.joinDeviceForm.hidden = true;
    elements.syncControls.hidden = true;

    return;
  }

  const { group, member, access } = state.createdGroup;

  elements.groupResult.innerHTML = `<dl><div><dt>Group</dt><dd>${escapeHtml(group.id)}</dd></div><div><dt>Created at</dt><dd>${escapeHtml(group.created_at)}</dd></div><div><dt>First member</dt><dd>${escapeHtml(member.display_name)}</dd></div><div><dt>Device A</dt><dd>${escapeHtml(access.actor_handle)}</dd></div></dl>`;
  elements.joinDeviceForm.hidden = state.devices.b.hasAccess;
  elements.syncControls.hidden = false;
}

function renderDevice(deviceId) {
  const device = state.devices[deviceId];
  const view = deviceViews[deviceId];

  const revisionLabel = device.knownRevision === null
    ? 'no revision'
    : `revision ${device.knownRevision}`;

  const disabled = !device.hasAccess || device.isSyncing;

  view.identityId.textContent = device.session?.identity.id ?? 'No identity';
  view.connectionStatus.textContent = device.hasAccess
    ? `${device.isOffline ? 'Offline' : 'Online'} · ${revisionLabel}`
    : 'Waiting for access';
  view.connectionStatus.className = `connection-status${device.isOffline ? ' offline' : ''}`;
  view.toggleConnection.textContent = device.isOffline
    ? 'Go online & sync'
    : 'Go offline';
  view.toggleConnection.disabled = disabled;
  view.loadSnapshot.disabled = disabled || device.isOffline;
  view.syncCurrent.disabled = disabled || device.isOffline;

  for (const control of view.memberForm.elements) control.disabled = disabled;

  const localSnapshot = projectLocalSnapshot(device);

  populateMemberOptions(view.renameForm, localSnapshot);
  populateMemberOptions(view.archiveForm, localSnapshot);

  for (const control of view.renameForm.elements) control.disabled = disabled;

  for (const control of view.archiveForm.elements) control.disabled = disabled;

  view.retryCommand.disabled =
    disabled || device.isOffline || !device.lastCommand;
  view.pendingCount.textContent = `${device.pendingCommands.length} queued`;
  view.pendingCommands.innerHTML = device.pendingCommands.length === 0
    ? '<p class="empty">The offline queue is empty.</p>'
    : device.pendingCommands
        .map(
          (command) => `<div class="pending-command"><strong>${escapeHtml(describeCommand(command))}</strong><code>${escapeHtml(command.command_id.slice(0, 8))}</code></div>`,
        )
        .join('');
  view.syncMeta.textContent = `${revisionLabel} · ${device.pendingCommands.length} pending`;
  view.localState.textContent = JSON.stringify(
    { revision: device.knownRevision, snapshot: localSnapshot },
    null,
    2,
  );
  view.outgoingData.textContent = JSON.stringify(device.outgoing, null, 2);
  view.incomingData.textContent = JSON.stringify(device.incoming, null, 2);
}

function renderServer() {
  elements.serverRevision.textContent = state.server.revision === null
    ? 'No state'
    : `Revision ${String(state.server.revision)}`;
  elements.serverState.textContent = JSON.stringify(state.server.snapshot ?? {}, null, 2);
  elements.serverIncoming.textContent = JSON.stringify(state.server.incoming, null, 2);
}

function renderTransport() {
  renderDevice('a');
  renderDevice('b');
  renderServer();
}

function projectLocalSnapshot(device) {
  if (!device.snapshot) return null;

  const snapshot = structuredClone(device.snapshot);

  for (const command of device.pendingCommands) {
    if (command.type === 'member.create') {
      const idExists = snapshot.members.some(
        (member) => member.id === command.payload.member_id,
      );

      const nameExists = findActiveMemberByName(
        snapshot,
        command.payload.display_name,
      );

      if (!idExists && !nameExists) {
        snapshot.members.push({
          id: command.payload.member_id,
          display_name: command.payload.display_name,
          status: 'active',
          created_at: 'pending server timestamp',
          updated_at: 'pending server timestamp',
          _local_pending: true,
        });
      }

      continue;
    }

    if (command.type === 'member.rename') {
      const member = snapshot.members.find(
        (candidate) => candidate.id === command.payload.member_id,
      );

      if (member?.display_name === command.payload.expected_display_name) {
        member.display_name = command.payload.display_name;
        member.updated_at = 'pending server timestamp';
        member._local_pending = true;
      }

      continue;
    }

    const member = snapshot.members.find(
      (candidate) => candidate.id === command.payload.member_id,
    );

    if (member?.status === 'active') {
      member.status = 'archived';
      member.updated_at = 'pending server timestamp';
      member._local_pending = true;

      for (const grant of snapshot.access_grants) {
        if (grant.preferred_member_id === member.id) {
          grant.preferred_member_id = null;
          grant._local_pending = true;
        }
      }
    }
  }

  return snapshot;
}

function findActiveMemberByName(snapshot, displayName, excludedId = null) {
  const requestedNameKey = memberNameKey(displayName);

  return snapshot?.members.find(
    (member) =>
      member.id !== excludedId &&
      member.status === 'active' &&
      memberNameKey(member.display_name) === requestedNameKey,
  );
}

function memberNameKey(displayName) {
  return displayName.trim().normalize('NFKC').toLowerCase();
}

function snapshotFromCreatedGroup(created) {
  return {
    group: {
      id: created.group.id,
      name: created.group.name,
      currency_code: created.group.currency_code,
      created_at: created.group.created_at,
    },
    members: [created.member],
    access_grants: [created.access],
  };
}

function populateMemberOptions(form, snapshot) {
  const select = form.elements.namedItem('member_id');
  const selectedId = select.value;

  const members = snapshot?.members.filter(
    (member) => member.status === 'active',
  ) ?? [];

  select.innerHTML = members.length === 0
    ? '<option value="">Load a snapshot first</option>'
    : members
        .map(
          (member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.display_name)}</option>`,
        )
        .join('');

  if (members.some((member) => member.id === selectedId)) {
    select.value = selectedId;
  }
}

function describeCommand(command) {
  switch (command.type) {
    case 'member.create':
      return `Create ${command.payload.display_name}`;
    case 'member.rename':
      return `Rename ${command.payload.expected_display_name} → ${command.payload.display_name}`;
    case 'member.archive':
      return `Archive ${command.payload.member_id.slice(0, 8)}`;
  }
}

function observeServerResponse(payload) {
  if (!payload) return;

  if (payload.snapshot && Number.isInteger(payload.revision)) {
    state.server.revision = payload.revision;
    state.server.snapshot = payload.snapshot;
  }

  if (
    payload.state?.kind === 'snapshot' &&
    Number.isInteger(payload.revision)
  ) {
    state.server.revision = payload.revision;
    state.server.snapshot = payload.state.snapshot;
  }
}

function pushLog(log, entry) {
  log.unshift({ at: new Date().toISOString(), ...entry });
  log.splice(20);
}

function redactBody(body) {
  if (!body) return null;

  return 'device_secret' in body
    ? { ...body, device_secret: '[generated credential]' }
    : body;
}

function redactPath(path) {
  return path.replace(
    /^(\/join\/[0-9a-f-]+)\/[A-Za-z0-9_-]{43}$/,
    '$1/[invite-token]',
  );
}

function recordActivity(method, path, status, duration, error = null) {
  state.activity.unshift({ method, path, status, duration: Math.round(duration), error });
  state.activity = state.activity.slice(0, 30);
  renderActivity();
}

function renderActivity() {
  if (state.activity.length === 0) {
    elements.activityList.innerHTML = '<p class="empty">Requests will appear here.</p>';

    return;
  }

  elements.activityList.innerHTML = state.activity
    .map((entry) => `<div class="activity-entry"><strong>${entry.method}</strong><code>${escapeHtml(entry.path)}</code><span class="${entry.status >= 400 || entry.status === 0 ? 'error' : 'ok'}">${entry.status || 'ERR'} · ${entry.duration} ms${entry.error ? ` · ${escapeHtml(entry.error)}` : ''}</span></div>`)
    .join('');
}

function generateDeviceSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = String.fromCharCode(...bytes);

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function readText(fields, name) {
  return fields.get(name)?.toString().trim() ?? '';
}

function setBusy(button, busy) {
  button.disabled = busy;

  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = 'Working…';

    return;
  }

  button.textContent = button.dataset.label ?? button.textContent;
  delete button.dataset.label;
}

function describeError(error) {
  if (error instanceof SplitnextRequestError) {
    return `${error.status} · ${error.code}`;
  }

  return error instanceof Error ? error.message : 'unknown_error';
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.className = `toast is-visible${isError ? ' is-error' : ''}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.className = 'toast';
  }, 3_400);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character]);
}

elements.createIdentities.addEventListener('click', createIdentities);

elements.createGroupForm.addEventListener('submit', createGroup);

elements.joinDeviceForm.addEventListener('submit', joinDeviceB);

for (const [deviceId, view] of Object.entries(deviceViews)) {
  view.memberForm.addEventListener('submit', (event) => {
    void createMemberCommand(deviceId, event);
  });
  view.renameForm.addEventListener('submit', (event) => {
    void renameMember(deviceId, event);
  });
  view.archiveForm.addEventListener('submit', (event) => {
    void archiveMember(deviceId, event);
  });
  view.retryCommand.addEventListener('click', (event) => {
    void retryCommand(deviceId, event.currentTarget);
  });
  view.toggleConnection.addEventListener('click', (event) => {
    void toggleConnection(deviceId, event.currentTarget);
  });
  view.loadSnapshot.addEventListener('click', (event) => {
    void flushDevice(deviceId, event.currentTarget, null);
  });
  view.syncCurrent.addEventListener('click', (event) => {
    void flushDevice(
      deviceId,
      event.currentTarget,
      state.devices[deviceId].knownRevision,
    );
  });
}

elements.clearActivity.addEventListener('click', () => {
  state.activity = [];
  renderActivity();
});

renderAll();

void refreshDependencies();
