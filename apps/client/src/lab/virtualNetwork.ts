import { z } from 'zod';
import type { RealtimeSocket, RealtimeSocketFactory, RealtimeSocketHandlers } from '@splitnext/client';
import type { LabReport, NetworkRecord } from './events';

/** Whether the server can be reached at all; shared by every device of a host. */
export type ServerGate = { open: boolean; epoch: number };

const textSchema = z.string();

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One device's connection to the real local Worker. The device being online,
 * the server gate and a changed epoch decide what is delivered: requests
 * fail while blocked, and a response that arrives after the connection
 * changed is dropped, as when a real connection is lost after the server
 * committed.
 */
export class VirtualNetwork {
  online = true;
  latencyMs = 0;
  private epoch = 0;
  private readonly sockets = new Set<(code: number, reason: string) => void>();

  constructor(
    private readonly device: string,
    private readonly server: ServerGate,
    private readonly report: LabReport,
  ) {}

  private record(name: string, detail: NetworkRecord): void {
    this.report({ name, detail });
  }

  private blocked(): boolean {
    return !this.online || !this.server.open;
  }

  /** Closes live connections and discards responses still in flight. */
  reset(): void {
    this.epoch++;

    for (const close of Array.from(this.sockets)) close(1011, 'lab_network_changed');
  }

  fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const epoch = this.epoch;
    const serverEpoch = this.server.epoch;
    const request: NetworkRecord = { device: this.device, method: init.method ?? 'GET', path: new URL(input).pathname };
    const lost = () => this.blocked() || epoch !== this.epoch || serverEpoch !== this.server.epoch;

    this.record('request', request);

    try {
      if (this.latencyMs) await wait(this.latencyMs);

      if (lost()) throw new TypeError('lab_unreachable');
      const response = await fetch(input, init);

      this.record('response.received', request);

      if (this.latencyMs) await wait(this.latencyMs);

      if (lost()) {
        this.record('response.lost', request);
        void response.body?.cancel().catch(() => undefined);

        throw new TypeError('lab_response_lost');
      }

      this.record('response', { ...request, status: response.status });

      return response;
    } catch (error) {
      this.record('request.failed', { ...request, error: String(error) });

      throw error;
    }
  };

  webSocket: RealtimeSocketFactory = (url, protocols, handlers) => {
    if (this.blocked()) {
      const closed = setTimeout(() => handlers.close(1011, 'lab_unavailable'), 0);

      return { close: () => clearTimeout(closed) };
    }

    return this.connect(url, protocols, handlers);
  };

  private connect(url: string, protocols: string[], handlers: RealtimeSocketHandlers): RealtimeSocket {
    const epoch = this.epoch;
    const socket = new WebSocket(url, protocols);
    let finished = false;

    const finish = (code: number, reason: string) => {
      if (finished) return;
      finished = true;
      this.sockets.delete(finish);
      handlers.close(code, reason);
    };

    this.sockets.add(finish);
    socket.addEventListener('open', () => {
      if (!finished) handlers.open();
    });
    socket.addEventListener('message', (event) => {
      const text = textSchema.safeParse(event.data);

      if (!text.success) return;
      void wait(this.latencyMs).then(() => {
        if (finished || this.blocked() || epoch !== this.epoch) return;
        this.record('realtime.message', { device: this.device, data: text.data });
        handlers.message(text.data);
      });
    });
    socket.addEventListener('close', (event) => finish(event.code, event.reason));

    return {
      close: (code, reason) => {
        socket.close(code, reason);
        finish(code ?? 1000, reason ?? '');
      },
    };
  }
}
