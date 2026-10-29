import { Component, createElement, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import type { JsonValue } from '@splitnext/client';
import { AppScreen } from '../ui/AppScreen';
import { ScreenHostContext, type ScreenHost } from '../ui/screenHost';
import { colors, fontFamily, monoFamily } from '../ui/theme';
import { LabDevice, type DeviceConfig, type HostEnvironment } from './device';
import type { LabReport } from './events';
import type { ServerGate } from './virtualNetwork';

type Size = { width: number; height: number };

/** The size of a phone screen, as the browser devices' viewport, until the supervisor sets another. */
const screenSize: Size = { width: 390, height: 780 };

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

/**
 * Many devices in one document. The lab page gives each device a slot to
 * show it in; the supervisor drives them through `call`.
 */
export class LabHost {
  private readonly devices = new Map<string, LabDevice>();
  private readonly slots = new Map<string, HTMLElement>();
  private readonly screens = new Map<string, Size>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private readonly environment: HostEnvironment;

  constructor(private readonly options: HostOptions) {
    this.environment = {
      workerOrigin: options.workerOrigin,
      server: options.gate,
      report: options.report,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = () => this.version;

  private touch() {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  ids(): string[] {
    return [...this.devices.keys()];
  }

  device(id: string): LabDevice | undefined {
    return this.devices.get(id);
  }

  slotFor(id: string): HTMLElement | undefined {
    return this.slots.get(id);
  }

  screenOf(id: string): Size {
    return this.screens.get(id) ?? screenSize;
  }

  /** Where a device shows; the lab page owns the element. */
  attach(id: string, slot: HTMLElement): void {
    this.slots.set(id, slot);
    this.touch();
  }

  detach(id: string): void {
    this.slots.delete(id);
    this.touch();
  }

  /** Makes the devices match the supervisor's list, keeping those already running. */
  sync(configs: DeviceConfig[]): void {
    const wanted = new Set(configs.map((config) => config.id));

    for (const [id, device] of this.devices)
      if (!wanted.has(id)) {
        device.dispose();
        this.devices.delete(id);
        this.screens.delete(id);
      }

    for (const config of configs) {
      if (!this.devices.has(config.id))
        this.devices.set(config.id, new LabDevice(config, this.environment));

      if (config.screen) this.screens.set(config.id, config.screen);
    }

    this.touch();
  }

  /** The server became reachable or not, or its connections were cut. */
  gate(open: boolean, epoch: number): void {
    this.options.gate.open = open;
    this.options.gate.epoch = epoch;

    for (const device of this.devices.values()) device.network.reset();
  }

  private known(id: string): LabDevice {
    const device = this.devices.get(id);

    if (!device) throw new Error('unknown_device');

    return device;
  }

  /** The operations a supervisor performs on one device. */
  async call(id: string, input: JsonValue) {
    const device = this.known(id);
    const command = commandSchema.parse(input);

    switch (command.method) {
      case 'inspect': {
        const app = device.bridge?.inspect() ?? {
          state: null, actions: [], inputOptions: {}, diagnostics: null,
          startup: { reason: 'app_not_ready', screen: this.slots.get(id)?.innerText ?? '' },
        };

        return {
          device: id,
          kind: 'inpage',
          online: device.network.online,
          latencyMs: device.network.latencyMs,
          screen: this.screenOf(id),
          ...app,
          navigation: { index: device.navigation.index, entries: device.navigation.entries },
          capabilities: { clipboard: device.config.clipboard, share: device.config.share, ...device.capabilities },
          storage: await device.storage(),
        };
      }

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

        return { capabilities: device.capabilities };
      case 'remove':
        device.dispose();
        this.devices.delete(id);
        this.screens.delete(id);
        this.touch();
        // The screen unmounts before its data goes, so nothing writes it back.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await device.forget();

        return { removed: true };
      case 'resize':
        this.screens.set(id, { width: command.width, height: command.height });
        this.touch();

        return { screen: this.screenOf(id) };
      case 'ready':
        // Started, or stopped at the screen that offers to try starting again.
        return { ready: Boolean(device.bridge) || this.offersRetry(id) };
    }
  }

  private offersRetry(id: string): boolean {
    const buttons = this.slots.get(id)?.querySelectorAll('button,[role="button"]');

    return Array.from(buttons ?? []).some((button) => button.textContent?.trim() === 'Try again');
  }
}

type BoundaryState = { error: string | null };

/** Reports a screen that failed, so one device cannot take the others down. */
class DeviceBoundary extends Component<{ children: ReactNode; device: string; report: LabReport }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error: String(error) };
  }

  override componentDidCatch(error: Error) {
    this.props.report({ name: 'page.error', detail: { device: this.props.device, error: String(error) } });
  }

  override render() {
    return this.state.error ? createElement('pre', { style: { padding: 12, color: colors.dangerInk, whiteSpace: 'pre-wrap' } }, this.state.error) : this.props.children;
  }
}

function DeviceFrame(props: { device: LabDevice; screen: Size; report: LabReport }) {
  const device = props.device;
  const { width, height } = props.screen;
  const generation = useSyncExternalStore((listener) => device.subscribe(listener), () => device.generation);
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);

  const host = useMemo<ScreenHost | null>(() => frame && overlay ? {
    frame,
    overlay,
    size: { width, height },
    readClipboard: async () => device.capabilities.clipboardText,
  } : null, [frame, overlay, device, width, height]);

  return (
    <div
      data-lab-device={device.config.id}
      ref={setFrame}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', width, height, overflow: 'hidden', contain: 'layout paint', isolation: 'isolate', background: colors.background, color: colors.ink, colorScheme: 'light' }}
    >
      <div ref={setOverlay} style={{ position: 'absolute', inset: 0, zIndex: 1000, pointerEvents: 'none' }} />
      {host ? (
        <ScreenHostContext.Provider value={host}>
          <DeviceBoundary device={device.config.id} report={props.report}>
            <AppScreen key={generation} substrate={device.substrate} />
          </DeviceBoundary>
        </ScreenHostContext.Provider>
      ) : null}
    </div>
  );
}

function HostView(props: { host: LabHost; report: LabReport }) {
  useSyncExternalStore(props.host.subscribe, props.host.snapshot);

  return (
    <>
      {props.host.ids().map((id) => {
        const device = props.host.device(id);
        const slot = props.host.slotFor(id);

        return device && slot ? createPortal(<DeviceFrame device={device} screen={props.host.screenOf(id)} report={props.report} />, slot, id) : null;
      })}
    </>
  );
}

const styleId = 'splitnext-lab-device-styles';

/** The document-level rules the standalone page carries in its head. */
function installStyles(): void {
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');

  style.id = styleId;
  style.textContent =
    `@font-face{font-family:"${fontFamily}";src:url(/assets/instrument-sans.woff2) format("woff2");font-style:normal;font-weight:400 700;font-display:swap}` +
    `@font-face{font-family:"${monoFamily}";src:url(/assets/geist-mono.woff2) format("woff2");font-style:normal;font-weight:400 700;font-display:swap}` +
    `[data-lab-device]{-webkit-font-smoothing:antialiased}` +
    `[data-lab-device] :focus-visible{outline:3px solid ${colors.action}!important;outline-offset:2px}` +
    '[data-lab-device] input:focus-visible,[data-lab-device] textarea:focus-visible{outline:none!important}';
  document.head.appendChild(style);
}

function deviceOf(node: Element | null): Element | null {
  return node?.closest('[data-lab-device]') ?? null;
}

/**
 * The document has one keyboard focus. A device that focuses its own field on
 * its own, such as a form opening on a remote action, must not take it from a
 * field someone is typing in on another device.
 */
function guardFocus(): void {
  // SAFETY: the original is only ever called on the element it was looked up for.
  // eslint-disable-next-line typescript/unbound-method
  const focus = HTMLElement.prototype.focus;

  HTMLElement.prototype.focus = function guardedFocus(options?: FocusOptions) {
    const mine = deviceOf(this);
    const current = document.activeElement;
    const typing = current instanceof HTMLInputElement || current instanceof HTMLTextAreaElement;

    if (mine && typing && deviceOf(current) !== mine) return;
    focus.call(this, options);
  };
}

/** Mounts the many-device host into the lab page and returns it. */
export function mountLabHost(options: HostOptions): LabHost {
  installStyles();
  guardFocus();

  const host = new LabHost(options);
  const root = document.createElement('div');

  root.hidden = true;
  document.body.appendChild(root);
  createRoot(root).render(<HostView host={host} report={options.report} />);

  return host;
}
