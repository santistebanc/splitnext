import type { AppController, AppState } from '../model/controller';
import type { Dispatcher, DispatchRecord } from '../model/actions';
import type { UiState } from '../model/uiState';
import { valueSources } from '../model/actionInputs';
import type { JsonValue } from '@splitnext/client';

declare global {
  interface Window {
    /** Installed before startup only by the local lab browser adapter. */
    splitnextLabEnabled?: boolean;
    splitnextLab?: ReturnType<typeof labBridge>;
    splitnextLabEvent?: (event: string) => Promise<void>;
  }
}

function labBridge(app: AppController, actions: Dispatcher) {
  return {
    inspect: () => ({ state: actions.state(), actions: actions.describe(), inputOptions: Object.fromEntries(valueSources.map((source) => [source, actions.inputOptions(source)])), diagnostics: actions.diagnostics.snapshot() }),
    dispatch: (name: string, input: JsonValue, confirmed = false) => actions.dispatchJson(name, input, { confirmed, origin: 'lab' }),
    online: (online: boolean) => app.setOnline(online),
  };
}

/** Bind automation to the dispatcher used by the screen. */
export function attachLabBridge(app: AppController, actions: Dispatcher) {
  if (!window.splitnextLabEnabled) return;
  const bridge = labBridge(app, actions);
  window.splitnextLab = bridge;

  const emit = (kind: string, detail: AppState | UiState | DispatchRecord) => {
    void window.splitnextLabEvent?.(JSON.stringify({ kind, detail })).catch(() => undefined);
  };

  const unsubscribe = [
    app.subscribe(() => emit('state', app.snapshot())),
    actions.ui.subscribe(() => emit('ui', actions.ui.snapshot())),
    actions.observe((record) => emit('action', record)),
  ];

  return () => {
    unsubscribe.forEach((stop) => stop());

    if (window.splitnextLab === bridge) delete window.splitnextLab;
  };
}
