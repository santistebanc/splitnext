import { ActionExecutions } from './executions';
import { DiagnosticsLog } from './diagnosticsLog';
import { z } from 'zod';
import type { ClientDiagnosticObserver, JsonValue } from '@splitnext/client';
import { AppUiState, type UiState } from './uiState';
import { sourceOptions, type ValueSource } from './actionInputs';
import { workflowEffect, workflowCompletions } from './workflow';
import { unavailable, type ActionAvailability, type ActionContext, type ActionHost, type ActionPlatform, type DispatchOptions, type DispatcherOptions, type Outcome } from './actions/define';
import { accessActions } from './actions/access';
import { ledgerActions } from './actions/ledger';
import { uiActions } from './actions/ui';

export { actionGroups, type ActionAvailability, type ActionGroup, type ActionHost, type ActionPlatform, type DispatchOptions, type Outcome, type Requirement } from './actions/define';

export type { InviteCheck } from './actions/access';

/**
 * Everything a person can do in the app, callable the same way by any caller:
 * UI events, an assistant, RPC, tests, or the workbench. See ADR 0016.
 */
export const appActions = { ...uiActions, ...ledgerActions, ...accessActions };

export type AppActionName = keyof typeof appActions;

export type ActionInput<N extends AppActionName> = Parameters<
  (typeof appActions)[N]['execute']
>[1];

export type ActionOutput<N extends AppActionName> =
  Awaited<ReturnType<(typeof appActions)[N]['execute']>> extends Outcome<
    infer O
  >
    ? O
    : never;

// Correlates each name with its own input and output for generic dispatch.
type Catalog = {
  [N in AppActionName]: {
    availability(
      context: ActionContext,
      input?: ActionInput<N> | JsonValue,
    ): ActionAvailability;
    execute(
      host: ActionHost,
      input: ActionInput<N>,
      options: DispatchOptions,
      ui: AppUiState,
      platform: ActionPlatform,
      pendingConfirmation: ActionAvailability | undefined,
      executions: ActionExecutions,
      name: string,
    ): Promise<Outcome<ActionOutput<N>>>;
  };
};

const catalog: Catalog = appActions;

/** What one dispatch did, for observers such as logs or transcripts. */
export type DispatchRecord = {
  invocationId: string;
  parentInvocationId: string | null;
  durationMs: number;
  groupId: string | null;
  before: { view: UiState['view']; phase: UiState['phase'] };
  after: { view: UiState['view']; phase: UiState['phase'] };
  name: AppActionName;
  origin: string;
  status: Outcome<null>['status'];
  /** The failure code or confirmation message, when there is one. */
  detail: string | null;
};

export type Dispatcher = ReturnType<typeof createDispatcher>;

/** A description of one action that any caller can read, including assistants. */
export type ActionDescription = ReturnType<typeof describeActions>[number];

export function isActionName(name: string): name is AppActionName {
  return Object.hasOwn(appActions, name);
}

/** Binds the catalog to one host; every caller uses the result the same way. */
export function createDispatcher(
  host: ActionHost,
  options: DispatcherOptions = {},
) {
  const observers = new Set<(record: DispatchRecord) => void>();
  const executions = new ActionExecutions();

  const ui = new AppUiState(
    () => host.snapshot(),
    () => host.lastYouName(),
    options.initialLink,
  );

  // Collected in every build from the start, for devtools and support reports.
  const diagnostics = new DiagnosticsLog();

  host.client.observeDiagnostics?.((event) => diagnostics.recordEvent(event));

  const platform: ActionPlatform = {
    appUrl: options.appUrl ?? '',
    ...options,
    diagnosticsReport: () => diagnostics.report(host.snapshot(), ui.snapshot()),
  };

  let pendingAvailability: {
    id: string;
    check: () => ActionAvailability;
  } | null = null;

  function confirmationAvailability(): ActionAvailability | undefined {
    return pendingAvailability?.id === ui.snapshot().confirmation?.id
      ? pendingAvailability?.check()
      : undefined;
  }

  async function dispatch<N extends AppActionName>(
    name: N,
    input: ActionInput<N>,
    options: DispatchOptions = {},
  ): Promise<Outcome<ActionOutput<N>>> {
    const invocationId = crypto.randomUUID();
    const started = Date.now();
    const before = { view: ui.snapshot().view, phase: ui.snapshot().phase };
    let stableInput: ActionInput<N>;

    try {
      stableInput = structuredClone(input);
    } catch {
      return {
        status: 'failed',
        error: 'invalid_input',
        issues: ['Input must be serializable action data.'],
      };
    }

    if (options.confirmed && ui.snapshot().confirmation?.name === name) {
      const pending = ui.snapshot().confirmation;

      if (pending) ui.cancelConfirmation(pending.id);
    }

    const targetGroup = host.snapshot().group?.group_id;
    const navigation = ui.snapshot().navigation.revision;

    const confirmationContext = (): ActionAvailability =>
      host.snapshot().group?.group_id === targetGroup && ui.snapshot().navigation.revision === navigation
        ? { available: true }
        : unavailable('confirmation_context_changed', 'Request confirmation again in the current group.');

    const result = await catalog[name].execute(
      host.forInvocation?.({ id: invocationId, groupId: targetGroup }) ?? host,
      stableInput,
      { ...options, invocationId },
      ui,
      platform,
      confirmationAvailability(),
      executions,
      name,
    );

    const outcome =
      result.status === 'needs_confirmation'
        ? {
            ...result,
            requestId: ui.requestConfirmation(
              name,
              result.message,
              async () => {
                const context = confirmationContext();

                if (!context.available) throw new Error(context.error);

                const confirmed = await dispatch(name, stableInput, {
                  ...options,
                  confirmed: true,
                  parentInvocationId: invocationId,
                });

                if (confirmed.status === 'failed')
                  throw new Error(confirmed.error);

                if (confirmed.status !== 'done')
                  throw new Error('confirmation_required');

                return;
              },
            ),
          }
        : result;

    if (outcome.status === 'needs_confirmation' && outcome.requestId)
      pendingAvailability = {
        id: outcome.requestId,
        check: () => {
          const context = confirmationContext();

          return context.available ? catalog[name].availability(
            { state: host.snapshot(), ui: ui.snapshot(), platform, executions: executions.snapshot() },
            stableInput,
          ) : context;
        },
      };

    const record: DispatchRecord = {
      invocationId,
      parentInvocationId: options.parentInvocationId ?? null,
      durationMs: Date.now() - started,
      groupId: targetGroup ?? null,
      before,
      after: { view: ui.snapshot().view, phase: ui.snapshot().phase },
      name,
      origin: options.origin ?? 'unspecified',
      status: outcome.status,
      detail:
        outcome.status === 'failed'
          ? outcome.error
          : outcome.status === 'needs_confirmation'
            ? outcome.message
            : null,
    };

    diagnostics.recordDispatch(record);

    for (const observer of observers) {
      try {
        observer(record);
      } catch {
        // Diagnostics never change the result of an already executed action.
      }
    }

    return outcome;
  }

  /** For callers holding only names and JSON, such as RPC or an assistant. */
  async function dispatchJson(
    name: string,
    input: JsonValue,
    options: DispatchOptions = {},
  ): Promise<Outcome<ActionOutput<AppActionName>>> {
    if (!isActionName(name))
      return { status: 'failed', error: 'unknown_action', issues: [name] };

    // SAFETY: execute validates the input with the action's own schema before
    // using it, so an unchecked JSON value cannot reach the action.
    return dispatch(name, input as ActionInput<typeof name>, options);
  }

  function observe(observer: (record: DispatchRecord) => void): () => void {
    observers.add(observer);

    return () => observers.delete(observer);
  }

  /** Without input, reports state/capability checks; with input, validates it too. */
  function availability(
    name: AppActionName,
    input?: JsonValue,
  ): ActionAvailability {
    return appActions[name].availability(
      {
        state: host.snapshot(),
        ui: ui.snapshot(),
        platform,
        pendingConfirmation: confirmationAvailability(),
        executions: executions.snapshot(),
      },
      input,
    );
  }

  const descriptions = describeActions();

  function describe() {
    const context: ActionContext = {
      state: host.snapshot(), ui: ui.snapshot(), platform,
      pendingConfirmation: confirmationAvailability(), executions: executions.snapshot(),
    };

    return descriptions.map((action) => ({
      ...action,
      running: context.executions?.filter((entry) => entry.name === action.name) ?? [],
      availability: appActions[action.name].availability(context),
      workflowEffect: action.workflow ? workflowEffect(context.ui, action.workflow) : null,
    }));
  }

  function stateActionMap() {
    const state = ui.snapshot();

    return {
      current: { view: state.view, phase: state.phase },
      completions: workflowCompletions(state),
      executions: executions.snapshot(),
      actions: describe(),
    };
  }

  return {
    dispatch,
    dispatchJson,
    availability,
    inputOptions: (source: ValueSource) => sourceOptions(source, { ...host.snapshot(), ui: ui.snapshot() }, platform.appUrl),
    describe,
    stateActionMap,
    observe,
    observeDiagnostics: (observer: ClientDiagnosticObserver) => host.client.observeDiagnostics?.(observer) ?? (() => undefined),
    /** Recent dispatches and SDK events, collected since the dispatcher started. */
    diagnostics: {
      snapshot: diagnostics.snapshot,
      subscribe: diagnostics.subscribe,
      clear: () => diagnostics.clear(),
      report: () => diagnostics.report(host.snapshot(), ui.snapshot()),
    },
    ui: { snapshot: ui.snapshot, subscribe: ui.subscribe },
    capabilities: {
      copyText: Boolean(platform.copyText),
      shareLink: Boolean(platform.shareLink),
    },
    executions: { snapshot: executions.snapshot, subscribe: executions.subscribe },
    state: () => ({ ...host.snapshot(), ui: ui.snapshot(), executions: executions.snapshot() }),
  };
}

/** Every action's description, for any caller; it needs no app state. */
export function describeActions() {
  return Object.entries(appActions).flatMap(([name, action]) =>
    isActionName(name)
      ? [
          {
            name,
            group: action.group,
            description: action.description,
            requires: action.requires,
            workflow: action.workflow,
            confirms: action.confirms,
            // SAFETY: examples are literal inputs of their own schemas,
            // which accept only JSON-compatible values.
            example: action.example as JsonValue,
            inputSchema: z.toJSONSchema(action.input),
          },
        ]
      : [],
  );
}
