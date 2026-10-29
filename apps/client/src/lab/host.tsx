import { z } from 'zod';
import type { JsonValue } from '@splitnext/client';
import { emptyCapabilities, type DeviceConfig, type FakeCapabilities, type HostEnvironment, type LabDevice } from './device';
import type { LabReport } from './events';
import type { FrameLink } from './frame';
import type { ServerGate } from './virtualNetwork';

type Size = { width: number; height: number };

/** The size of a phone screen, as the browser devices' viewport, until the supervisor sets another. */
const screenSize: Size = { width: 390, height: 780 };

/** How long a call waits for a device's frame to start, as after it reloaded. */
const connectTimeoutMs = 15_000;

/** What the lab page gives its host: where the Worker is and where reports go. */
export type HostOptions = {
  workerOrigin: string;
  gate: ServerGate;
  report: LabReport;
};

const commandSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('inspect') }),
  z.object({ method: z.literal('ready') }),
  z.object({ method: z.literal('action'), name: z.string(), input: z.json().default({}), confirmed: z.boolean().default(false) }),
  z.object({ method: z.literal('network'), online: z.boolean(), latencyMs: z.number().int().min(0).optional() }),
  z.object({ method: z.literal('reload') }),
  z.object({ method: z.literal('foreground') }),
  z.object({ method: z.literal('navigate'), direction: z.enum(['back', 'forward']) }),
  z.object({ method: z.literal('capabilities'), clipboard: z.boolean().optional(), share: z.boolean().optional(), clipboardText: z.string().optional() }),
  z.object({ method: z.literal('remove') }),
  z.object({ method: z.literal('resize'), width: z.number().int().min(240).max(1600), height: z.number().int().min(320).max(1600) }),
]);

const notReady = { status: 'failed', error: 'app_not_ready', issues: ['This installation needs to finish startup before app actions are available.'] };

/** One device: its frame, and the device running in it once the frame has started. */
type Entry = {
  config: DeviceConfig;
  capabilities: FakeCapabilities;
  screen: Size;
  frame: HTMLIFrameElement;
  device: LabDevice | null;
  unmount: (() => void) | null;
  connected: Set<() => void>;
};

/** Moves a frame without reloading it where the browser can. */
function place(frame: HTMLIFrameElement, parent: HTMLElement): void {
  if (frame.parentElement === parent) return;

  if ('moveBefore' in parent && frame.isConnected && parent.isConnected) parent.moveBefore(frame, null);
  else parent.appendChild(frame);
}

/**
 * Many devices in one lab page, each in its own frame: its own document and
 * window, running the ordinary app. The lab page gives each device a slot to
 * show it in; the supervisor drives them through `call`.
 */
export class LabHost {
  private readonly entries = new Map<string, Entry>();
  private readonly slots = new Map<string, HTMLElement>();
  /** Frames without a slot keep running here, at their size but out of sight. */
  private readonly holder: HTMLElement;
  private readonly environment: HostEnvironment;

  constructor(private readonly options: HostOptions) {
    this.environment = {
      workerOrigin: options.workerOrigin,
      server: options.gate,
      report: options.report,
    };
    this.holder = document.createElement('div');
    this.holder.setAttribute('aria-hidden', 'true');
    Object.assign(this.holder.style, { position: 'fixed', top: '0', left: '-20000px', pointerEvents: 'none' });
    document.body.appendChild(this.holder);
    window.splitnextLabFrameLink = (id) => this.link(id);
  }

  private link(id: string): FrameLink | undefined {
    const entry = this.entries.get(id);

    if (!entry) return undefined;

    return {
      config: entry.config,
      capabilities: entry.capabilities,
      environment: this.environment,
      connect: (device, unmount) => {
        entry.device = device;
        entry.unmount = unmount;
        entry.connected.forEach((resolve) => resolve());
        entry.connected.clear();
      },
      disconnect: (device) => {
        if (entry.device !== device) return;
        // The next frame starts where this one left its network and capabilities.
        entry.config = { ...device.config, screen: entry.screen };
        entry.device = null;
        entry.unmount = null;
      },
    };
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /** Where a device shows; the lab page owns the element. */
  attach(id: string, slot: HTMLElement): void {
    this.slots.set(id, slot);
    const entry = this.entries.get(id);

    if (entry) place(entry.frame, slot);
  }

  detach(id: string): void {
    this.slots.delete(id);
    const entry = this.entries.get(id);

    if (entry) place(entry.frame, this.holder);
  }

  private size(entry: Entry): void {
    entry.frame.style.width = `${entry.screen.width}px`;
    entry.frame.style.height = `${entry.screen.height}px`;
  }

  private open(config: DeviceConfig): Entry {
    const frame = document.createElement('iframe');

    frame.dataset.labDevice = config.id;
    frame.title = config.id;
    Object.assign(frame.style, { display: 'block', border: '0', background: 'transparent' });
    frame.src = `/host/frame?device=${encodeURIComponent(config.id)}`;

    const entry: Entry = {
      config,
      capabilities: emptyCapabilities(),
      screen: config.screen ?? screenSize,
      frame,
      device: null,
      unmount: null,
      connected: new Set(),
    };

    this.size(entry);
    this.entries.set(config.id, entry);
    (this.slots.get(config.id) ?? this.holder).appendChild(frame);

    return entry;
  }

  private close(id: string): void {
    const entry = this.entries.get(id);

    if (!entry) return;
    entry.device?.dispose();
    entry.frame.remove();
    this.entries.delete(id);
  }

  /** Makes the devices match the supervisor's list, keeping those already running. */
  sync(configs: DeviceConfig[]): void {
    const wanted = new Set(configs.map((config) => config.id));

    for (const id of this.ids()) if (!wanted.has(id)) this.close(id);

    for (const config of configs) {
      const entry = this.entries.get(config.id) ?? this.open(config);

      if (config.screen) {
        entry.screen = config.screen;
        this.size(entry);
      }
    }
  }

  /** The server became reachable or not, or its connections were cut. */
  gate(open: boolean, epoch: number): void {
    this.options.gate.open = open;
    this.options.gate.epoch = epoch;

    for (const entry of this.entries.values()) entry.device?.network.reset();
  }

  private known(id: string): Entry {
    const entry = this.entries.get(id);

    if (!entry) throw new Error('unknown_device');

    return entry;
  }

  /** The device running in the entry's frame, once the frame has started. */
  private async running(entry: Entry): Promise<LabDevice> {
    if (!entry.device)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          entry.connected.delete(done);
          resolve();
        };

        const timer = setTimeout(done, connectTimeoutMs);

        entry.connected.add(done);
      });

    if (!entry.device) throw new Error('device_frame_not_started');

    return entry.device;
  }

  /** What the device's screen shows, read from its own document. */
  private screenText(entry: Entry): string {
    return entry.frame.contentDocument?.body?.innerText ?? '';
  }

  /** The operations a supervisor performs on one device. */
  async call(id: string, input: JsonValue) {
    const entry = this.known(id);
    const command = commandSchema.parse(input);

    switch (command.method) {
      case 'ready':
        // Started, or stopped at the screen that offers to try starting again.
        return { ready: Boolean(entry.device?.bridge) || this.offersRetry(entry) };
      case 'resize':
        entry.screen = { width: command.width, height: command.height };
        this.size(entry);

        return { screen: entry.screen };
      case 'inspect': {
        if (!entry.device)
          return {
            device: id, kind: 'inpage', online: entry.config.online, latencyMs: entry.config.latencyMs, screen: entry.screen,
            state: null, actions: [], inputOptions: {}, diagnostics: null,
            startup: { reason: 'frame_not_started', screen: '' },
          };

        const device = entry.device;

        const app = device.bridge?.inspect() ?? {
          state: null, actions: [], inputOptions: {}, diagnostics: null,
          startup: { reason: 'app_not_ready', screen: this.screenText(entry) },
        };

        return {
          device: id,
          kind: 'inpage',
          online: device.network.online,
          latencyMs: device.network.latencyMs,
          screen: entry.screen,
          ...app,
          navigation: { index: device.navigation.index, entries: device.navigation.entries },
          capabilities: { clipboard: device.config.clipboard, share: device.config.share, ...entry.capabilities },
          storage: await device.storage(),
        };
      }

      default:
        break;
    }

    const device = await this.running(entry);

    switch (command.method) {
      case 'action':
        return device.bridge?.dispatch(command.name, command.input, command.confirmed) ?? notReady;
      case 'network':
        device.setNetwork(command.online, command.latencyMs);

        return { online: device.network.online, latencyMs: device.network.latencyMs };
      case 'reload':
        device.reload();

        return { reloaded: true };
      case 'foreground':
        device.foreground();

        return { foreground: true };
      case 'navigate':
        return { moved: device.navigation.go(command.direction === 'forward' ? 1 : -1) };
      case 'capabilities':
        device.setCapabilities(command);

        return { capabilities: entry.capabilities };
      case 'remove':
        device.dispose();
        // The screen unmounts before its data goes, so nothing writes it back.
        entry.unmount?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await device.forget();
        this.close(id);

        return { removed: true };
    }
  }

  private offersRetry(entry: Entry): boolean {
    const buttons = entry.frame.contentDocument?.querySelectorAll('button,[role="button"]');

    return Array.from(buttons ?? []).some((button) => button.textContent?.trim() === 'Try again');
  }
}

/** Mounts the many-device host into the lab page and returns it. */
export function mountLabHost(options: HostOptions): LabHost {
  return new LabHost(options);
}
