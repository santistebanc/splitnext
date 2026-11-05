import { Component, createElement, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useWindowDimensions } from 'react-native';
import { AppScreen } from '../ui/AppScreen';
import { ScreenHostContext, type ScreenHost } from '../ui/screenHost';
import { colors, fonts } from '../design';
import { LabDevice, type DeviceConfig, type FakeCapabilities, type HostEnvironment } from './device';
import type { LabReport } from './events';

/** What the host page hands the frame that shows one device. */
export type FrameLink = {
  config: DeviceConfig;
  capabilities: FakeCapabilities;
  environment: HostEnvironment;
  /** The frame's device started; `unmount` stops its screen before its data is deleted. */
  connect(device: LabDevice, unmount: () => void): void;
  /** The frame is going away, as when it reloads. */
  disconnect(device: LabDevice): void;
};

declare global {
  interface Window {
    /** Set by the lab's device frame page before it loads the app. */
    splitnextLabFramePage?: boolean;
    /** Offered by the host page to the frames it owns. */
    splitnextLabFrameLink?: (id: string) => FrameLink | undefined;
  }
}

type BoundaryState = { error: string | null };

/** Reports a screen that failed, as a page error of this device. */
class DeviceBoundary extends Component<{ children: ReactNode; device: string; report: LabReport }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error: String(error) };
  }

  override componentDidCatch(error: Error) {
    this.props.report({ name: 'page.error', detail: { device: this.props.device, error: String(error) } });
  }

  override render() {
    return this.state.error ? createElement('pre', { style: { padding: 12, color: colors.danger, whiteSpace: 'pre-wrap' } }, this.state.error) : this.props.children;
  }
}

function DeviceScreen(props: { device: LabDevice; report: LabReport }) {
  const device = props.device;
  const generation = useSyncExternalStore((listener) => device.subscribe(listener), () => device.generation);
  // The frame is the device's window, so its size is the screen's.
  const { width, height } = useWindowDimensions();
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
      ref={setFrame}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', isolation: 'isolate', background: colors.background, color: colors.ink }}
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

/** The document-level rules the standalone page carries in its head. */
function installStyles(): void {
  const style = document.createElement('style');

  style.textContent =
    `@font-face{font-family:"${fonts.body}";src:url(/assets/instrument-sans.woff2) format("woff2");font-style:normal;font-weight:400 700;font-display:swap}` +
    `@font-face{font-family:"${fonts.mono}";src:url(/assets/geist-mono.woff2) format("woff2");font-style:normal;font-weight:400 700;font-display:swap}` +
    'html,body{height:100%;margin:0;overflow:hidden;color-scheme:light;-webkit-font-smoothing:antialiased}' +
    `:focus-visible{outline:3px solid ${colors.ink}!important;outline-offset:2px}` +
    'input:focus-visible,textarea:focus-visible{outline:none!important}';
  document.head.appendChild(style);
}

const typing = (element: Element | null | undefined) => element?.tagName === 'INPUT' || element?.tagName === 'TEXTAREA';

/**
 * The lab page has one keyboard focus. A device that focuses its own field on
 * its own, such as a form opening on a remote action, must not take it from a
 * field someone is typing in on another device.
 */
function guardFocus(): void {
  // SAFETY: the original is only ever called on the element it was looked up for.
  // eslint-disable-next-line typescript/unbound-method
  const focus = HTMLElement.prototype.focus;

  HTMLElement.prototype.focus = function guardedFocus(options?: FocusOptions) {
    // The page's focused element is the frame that has the keyboard.
    const active = window.parent.document.activeElement;

    if (active !== window.frameElement && typing(frameOf(active)?.contentDocument?.activeElement)) return;
    focus.call(this, options);
  };
}

// Elements of the host page come from its realm, so they are told apart by tag.
const frameOf = (element: Element | null): HTMLIFrameElement | null =>
  // SAFETY: an element whose tag is IFRAME is an HTMLIFrameElement, from whichever realm.
  element?.tagName === 'IFRAME' ? (element as HTMLIFrameElement) : null;

/** Starts the one device this frame shows, with what its host page hands it. */
export function mountLabFrame(): void {
  const id = new URLSearchParams(location.search).get('device') ?? '';
  const link = window.parent === window ? undefined : window.parent.splitnextLabFrameLink?.(id);

  if (!link) {
    document.body.textContent = 'This page shows a lab device inside the device lab.';

    return;
  }

  installStyles();
  guardFocus();
  const device = new LabDevice({ ...link.config }, link.environment, link.capabilities);
  const container = document.createElement('div');

  container.style.height = '100%';
  document.body.appendChild(container);
  const root = createRoot(container);

  root.render(<DeviceScreen device={device} report={link.environment.report} />);
  addEventListener('pagehide', () => link.disconnect(device));
  link.connect(device, () => root.unmount());
}
