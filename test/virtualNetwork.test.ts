import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryNavigation } from '../apps/client/src/lab/memoryNavigation';
import type { LabEvent } from '../apps/client/src/lab/events';
import { VirtualNetwork, type ServerGate } from '../apps/client/src/lab/virtualNetwork';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function network(gate: ServerGate = { open: true, epoch: 0 }) {
  const events: LabEvent[] = [];
  const virtual = new VirtualNetwork('a', gate, (event) => events.push(event));

  return { gate, events, virtual };
}

const names = (events: LabEvent[]) => events.map((event) => event.name);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a virtual device network', () => {
  it('reaches the server and records the exchange', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })));
    const { events, virtual } = network();

    expect((await virtual.fetch('http://worker.test/groups', { method: 'POST' })).status).toBe(201);
    expect(names(events)).toEqual(['request', 'response.received', 'response']);
  });

  it('fails requests while the device is offline or the server is unavailable', async () => {
    const reach = vi.fn(async () => new Response('{}'));

    vi.stubGlobal('fetch', reach);
    const { gate, virtual } = network();

    virtual.online = false;
    await expect(virtual.fetch('http://worker.test/groups', {})).rejects.toThrow('lab_unreachable');
    virtual.online = true;
    gate.open = false;
    await expect(virtual.fetch('http://worker.test/groups', {})).rejects.toThrow('lab_unreachable');
    expect(reach).not.toHaveBeenCalled();
  });

  it('drops a response that arrives after the connection changed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const { events, virtual } = network();

    virtual.latencyMs = 20;
    const inflight = virtual.fetch('http://worker.test/groups', {});

    await wait(30);
    virtual.reset();
    await expect(inflight).rejects.toThrow('lab_response_lost');
    expect(names(events)).toContain('response.lost');
  });

  it('drops a response when the server gate changes in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const { gate, virtual } = network();

    virtual.latencyMs = 20;
    const inflight = virtual.fetch('http://worker.test/groups', {});

    await wait(30);
    gate.epoch++;
    await expect(inflight).rejects.toThrow('lab_response_lost');
  });

  it('closes realtime connections once when blocked and when the network changes', async () => {
    class FakeSocket {
      static last: FakeSocket;
      listeners = new Map<string, (event: unknown) => void>();
      constructor() {
        FakeSocket.last = this;
      }
      addEventListener(name: string, listener: (event: unknown) => void) {
        this.listeners.set(name, listener);
      }
      close() {
        this.listeners.get('close')?.({ code: 1000, reason: '' });
      }
    }

    vi.stubGlobal('WebSocket', FakeSocket);
    const { gate, virtual } = network();
    const closed: number[] = [];
    const handlers = { open: () => undefined, message: () => undefined, close: (code: number) => closed.push(code) };

    virtual.webSocket('ws://worker.test/groups/1/realtime', [], handlers);
    virtual.reset();
    expect(closed).toEqual([1011]);
    FakeSocket.last.close();
    expect(closed).toEqual([1011]);

    gate.open = false;
    virtual.webSocket('ws://worker.test/groups/1/realtime', [], handlers);
    await wait(5);
    expect(closed).toEqual([1011, 1011]);
  });
});

describe('a device navigation kept in memory', () => {
  const entry = (view: 'home' | 'settings') => ({ splitnext: true as const, view, groupId: null });

  it('pushes, replaces and goes back to earlier entries', () => {
    const navigation = new MemoryNavigation('http://worker.test/app');
    const seen: string[] = [];

    navigation.subscribe((next) => seen.push(next.view));
    navigation.write(entry('home'), 'replace');
    navigation.write(entry('settings'), 'push');
    expect(navigation.go(-1)).toBe(true);
    expect(seen).toEqual(['home']);
    expect(navigation.go(-1)).toBe(false);
    expect(navigation.go(1)).toBe(true);
    expect(seen).toEqual(['home', 'settings']);
  });
});
