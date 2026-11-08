/** Bound a harness phase without changing any product latency assertion. */
async function bounded(promise, milliseconds, message) {
  let timer;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Cut the server gate on the committed mutation's response, not on an
 * unrelated background read. Observe action rejection immediately so cleanup
 * cannot replace a useful timeout with host_disconnected/context-destroyed. */
export async function loseCommittedResponse(lab, { device, groupId, name, action, timeoutMs = 10000, lossTimeoutMs = 15000 }) {
  const received = Promise.withResolvers();
  const lost = Promise.withResolvers();
  const original = lab.event;
  let active = true;
  let observing = false;
  let cutting = false;
  const matches = (detail) => detail.device === device && detail.method === 'POST' && detail.path === `/groups/${groupId}/sync`;

  const observe = async (kind, detail) => {
    const record = await original.call(lab, kind, detail);

    if (!active) return record;
    if (cutting && kind === 'response.lost' && matches(detail)) lost.resolve(record);
    if (observing || cutting || kind !== 'response.received' || !matches(detail)) return record;
    observing = true;

    // Host reports and command results share an ordered HTTP queue. Release
    // this report before awaiting the gate's result on that same queue.
    void (async () => {
      try {
        const server = await lab.execute('inspectServer');
        const group = server.groups.find((entry) => entry.snapshot.group.id === groupId);

        if (active && group?.snapshot.group.name === name) {
          cutting = true;
          await lab.execute('serverNetwork', { available: false });
          received.resolve(record);
        }
      } catch (error) { received.reject(error); }
      finally { observing = false; }
    })();

    return record;
  };

  lab.event = observe;
  // Carry the action's outcome without leaving a rejection unobserved when
  // an observation timeout is followed by page closure during cleanup.
  const outcome = Promise.resolve().then(action).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
  const failure = outcome.then((result) => {
    if (!result.ok) throw result.error;

    return new Promise(() => {});
  });

  try {
    await bounded(Promise.race([received.promise, failure]), timeoutMs, 'inflight_request_timeout');
    const result = await bounded(outcome, timeoutMs, 'inflight_action_timeout');

    if (!result.ok) throw result.error;
    await bounded(lost.promise, lossTimeoutMs, 'response_not_lost');
  } finally {
    active = false;
    if (lab.event === observe) lab.event = original;
  }
}
