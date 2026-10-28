import type { AppController } from '../model/controller';
import type { Dispatcher } from '../model/actions';
import type { JsonValue } from '@splitnext/client';

declare global {
  interface Window {
    /** Installed before startup only by the local lab browser adapter. */
    splitnextLabEnabled?: boolean;
    splitnextLab?: ReturnType<typeof labBridge>;
  }
}

function labBridge(app: AppController, actions: Dispatcher) {
  return {
    inspect: () => ({ state: actions.state(), actions: actions.describe(), diagnostics: actions.diagnostics.snapshot() }),
    dispatch: (name: string, input: JsonValue, confirmed = false) => actions.dispatchJson(name, input, { confirmed, origin: 'lab' }),
    online: (online: boolean) => app.setOnline(online),
  };
}

/** Bind automation to the dispatcher used by the screen. */
export function attachLabBridge(app: AppController, actions: Dispatcher) {
  if (!window.splitnextLabEnabled) return;
  const bridge = labBridge(app, actions);
  window.splitnextLab = bridge;

  return () => { if (window.splitnextLab === bridge) delete window.splitnextLab; };
}
