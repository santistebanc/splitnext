import {
  ClientOfflineError,
  SplitnextRequestError,
  SyncLab,
  LocalStorageLabClientStorage,
  persistedLabDevicesSchema,
} from '/sdk/splitnext-lab.js';

const elements = {
  health: document.querySelector('#health-status'),
  ready: document.querySelector('#ready-status'),
  addDevice: document.querySelector('#add-device'),
  clearDevices: document.querySelector('#clear-devices'),
  setupSummary: document.querySelector('#setup-summary'),
  serverToggle: document.querySelector('#toggle-server'),
  serverRevision: document.querySelector('#server-revision'),
  serverIdentityList: document.querySelector('#server-identity-list'),
  serverGroupTabs: document.querySelector('#server-group-tabs'),
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

const deviceTemplate = document.querySelector('#device-template');

const replicaGrid = document.querySelector('#replica-grid');

/** Panels for the lab's devices, created and removed to match its state. */
const deviceViews = {};

/** Devices showing their "+ New" tab instead of a group. */
const newGroupTabs = {};

// Each device is a different person, so its forms default to its own name.
const defaultNames = ['Santi', 'Robin', 'Taylor', 'Alex', 'Sam', 'Jordan'];

const savedDevices = readPersistedDevices();

const lab = new SyncLab({
  baseUrl: window.location.origin,
  onChange: () => renderAll(),
  onDevicesChanged: (devices) => {
    localStorage.setItem('splitnext.tester.devices.v1', JSON.stringify(devices));
  },
  storageForDevice: (key) => new LocalStorageLabClientStorage(key),
  clearDeviceStorage: (key) => new LocalStorageLabClientStorage(key).clear(),
});

const state = lab.state;

await Promise.all([checkDependencies(), lab.refreshServer()]);

await lab.restoreDevices(savedDevices);

if (Object.keys(state.devices).length === 0) {
  await lab.addDevice().catch(() => undefined);
}

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

function readPersistedDevices() {
  try {
    const parsed = persistedLabDevicesSchema.safeParse(
      JSON.parse(localStorage.getItem('splitnext.tester.devices.v1') ?? '[]'),
    );

    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function bindEvents() {
  elements.addDevice.addEventListener('click', addDevice);
  elements.clearDevices.addEventListener('click', clearDevices);
  elements.serverToggle.addEventListener('click', toggleServer);
  elements.refreshServer.addEventListener('click', refreshServer);
  elements.resetServer.addEventListener('click', resetServer);
  elements.serverGroupTabs.addEventListener('click', inspectServerGroup);
  elements.clearServerTraffic.addEventListener('click', () => {
    lab.clearServerTraffic();
  });
}

/** Builds a device's panel from the template and wires its controls. */
function createDeviceView(key) {
  const root = deviceTemplate.content.firstElementChild.cloneNode(true);
  const query = (selector) => root.querySelector(selector);
  const device = state.devices[key];
  const number = Number(device.label.replace(/\D/g, '')) || 1;
  const defaultName = defaultNames[(number - 1) % defaultNames.length];

  const view = {
    root,
    label: query('[data-role="label"]'),
    toggle: query('[data-action="toggle-device"]'),
    realtimeToggle: query('[data-action="toggle-realtime"]'),
    realtimeEvents: query('[data-role="realtime-events"]'),
    identity: query('[data-role="identity"]'),
    authPanel: query('[data-role="auth-panel"]'),
    mockSignInForm: query('[data-action-form="mock-sign-in"]'),
    mockAccount: query('[data-role="mock-account"]'),
    revision: query('[data-role="revision"]'),
    remove: query('[data-action="remove-device"]'),
    groupList: query('[data-role="group-list"]'),
    newGroupTab: query('[data-action="new-group-tab"]'),
    groupForms: query('[data-role="group-forms"]'),
    groupPane: query('[data-role="group-pane"]'),
    refreshGroups: query('[data-action="refresh-groups"]'),
    createForm: query('[data-action-form="create-group"]'),
    joinForm: query('[data-action-form="join-group"]'),
    joinLink: query('[data-role="join-link"]'),
    joinMember: query('[data-role="join-member"]'),
    joinName: query('[data-role="join-name"]'),
    joinPreview: query('[data-role="join-preview"]'),
    groupEditor: query('[data-role="group-editor"]'),
    memberList: query('[data-role="member-list"]'),
    actions: query('[data-role="actions"]'),
    sync: query('[data-action="sync"]'),
    leave: query('[data-action="leave"]'),
    rejoinForm: query('[data-action-form="rejoin"]'),
    rejoinMember: query('[data-role="rejoin-member"]'),
    rejoinName: query('[data-role="rejoin-name"]'),
    addMemberForm: query('[data-action-form="add-member"]'),
    inviteStatus: query('[data-role="invite-status"]'),
    inviteLink: query('[data-role="invite-link"]'),
    inviteExpiry: query('[data-role="invite-expiry"]'),
    copyInvite: query('[data-action="copy-invite"]'),
    createInvite: query('[data-action="create-invite"]'),
    revokeInvite: query('[data-action="revoke-invite"]'),
    commands: query('[data-role="commands"]'),
    requests: query('[data-role="requests"]'),
    clearTraffic: query('[data-action="clear-traffic"]'),
    rawState: query('[data-role="raw-state"]'),
  };

  root.dataset.device = key;
  view.label.textContent = device.label;
  view.label.id = `${key}-title`;
  root.setAttribute('aria-labelledby', view.label.id);
  view.createForm.elements.creator_member_name.value = defaultName;
  view.joinName.value = defaultName;
  view.rejoinName.value = defaultName;

  view.toggle.addEventListener('click', () => toggleDevice(key));
  view.realtimeToggle.addEventListener('click', () => toggleRealtime(key));
  view.remove.addEventListener('click', () => removeDevice(key));
  view.mockSignInForm.addEventListener('submit', (event) => signInDevice(event, key));
  view.sync.addEventListener('click', () => synchronizeDevice(key));
  view.leave.addEventListener('click', () => leaveGroup(key));
  view.rejoinForm.addEventListener('submit', (event) => rejoinGroup(event, key));
  view.rejoinMember.addEventListener('change', () => renderRejoin(key));
  view.clearTraffic.addEventListener('click', () => clearDeviceTraffic(key));
  view.actions.addEventListener('click', (event) => beginRename(event, key));
  view.groupList.addEventListener('click', (event) => selectGroup(event, key));
  view.newGroupTab.addEventListener('click', () => openNewGroupTab(key));
  view.refreshGroups.addEventListener('click', () => refreshGroups(key));
  view.createForm.addEventListener('submit', (event) => createGroup(event, key));
  view.joinForm.addEventListener('submit', (event) => joinGroup(event, key));
  view.joinLink.addEventListener('input', () => previewJoin(key));
  view.joinMember.addEventListener('change', () => renderJoinChoice(key));
  view.createInvite.addEventListener('click', () => createInvite(key));
  view.revokeInvite.addEventListener('click', () => revokeInvite(key));
  view.copyInvite.addEventListener('click', () => copyInvite(key));
  view.addMemberForm.addEventListener('submit', (event) => addMember(event, key));
  view.memberList.addEventListener('submit', (event) =>
    performMemberAction(event, key),
  );

  replicaGrid.append(root);
  deviceViews[key] = view;
}

/** Adds and removes panels so they match the lab's devices. */
function syncDeviceViews() {
  for (const key of Object.keys(deviceViews)) {
    if (!state.devices[key]) {
      deviceViews[key].root.remove();
      delete deviceViews[key];
      delete newGroupTabs[key];
      delete previewSequences[key];
    }
  }

  for (const key of Object.keys(state.devices)) {
    if (!deviceViews[key]) createDeviceView(key);
  }
}

async function addDevice() {
  setBusy(elements.addDevice, true, 'Adding…');

  try {
    const key = await lab.addDevice();

    showToast(`${state.devices[key].label} is ready with a guest identity`);
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(elements.addDevice, false, 'Add device');
    renderAll();
  }
}

async function signInDevice(event, key) {
  event.preventDefault();

  const view = deviceViews[key];
  const accountName = view.mockAccount.value.trim();
  const button = event.submitter;

  if (!accountName) {
    showToast('Enter a test account name', true);

    return;
  }

  setBusy(button, true, 'Signing in…');

  try {
    const session = await lab.signInWithMockAccount(key, accountName);

    showToast(
      `${state.devices[key].label} signed in as ${accountName} · Identity ${shortId(session.identity.id)}`,
    );
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(button, false, 'Link test account');
    renderAll();
  }
}

function clearDevices() {
  if (!Object.keys(state.devices).length) return;

  const confirmed = window.confirm(
    'Clear all simulated device credentials and local replicas? Server groups and identities will not be deleted.',
  );

  if (!confirmed) return;

  lab.clearDevices();
  showToast('All tester devices and their local data were cleared');
}

function removeDevice(key) {
  const label = state.devices[key]?.label ?? 'This device';

  const confirmed = window.confirm(
    `Remove ${label}? Its local data, including changes not yet synchronized, is discarded. Its identity keeps its group access on the server.`,
  );

  if (!confirmed) return;

  lab.removeDevice(key);
  showToast(`${label} removed`);
}

async function createGroup(event, key) {
  event.preventDefault();

  const button = event.submitter;
  const fields = new FormData(deviceViews[key].createForm);

  setBusy(button, true, 'Creating…');

  try {
    await lab.createGroup(key, {
      name: readText(fields, 'name'),
      currency_code: readText(fields, 'currency_code'),
      creator_member_name: readText(fields, 'creator_member_name'),
    });

    newGroupTabs[key] = false;
    showToast(
      `${state.devices[key].label} created the group. Create an invite link to let others join.`,
    );
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(button, false, 'Create');
    renderAll();
  }
}

async function selectGroup(event, key) {
  const tab =
    event.target instanceof Element ? event.target.closest('[data-group-id]') : null;

  if (!tab) return;

  newGroupTabs[key] = false;

  try {
    await lab.selectGroup(key, tab.dataset.groupId);
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    renderAll();
  }
}

function openNewGroupTab(key) {
  newGroupTabs[key] = true;
  renderAll();
}

async function refreshGroups(key) {
  try {
    await lab.refreshGroupList(key);
    showToast(`${state.devices[key].label} refreshed its group list from the server`);
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    renderAll();
  }
}

// Only each device's latest preview may fill its form, however fast the link changes.
const previewSequences = {};

/** Shows the group behind a pasted link so the device can choose who it is. */
async function previewJoin(key) {
  const view = deviceViews[key];
  const sequence = (previewSequences[key] ?? 0) + 1;

  previewSequences[key] = sequence;


  const link = view.joinLink.value.trim();

  resetJoinChoice(key, link ? 'Checking link…' : 'Who are you?');

  if (!link || !state.devices[key].session) {
    renderJoinChoice(key);

    return;
  }

  try {
    const preview = await lab.previewInvite(key, link);

    if (sequence !== previewSequences[key]) return;

    view.joinMember.replaceChildren(
      new Option('I’m new to this group', 'new'),
      ...preview.members.map((member) => new Option(member.display_name, member.id)),
    );
    view.joinMember.disabled = false;
    view.joinPreview.className = 'join-preview';
    view.joinPreview.textContent =
      `${preview.group.name} · ${preview.group.currency_code} · link ` +
      `${describeExpiry(preview.expires_at)}. Choose who you are, or join as someone new.`;
  } catch (error) {
    if (sequence !== previewSequences[key]) return;

    view.joinPreview.className = 'join-preview error';
    view.joinPreview.textContent = describeError(error);
  } finally {
    if (sequence === previewSequences[key]) renderJoinChoice(key);
  }
}

function resetJoinChoice(key, message) {
  const view = deviceViews[key];

  view.joinMember.replaceChildren(new Option(message, ''));
  view.joinMember.disabled = true;
  view.joinPreview.className = 'join-preview';
  view.joinPreview.textContent = '';
}

function renderJoinChoice(key) {
  const view = deviceViews[key];
  const device = state.devices[key];

  view.joinName.hidden = view.joinMember.value !== 'new';
  view.joinForm.querySelector('button[type="submit"]').disabled =
    !device.session || !device.online || !view.joinMember.value;
}

async function joinGroup(event, key) {
  event.preventDefault();

  const view = deviceViews[key];
  const button = event.submitter;
  const choice = view.joinMember.value;

  const preferredMember =
    choice === 'new'
      ? { kind: 'new', display_name: view.joinName.value.trim() }
      : { kind: 'existing', member_id: choice };

  if (preferredMember.kind === 'new' && !preferredMember.display_name) {
    showToast('Enter a name to join as someone new', true);

    return;
  }

  setBusy(button, true, 'Joining…');

  try {
    await lab.joinWithInvite(
      key,
      view.joinLink.value.trim(),
      preferredMember,
    );

    newGroupTabs[key] = false;
    view.joinLink.value = '';
    resetJoinChoice(key, 'Who are you?');
    showToast(`${state.devices[key].label} joined through the invite link`);
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(button, false, 'Join');
    renderAll();
  }
}

async function createInvite(key) {
  const view = deviceViews[key];
  const replacing = Boolean(currentInvite(key));

  await runMutation(
    key,
    () => lab.createInvite(key, Number(view.inviteExpiry.value)),
    replacing
      ? 'New invite link created; the previous one no longer works'
      : 'Invite link created',
  );
}

async function revokeInvite(key) {
  await runMutation(
    key,
    () => lab.revokeInvite(key),
    'Invite link revoked; people who already joined keep their access',
  );
}

async function copyInvite(key) {
  const link = lab.inviteLink(key);

  if (!link) return;

  try {
    await navigator.clipboard.writeText(link);
    showToast('Invite link copied');
  } catch {
    deviceViews[key].inviteLink.select();
    showToast('Press Ctrl+C to copy the selected link', true);
  }
}

function currentInvite(key) {
  return state.devices[key].replica?.projected_snapshot?.invite ?? null;
}

function describeExpiry(expiresAt) {
  const remaining = Date.parse(expiresAt) - Date.now();

  if (remaining <= 0) return 'expired';

  const hours = remaining / 3_600_000;

  if (hours < 1) return `expires in ${Math.max(1, Math.round(hours * 60))} min`;

  if (hours < 48) return `expires in ${Math.round(hours)} h`;

  return `expires in ${Math.round(hours / 24)} days`;
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

async function rejoinGroup(event, key) {
  event.preventDefault();

  const view = deviceViews[key];
  const choice = view.rejoinMember.value;

  const preferredMember =
    choice === 'new'
      ? { kind: 'new', display_name: view.rejoinName.value.trim() }
      : { kind: 'existing', member_id: choice };

  if (preferredMember.kind === 'new' && !preferredMember.display_name) {
    showToast('Enter a name to rejoin as someone new', true);

    return;
  }

  try {
    const replica = await lab.rejoinGroup(key, preferredMember);

    const member = replica.projected_snapshot.members.find(
      ({ id }) => id === replica.projected_snapshot.access_grants.find(
        ({ identity_id }) => identity_id === replica.session.identity.id,
      )?.preferred_member_id,
    );

    showToast(`${state.devices[key].label} rejoined as ${member?.display_name ?? 'a member'}`);
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    renderAll();
  }
}

async function runMutation(key, operation, successMessage) {
  const device = state.devices[key];

  if (!device.session || !device.selectedGroupId) return;

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
    'Erase every identity and group registered on this local server? Simulated devices and their local data will remain, but their credentials will no longer be valid.',
  );

  if (!confirmed) return;

  setBusy(elements.resetServer, true, 'Resetting…');

  try {
    const cleared = await lab.reset();

    for (const key of Object.keys(deviceViews)) {
      deviceViews[key].joinLink.value = '';
      resetJoinChoice(key, 'Who are you?');
    }

    showToast(
      `Server data erased (${cleared.length} group${cleared.length === 1 ? '' : 's'}). Device panels and local replicas were kept.`,
    );
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(elements.resetServer, false, 'Reset data');
    renderAll();
  }
}

function clearDeviceTraffic(key) {
  lab.clearDeviceTraffic(key);
}

function renderAll() {
  syncDeviceViews();
  renderSetup();

  for (const key of Object.keys(deviceViews)) renderDevice(key);

  renderServer();
}

function renderSetup() {
  const devices = Object.values(state.devices);

  const devicesWithGroups = devices.filter(
    (device) => device.groups.length > 0,
  ).length;

  if (devices.length === 0) {
    elements.setupSummary.textContent =
      'Add a device, then sign in with a test account or create an anonymous identity.';
  } else if (devices.length === 1) {
    elements.setupSummary.textContent =
      'Create a group, then add another device to invite into it.';
  } else if (devicesWithGroups === 0) {
    elements.setupSummary.textContent =
      'Each device can create a group or join one with an invite link. Start by creating one.';
  } else if (devicesWithGroups === 1) {
    elements.setupSummary.textContent =
      'Create an invite link in the group, then join it from the other device.';
  } else {
    elements.setupSummary.textContent =
      'Pick a group in each device’s list. Try taking a device offline, leaving, or rotating a link.';
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
    ? `Identity ${shortId(device.session.identity.id)} · Device ${shortId(device.session.device.id)}${device.mockAccountName ? ` · Test account ${device.mockAccountName}` : ' · Anonymous'}`
    : 'Not signed in';

  view.authPanel.hidden = Boolean(device.mockAccountName);

  for (const control of view.authPanel.querySelectorAll('input, button')) {
    control.disabled = !device.online || !state.server.online;
  }

  view.revision.textContent = replica?.revision ?? '—';

  renderGroupList(key);
  renderJoinChoice(key);
  view.createForm.querySelector('button[type="submit"]').disabled =
    !device.session || !device.online;
  view.refreshGroups.disabled = !device.session || !device.online;
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

  renderInvite(key, hasActiveGroup);
  view.leave.disabled = !hasActiveGroup || !device.online;
  view.sync.disabled = !hasActiveGroup || !device.online;
  renderRejoin(key);
  view.rawState.textContent = JSON.stringify(
    replica ?? {
      online: device.online,
      session: device.session,
      group_id: device.selectedGroupId,
      message: 'No local group data',
    },
    null,
    2,
  );
}

/**
 * Shown for a group the identity left. Choices come from the device's copy,
 * which opening the group refreshes, and keep the current selection when the
 * member list re-renders.
 */
function renderRejoin(key) {
  const device = state.devices[key];
  const view = deviceViews[key];
  const replica = device.replica;
  const left = Boolean(replica?.hidden);

  view.rejoinForm.hidden = !left;

  if (!left) return;

  const members = (replica.projected_snapshot?.members ?? []).filter(
    (member) => member.status === 'active',
  );

  const options = [
    ...members.map((member) => [member.id, member.display_name]),
    ['new', 'I’m new to this group'],
  ];

  const signature = JSON.stringify(options);

  if (view.rejoinMember.dataset.options !== signature) {
    const previous = view.rejoinMember.value;

    view.rejoinMember.replaceChildren(
      ...options.map(([value, label]) => new Option(label, value)),
    );
    view.rejoinMember.dataset.options = signature;

    if (options.some(([value]) => value === previous)) {
      view.rejoinMember.value = previous;
    }
  }

  view.rejoinName.hidden = view.rejoinMember.value !== 'new';
  view.rejoinForm.querySelector('button[type="submit"]').disabled = !device.online;
}

/**
 * One tab per group, active ones first, plus a "+ New" tab for creating or
 * joining. A device with no groups yet shows the new-group forms.
 */
function renderGroupList(key) {
  const device = state.devices[key];
  const view = deviceViews[key];
  const showForms = Boolean(newGroupTabs[key]) || device.groups.length === 0;

  view.groupList.replaceChildren(
    ...device.groups.map((group) => {
      const tab = document.createElement('button');
      const name = document.createElement('span');
      const selected = !showForms && group.group_id === device.selectedGroupId;

      const notes = [
        group.stored_locally ? null : 'not on this device',
        group.pending_commands ? `${group.pending_commands} queued` : null,
      ].filter(Boolean);

      tab.type = 'button';
      tab.role = 'tab';
      tab.className = `group-tab ${group.status}${selected ? ' selected' : ''}`;
      tab.dataset.groupId = group.group_id;
      tab.title = `${group.name} · ${group.currency_code} · ${group.group_id}`;
      tab.setAttribute('aria-selected', String(selected));
      name.textContent = group.name;
      tab.append(name);

      if (group.status === 'left') {
        const status = document.createElement('span');

        status.className = 'group-status';
        status.textContent = 'Left';
        tab.append(status);
      }

      if (notes.length > 0) {
        const note = document.createElement('span');

        note.className = 'tab-note';
        note.textContent = notes.join(' · ');
        tab.append(note);
      }

      return tab;
    }),
  );

  view.newGroupTab.className = `group-tab new-tab${showForms ? ' selected' : ''}`;
  view.newGroupTab.setAttribute('aria-selected', String(showForms));
  view.newGroupTab.disabled = !device.session;
  view.groupForms.hidden = !showForms || !device.session;
  view.groupPane.hidden = showForms;
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
  setIconButton(edit, 'edit', 'Rename');
  line.append(name, edit);
  prefer.type = 'submit';
  prefer.name = 'intent';
  prefer.value = 'prefer';
  remove.type = 'submit';
  remove.name = 'intent';
  remove.value = 'remove';
  remove.className = 'icon-button remove-button';
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
  prefer.className = `icon-button you-button${isYou ? ' selected' : ''}`;
  setIconButton(
    prefer,
    'user',
    isYou ? `${member.display_name} is you` : `Set ${member.display_name} as you`,
  );
  setIconButton(row.querySelector('button[value="remove"]'), 'trash', `Remove ${member.display_name}`);
  users.className = `member-users${preferredBy.length > 1 ? ' shared' : ''}`;
  users.textContent = describeUsers(preferredBy, identityId);
}

/**
 * Every participant sees that a link exists; only the device that created it
 * knows the token and can show or copy the link.
 */
function renderInvite(key, hasActiveGroup) {
  const device = state.devices[key];
  const view = deviceViews[key];
  const snapshot = device.replica?.projected_snapshot;
  const invite = snapshot?.invite ?? null;
  const link = lab.inviteLink(key);
  const canManage = hasActiveGroup && device.online;

  if (!invite) {
    view.inviteStatus.textContent = 'No link';
  } else {
    const creator = snapshot.access_grants.find(
      (grant) => grant.identity_id === invite.created_by_identity_id,
    );

    const byThisDevice = invite.created_by_identity_id === device.session?.identity.id;

    view.inviteStatus.textContent =
      `By ${creator?.actor_handle ?? 'someone'}${byThisDevice ? ' (you)' : ''} · ` +
      describeExpiry(invite.expires_at);
  }

  view.inviteLink.value = link ?? '';
  view.inviteLink.placeholder = invite
    ? 'Created on another device; create a new link to share it from here'
    : 'Create a link to invite someone';
  view.copyInvite.disabled = !link;
  view.createInvite.disabled = !canManage;
  view.createInvite.textContent = invite ? 'New link' : 'Create link';
  view.revokeInvite.disabled = !canManage || !invite;
  view.inviteExpiry.disabled = !canManage;
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
  renderServerGroupTabs();

  if (snapshot) {
    renderGroupSummary(elements.serverGroupSummary, snapshot.group);
    renderMembers(elements.serverMemberList, snapshot, null);
  } else {
    elements.serverGroupSummary.innerHTML =
      '<p class="empty">Select a group tab to inspect its server state.</p>';
    elements.serverMemberList.replaceChildren();
  }

  elements.serverState.textContent = JSON.stringify(
    {
      online: state.server.online,
      identity_directory: state.server.identityDirectory,
      groups: state.server.groups,
      revision: state.server.revision,
      snapshot: state.server.snapshot,
    },
    null,
    2,
  );
  renderServerTraffic();
}

/** One tab per indexed group. Selecting a tab reads its authoritative state. */
function renderServerGroupTabs() {
  const groups = lab.knownGroups();

  if (groups.length === 0) {
    elements.serverGroupTabs.innerHTML = '<span class="empty">No groups yet.</span>';

    return;
  }

  elements.serverGroupTabs.replaceChildren(
    ...groups.map((group) => {
      const tab = document.createElement('button');
      const selected = group.group_id === state.inspectedGroupId;

      tab.type = 'button';
      tab.role = 'tab';
      tab.className = `group-tab${selected ? ' selected' : ''}`;
      tab.dataset.groupId = group.group_id;
      tab.title = group.group_id;
      tab.textContent = `${group.name} · ${group.group_id.slice(0, 6)}`;
      tab.setAttribute('aria-selected', String(selected));

      return tab;
    }),
  );
}

async function inspectServerGroup(event) {
  const tab =
    event.target instanceof Element ? event.target.closest('[data-group-id]') : null;

  if (!tab) return;

  try {
    await lab.inspectGroup(tab.dataset.groupId);
  } catch (error) {
    showToast(describeError(error), true);
  }
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
      heading.textContent = identity.mock_account
        ? `Identity ${identity.id} · Test account ${identity.mock_account}`
        : `Identity ${identity.id}`;

      if (identity.merged_into) heading.textContent += ` · merged into ${identity.merged_into}`;

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
    off: device.realtime
      ? 'Live updates on, no joined groups to watch'
      : 'Live updates off. Click to turn on',
    connecting: 'Live updates connecting…',
    open: 'Live updates on. Click to turn off',
    disconnected: 'Live updates disconnected, retrying',
  };

  button.className = `icon-button realtime-toggle ${status}`;
  setIconButton(button, 'live', labels[status]);
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
  button.className = `icon-button connection-toggle ${online ? 'online' : 'offline'}`;
  setIconButton(
    button,
    online ? 'online' : 'offline',
    online ? 'Online. Click to go offline' : 'Offline. Click to go online',
  );
}

/** Icon-only buttons keep their text as a tooltip and an accessible name. */
function setIconButton(button, iconName, label) {
  const current = button.querySelector('use')?.getAttribute('href');

  if (current !== `#icon-${iconName}`) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');

    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    use.setAttribute('href', `#icon-${iconName}`);
    svg.append(use);
    button.replaceChildren(svg);
  }

  button.title = label;
  button.setAttribute('aria-label', label);
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

const inviteErrors = {
  invite_required: 'Joining for the first time needs an invite link.',
  invite_invalid: 'This invite link is not valid for the group.',
  invite_expired: 'This invite link has expired. Ask for a new one.',
  invite_revoked: 'This invite link was revoked or replaced. Ask for a new one.',
};

function describeError(error) {
  if (error instanceof ClientOfflineError) {
    return 'This action requires the device to be online.';
  }

  if (error instanceof SplitnextRequestError) {
    return inviteErrors[error.code] ?? `Server rejected the request: ${error.code}`;
  }

  if (error instanceof Error) {
    if (error.message === 'server_offline') return 'The simulated server is offline.';

    if (error.message === 'device_offline') return 'This device is offline.';

    if (error.message === 'invalid_invite_link') {
      return 'That is not an invite link. It should look like …/join/{group}#{token}.';
    }

    return error.message;
  }

  return 'Unexpected error';
}
