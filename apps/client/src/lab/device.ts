import { createDeviceSecret, deviceSecretSchema, IndexedDbClientStorage } from '@splitnext/client';
import { z } from 'zod';
import { createAppRuntime } from '../model/runtime';
import type { AppController } from '../model/controller';
import type { ActionPlatform, Dispatcher } from '../model/actions';
import { navigationSchema, type AppNavigation, type NavigationEntry } from '../ui/navigation';
import type { AppSubstrate } from '../ui/substrate';
import { labBridge, observeLabEvents, type LabBridge } from './bridge';
import type { LabReport } from './events';
import { VirtualNetwork, type ServerGate } from './virtualNetwork';

export type DeviceConfig = {
  id: string;
  /** Names this device's persisted data: environment, device and generation. */
  namespace: string;
  online: boolean;
  latencyMs: number;
  /** Whether the device offers copying and sharing, as some real devices lack them. */
  clipboard: boolean;
  share: boolean;
};

export type HostEnvironment = {
  /** The local Worker the app talks to; it allows other origins, as the lab page is one. */
  workerOrigin: string;
  server: ServerGate;
  report: LabReport;
};

/** What the device's fake platform was asked to do, and its fake clipboard. */
export type FakeCapabilities = {
  clipboardText: string;
  copied: string[];
  shared: { url: string; title: string }[];
  notifications: string[];
  homepageOpens: number;
};

/** Navigation kept in memory: history entries the screen writes, read back by Back. */
export class MemoryNavigation implements AppNavigation {
  entries: (NavigationEntry | null)[] = [null];
  index = 0;
  private readonly listeners = new Set<(entry: NavigationEntry) => void>();

  constructor(private readonly address: string) {}

  url = () => this.address;
  enterApp = () => undefined;

  write = (entry: NavigationEntry, mode: 'push' | 'replace') => {
    if (mode === 'push') {
      this.entries.splice(this.index + 1, this.entries.length, entry);
      this.index = this.entries.length - 1;
    } else this.entries[this.index] = entry;
  };

  subscribe = (listener: (entry: NavigationEntry) => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  go(step: -1 | 1): boolean {
    const next = this.index + step;
    const parsed = navigationSchema.safeParse(this.entries[next]);

    if (!parsed.success) return false;
    this.index = next;
    this.listeners.forEach((listener) => listener(parsed.data));

    return true;
  }
}

const seenSchema = z.record(z.string(), z.number().int());

/**
 * One device among others: its own storage namespace, network, lifecycle,
 * navigation and fake platform around the ordinary controller and screen.
 */
export class LabDevice {
  readonly network: VirtualNetwork;
  readonly navigation: MemoryNavigation;
  readonly capabilities: FakeCapabilities = { clipboardText: '', copied: [], shared: [], notifications: [], homepageOpens: 0 };
  /** Changes whenever the screen must start again, as a page reload does. */
  generation = 0;
  bridge: LabBridge | null = null;
  readonly substrate: AppSubstrate;
  private readonly listeners = { online: new Set<() => void>(), foreground: new Set<() => void>() };
  private readonly changed = new Set<() => void>();

  constructor(
    public config: DeviceConfig,
    private readonly environment: HostEnvironment,
  ) {
    this.network = new VirtualNetwork(config.id, environment.server, environment.report);
    this.network.online = config.online;
    this.network.latencyMs = config.latencyMs;
    this.navigation = new MemoryNavigation(`${environment.workerOrigin}/app`);
    this.substrate = this.createSubstrate();
  }

  private key = (name: string) => `splitnext-lab:${this.config.namespace}:${name}`;

  private get databaseName(): string {
    return `splitnext-lab:${this.config.namespace}`;
  }

  private createSubstrate(): AppSubstrate {
    return {
      createApp: () => this.createApp(),
      actions: () => this.platform(),
      navigation: this.navigation,
      seenStorage: {
        read: () => {
          try {
            const parsed = seenSchema.safeParse(JSON.parse(localStorage.getItem(this.key('activity-seen')) ?? '{}'));

            return parsed.success ? parsed.data : {};
          } catch {
            return {};
          }
        },
        write: (seen) => localStorage.setItem(this.key('activity-seen'), JSON.stringify(seen)),
      },
      lifecycle: {
        online: () => this.network.online,
        subscribe: (online, foreground) => {
          this.listeners.online.add(online);
          this.listeners.foreground.add(foreground);

          return () => {
            this.listeners.online.delete(online);
            this.listeners.foreground.delete(foreground);
          };
        },
      },
      observe: (app, actions) => this.attach(app, actions),
    };
  }

  private platform(): ActionPlatform {
    const platform: ActionPlatform = {
      appUrl: this.environment.workerOrigin,
      openHomepage: () => {
        this.capabilities.homepageOpens++;
      },
    };

    if (this.config.clipboard)
      platform.copyText = async (text) => {
        this.capabilities.clipboardText = text;
        this.capabilities.copied.push(text);
      };

    if (this.config.share)
      platform.shareLink = async (url, title) => {
        this.capabilities.shared.push({ url, title });
      };

    return platform;
  }

  private installationSecret(): string {
    let secret = localStorage.getItem(this.key('installation'));

    if (!secret) {
      secret = createDeviceSecret();
      localStorage.setItem(this.key('installation'), secret);
    }

    if (!deviceSecretSchema.safeParse(secret).success) throw new Error('corrupt_document');

    return secret;
  }

  private async createApp(): Promise<AppController> {
    const secret = this.installationSecret();

    return createAppRuntime({
      secret,
      storage: new IndexedDbClientStorage({ database_name: this.databaseName, document_key: secret }),
      transport: {
        baseUrl: this.environment.workerOrigin,
        fetch: (input, init) => this.network.fetch(String(input), { ...init, signal: AbortSignal.timeout(5000) }),
        webSocket: this.network.webSocket,
      },
      preferences: {
        lastGroup: () => localStorage.getItem(this.key('last-group')),
        rememberGroup: (groupId) => {
          if (groupId) localStorage.setItem(this.key('last-group'), groupId);
          else localStorage.removeItem(this.key('last-group'));
        },
        lastYouName: () => localStorage.getItem(this.key('last-you-name')),
        rememberYouName: (name) => localStorage.setItem(this.key('last-you-name'), name),
      },
      notifications: {
        changed: (groupId) => {
          this.capabilities.notifications.push(groupId);
        },
        dispose: () => undefined,
      },
    });
  }

  private attach(app: AppController, actions: Dispatcher): () => void {
    this.bridge = labBridge(app, actions);
    const bridge = this.bridge;
    const stop = observeLabEvents(app, actions, (kind, detail) => this.environment.report({ name: 'app', detail: { device: this.config.id, kind, detail } }));

    return () => {
      stop();

      if (this.bridge === bridge) this.bridge = null;
    };
  }

  /** Re-renders what shows this device. */
  subscribe(listener: () => void): () => void {
    this.changed.add(listener);

    return () => {
      this.changed.delete(listener);
    };
  }

  private touch(): void {
    this.changed.forEach((listener) => listener());
  }

  /** Starts the screen again with the same persisted data, as a page reload does. */
  reload(): void {
    this.bridge = null;
    this.generation++;
    this.touch();
  }

  setNetwork(online: boolean, latencyMs?: number): void {
    this.network.online = online;
    this.network.latencyMs = latencyMs ?? this.network.latencyMs;
    this.config = { ...this.config, online, latencyMs: this.network.latencyMs };
    this.network.reset();
    this.listeners.online.forEach((listener) => listener());
  }

  foreground(): void {
    this.listeners.foreground.forEach((listener) => listener());
  }

  setCapabilities(change: { clipboard?: boolean | undefined; share?: boolean | undefined; clipboardText?: string | undefined }): void {
    if (change.clipboardText !== undefined) this.capabilities.clipboardText = change.clipboardText;

    if (change.clipboard === undefined && change.share === undefined) return;
    this.config = { ...this.config, clipboard: change.clipboard ?? this.config.clipboard, share: change.share ?? this.config.share };
    // Platform services are read when the screen starts.
    this.reload();
  }

  /** What this device keeps, in the shape a person could look it up in the browser. */
  async storage() {
    const secret = localStorage.getItem(this.key('installation'));
    const prefix = this.key('');

    const keys = Object.keys(localStorage).filter((name) => name.startsWith(prefix));

    return {
      namespace: this.config.namespace,
      localStorage: keys.map((name) => ({ name: name.slice(prefix.length), value: localStorage.getItem(name) ?? '' })),
      indexedDB: {
        database: this.databaseName,
        document: secret ? await new IndexedDbClientStorage({ database_name: this.databaseName, document_key: secret }).read() : null,
      },
    };
  }

  /** Stops traffic when the device is removed from its host. */
  dispose(): void {
    this.network.online = false;
    this.network.reset();
  }
}
