const elements = {
  healthStatus: document.querySelector('#health-status'),
  readyStatus: document.querySelector('#ready-status'),
  identityStatus: document.querySelector('#identity-status'),
  createIdentity: document.querySelector('#create-identity'),
  verifyIdentity: document.querySelector('#verify-identity'),
  activityList: document.querySelector('#activity-list'),
  clearActivity: document.querySelector('#clear-activity'),
  toast: document.querySelector('#toast'),
};

/** @type {string | null} */
let deviceSecret = null;

const state = {
  identitySession: null,
  activity: [],
};

class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error ?? `http_${status}`);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, authenticated = false, quiet = false } = {}) {
  const startedAt = performance.now();
  const headers = { accept: 'application/json' };

  if (body !== undefined) headers['content-type'] = 'application/json';

  if (authenticated && deviceSecret) {
    headers.authorization = `Bearer v1.${deviceSecret}`;
  }

  try {
    const init = { method, headers };

    if (body !== undefined) init.body = JSON.stringify(body);

    const response = await fetch(path, init);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!quiet) recordActivity(method, path, response.status, performance.now() - startedAt);

    if (!response.ok) throw new ApiError(response.status, payload);

    return payload;
  } catch (error) {
    if (!quiet && !(error instanceof ApiError)) {
      recordActivity(method, path, 0, performance.now() - startedAt, 'network_error');
    }

    throw error;
  }
}

async function refreshDependencies() {
  const [health, ready] = await Promise.allSettled([
    request('/health', { quiet: true }),
    request('/ready', { quiet: true }),
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

async function createIdentity() {
  setBusy(elements.createIdentity, true);
  deviceSecret ??= generateDeviceSecret();

  try {
    state.identitySession = await request('/identities/anonymous', {
      method: 'POST',
      body: { device_secret: deviceSecret },
    });
    showToast('Anonymous identity ready');
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(elements.createIdentity, false);
    renderIdentity();
  }
}

async function verifyIdentity() {
  if (!deviceSecret) return;

  setBusy(elements.verifyIdentity, true);

  try {
    state.identitySession = await request('/identity', { authenticated: true });
    showToast('Device credential verified');
  } catch (error) {
    showToast(describeError(error), true);
  } finally {
    setBusy(elements.verifyIdentity, false);
    renderIdentity();
  }
}

function renderIdentity() {
  if (state.identitySession) {
    const { identity, device } = state.identitySession;

    elements.identityStatus.innerHTML = `<dl><div><dt>Identity</dt><dd>${escapeHtml(identity.id)}</dd></div><div><dt>Device</dt><dd>${escapeHtml(device.id)}</dd></div></dl>`;
    elements.createIdentity.hidden = true;
    elements.verifyIdentity.disabled = false;

    return;
  }

  elements.identityStatus.textContent = deviceSecret
    ? 'Setup did not finish. Retry with the same in-memory credential.'
    : 'No identity created for this page.';
  elements.createIdentity.hidden = false;
  elements.createIdentity.textContent = deviceSecret ? 'Retry setup' : 'Create identity';
  elements.verifyIdentity.disabled = true;
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

function setBusy(button, busy) {
  button.disabled = busy;
  button.dataset.label ??= button.textContent;
  button.textContent = busy ? 'Working…' : button.dataset.label;
}

function describeError(error) {
  if (error instanceof ApiError) return `${error.status} · ${error.message}`;

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

elements.createIdentity.addEventListener('click', createIdentity);

elements.verifyIdentity.addEventListener('click', verifyIdentity);

elements.clearActivity.addEventListener('click', () => {
  state.activity = [];
  renderActivity();
});

renderIdentity();

void refreshDependencies();
