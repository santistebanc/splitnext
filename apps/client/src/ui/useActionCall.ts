import {
  createContext,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { JsonValue } from '@splitnext/client';
import type {
  ActionInput,
  ActionOutput,
  AppActionName,
  Dispatcher,
} from '../model/actions';
import { errorMessage } from './components';

const ActionsContext = createContext<Dispatcher | null>(null);

/** Supplies the app's dispatcher to every screen below it. */
export const ActionsProvider = ActionsContext.Provider;

export function useActions(): Dispatcher {
  const actions = useContext(ActionsContext);

  if (!actions) throw new Error('ActionsProvider is missing');

  return actions;
}

export function useUiState() {
  const actions = useActions();

  useSyncExternalStore(actions.executions.subscribe, actions.executions.snapshot, actions.executions.snapshot);

  return useSyncExternalStore(
    actions.ui.subscribe,
    actions.ui.snapshot,
    actions.ui.snapshot,
  );
}

/**
 * The UI's adapter for app actions: one control's busy state, error message,
 * and pending confirmation. Other callers use the dispatcher directly.
 */
export function useActionCall() {
  const actions = useActions();
  const ui = useUiState();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const onConfirmed = useRef<(() => void) | null>(null);
  const pending = ui.confirmation?.id === requestId ? ui.confirmation : null;

  async function call<N extends AppActionName>(
    name: N,
    input: ActionInput<N>,
    onDone?: (value: ActionOutput<N>) => void,
    confirmed = false,
  ): Promise<void> {
    if (running.current) return;

    running.current = true;
    setBusy(true);
    setError(null);

    try {
      const outcome = await actions.dispatch(name, input, {
        origin: 'ui',
        confirmed,
      });

      setRequestId(
        outcome.status === 'needs_confirmation'
          ? (outcome.requestId ?? null)
          : null,
      );
      onConfirmed.current =
        outcome.status === 'needs_confirmation'
          ? () => {
              // SAFETY: the catalog's confirmation-bearing actions return void;
              // this callback runs only after one of those actions succeeds.
              onDone?.(undefined as ActionOutput<N>);
            }
          : null;

      if (outcome.status === 'failed')
        setError(errorMessage(new Error(outcome.error)));

      if (outcome.status === 'done') onDone?.(outcome.value);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (!pending || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);

    try {
      const outcome = await actions.dispatch(
        'confirmAction',
        { requestId: pending.id },
        { origin: 'ui' },
      );

      if (outcome.status === 'failed')
        setError(errorMessage(new Error(outcome.error)));

      if (outcome.status === 'done') onConfirmed.current?.();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return {
    call,
    busy,
    /**
     * Whether this control can run an action: the catalog allows it, the same
     * answer every caller gets, and this control's own call has finished.
     */
    can: (name: AppActionName, input: JsonValue = {}) =>
      !busy && actions.availability(name, input).available,
    error,
    confirmation: pending
      ? {
          message: pending.message,
          confirm: () => {
            void confirm();
          },
        }
      : null,
    cancel: () => {
      if (pending)
        void actions.dispatch(
          'cancelConfirmation',
          { requestId: pending.id },
          { origin: 'ui' },
        );
    },
  };
}
