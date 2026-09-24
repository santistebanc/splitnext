import { z } from 'zod';
import {
  realtimeGroupHiddenCode,
  revisionAnnouncementSchema,
} from '../domain/realtime';

export type RealtimeSocketHandlers = {
  open(): void;
  message(data: string): void;
  /** Called exactly once, including when the connection never opened. */
  close(code: number, reason: string): void;
};

export type RealtimeSocket = {
  close(code?: number, reason?: string): void;
};

/**
 * The platform seam for realtime connections. Browsers and React Native use
 * `browserWebSocket`; tests and the lab supply their own.
 */
export type RealtimeSocketFactory = (
  url: string,
  protocols: string[],
  handlers: RealtimeSocketHandlers,
) => RealtimeSocket;

const textMessageSchema = z.string();

export const browserWebSocket: RealtimeSocketFactory = (
  url,
  protocols,
  handlers,
) => {
  const socket = new WebSocket(url, protocols);

  socket.addEventListener('open', () => handlers.open());
  socket.addEventListener('message', (event) => {
    const text = textMessageSchema.safeParse(event.data);

    if (text.success) handlers.message(text.data);
  });
  socket.addEventListener('close', (event) =>
    handlers.close(event.code, event.reason),
  );

  return { close: (code, reason) => socket.close(code, reason) };
};

type Subscription = {
  connection: object | null;
  socket: RealtimeSocket | null;
  retry: ReturnType<typeof setTimeout> | null;
  attempt: number;
};

export type RealtimeSubscriptionsOptions = {
  connect: (groupId: string, handlers: RealtimeSocketHandlers) => RealtimeSocket;
  onAnnouncement: (groupId: string, revision: number) => void;
  reconnectDelayMs: (attempt: number) => number;
};

/**
 * Keeps one connection per watched group while online. Announcements are
 * hints only: missed, duplicate, or reordered messages are harmless because
 * every connection starts with the current revision and the owner
 * synchronizes through the ordinary snapshot path.
 */
export class RealtimeSubscriptions {
  private readonly subscriptions = new Map<string, Subscription>();
  private online = true;

  constructor(private readonly options: RealtimeSubscriptionsOptions) {}

  watch(groupId: string): void {
    if (this.subscriptions.has(groupId)) return;

    const subscription: Subscription = {
      connection: null,
      socket: null,
      retry: null,
      attempt: 0,
    };

    this.subscriptions.set(groupId, subscription);

    if (this.online) this.connect(groupId, subscription);
  }

  unwatch(groupId: string): void {
    const subscription = this.subscriptions.get(groupId);

    if (!subscription) return;

    this.subscriptions.delete(groupId);
    this.disconnect(subscription);
  }

  isWatching(groupId: string): boolean {
    return this.subscriptions.has(groupId);
  }

  /** Going online reconnects immediately rather than waiting out a backoff. */
  setOnline(online: boolean): void {
    this.online = online;

    for (const [groupId, subscription] of this.subscriptions) {
      if (!online) {
        this.disconnect(subscription);
      } else if (!subscription.connection) {
        subscription.attempt = 0;
        this.clearRetry(subscription);
        this.connect(groupId, subscription);
      }
    }
  }

  private connect(groupId: string, subscription: Subscription): void {
    const connection = {};
    const current = () => subscription.connection === connection;

    subscription.connection = connection;

    const socket = this.options.connect(groupId, {
      open: () => {
        if (current()) subscription.attempt = 0;
      },
      message: (data) => {
        if (!current()) return;

        const announcement = parseAnnouncement(data);

        if (announcement) {
          this.options.onAnnouncement(groupId, announcement.revision);
        }
      },
      close: (code) => {
        if (!current()) return;

        subscription.connection = null;
        subscription.socket = null;

        if (code === realtimeGroupHiddenCode) {
          this.unwatch(groupId);
        } else {
          this.scheduleReconnect(groupId, subscription);
        }
      },
    });

    // A factory may report an immediate failure before it returns.
    if (current()) subscription.socket = socket;
  }

  private scheduleReconnect(groupId: string, subscription: Subscription): void {
    if (!this.online || this.subscriptions.get(groupId) !== subscription) return;

    const delay = this.options.reconnectDelayMs(subscription.attempt);

    subscription.attempt += 1;
    subscription.retry = setTimeout(() => {
      subscription.retry = null;

      if (this.online && this.subscriptions.get(groupId) === subscription) {
        this.connect(groupId, subscription);
      }
    }, delay);
  }

  private disconnect(subscription: Subscription): void {
    const socket = subscription.socket;

    subscription.connection = null;
    subscription.socket = null;
    this.clearRetry(subscription);
    socket?.close(1000, 'unsubscribed');
  }

  private clearRetry(subscription: Subscription): void {
    if (subscription.retry !== null) clearTimeout(subscription.retry);

    subscription.retry = null;
  }
}

export function defaultReconnectDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

function parseAnnouncement(data: string) {
  try {
    const parsed = revisionAnnouncementSchema.safeParse(JSON.parse(data));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
