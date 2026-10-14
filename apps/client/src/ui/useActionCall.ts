import { createContext, useContext, useRef, useState } from 'react';
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

type Confirmation = {
  message: string;
  /** Runs the same call again with the person's approval. */
  confirm: () => void;
};

/**
 * The UI's adapter for app actions: one control's busy state, error message,
 * and pending confirmation. Other callers use the dispatcher directly.
 */
export function useActionCall() {
  const actions = useActions();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

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

      setConfirmation(
        outcome.status === 'needs_confirmation'
          ? {
              message: outcome.message,
              confirm: () => {
                setConfirmation(null);
                void call(name, input, onDone, true);
              },
            }
          : null,
      );

      if (outcome.status === 'failed')
        setError(errorMessage(new Error(outcome.error)));

      if (outcome.status === 'done') onDone?.(outcome.value);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return {
    call,
    busy,
    error,
    confirmation,
    cancel: () => setConfirmation(null),
  };
}
