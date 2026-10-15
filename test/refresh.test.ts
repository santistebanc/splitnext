import { afterEach, describe, expect, it, vi } from 'vitest';
import { RefreshCoordinator } from '../apps/client/src/model/refresh';
import { createWorkbenchApp, type FakeAppOptions } from '../apps/client/src/workbench/app';

const options: FakeAppOptions = {
  scenario: { members: ['Ana'], you: 'Ana', others: [], presence: 'realtime', othersOnline: true, connection: 'online' },
  connection: 'online', latency: 0, failure: 'none', log: () => undefined,
};

afterEach(() => vi.useRealTimers());

describe('refresh coordination', () => {
  it('coalesces refreshes and applies an offline event immediately during a stalled request', async () => {
    const app = await createWorkbenchApp(options);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const listGroups = app.client.listGroups.bind(app.client);
    let calls = 0;

    app.client.listGroups = async () => { calls++; await gate;

 return listGroups(); };

    const first = app.refresh();
    const second = app.refresh();

    expect(first).toBe(second);
    await app.setOnline(false);
    expect(app.snapshot().online).toBe(false);
    expect(app.client.isOnline()).toBe(false);
    const reconnect = app.setOnline(true);

    expect(app.snapshot().online).toBe(true);
    release();
    await Promise.all([first, second, reconnect]);
    expect(calls).toBe(2);
    app.dispose();
  });

  it('backs off retries, surfaces background errors and cancels retry work on disposal', async () => {
    vi.useFakeTimers();
    let calls = 0;
    let retry = true;
    const errors: Error[] = [];
    const failure = new Error('storage_unavailable');

    const scheduler = new RefreshCoordinator({
      run: async () => { calls++;

 if (calls === 2) throw failure; },
      needsRetry: () => retry,
      failed: (error) => errors.push(error),
    });

    await scheduler.request();
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).toBe(2);
    expect(errors).toEqual([failure]);
    await vi.advanceTimersByTimeAsync(19999);
    expect(calls).toBe(2);
    retry = false;
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(3);
    retry = true;
    scheduler.schedule();
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(60000);
    expect(calls).toBe(3);
  });
});
