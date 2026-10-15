import type { ClientDiagnosticEvent } from '@splitnext/client';
import type { DispatchRecord } from './actions';
import type { AppState } from './controller';
import type { UiState } from './uiState';

export type LoggedDispatch = DispatchRecord & { time: string };

export type LoggedEvent = ClientDiagnosticEvent & { time: string };

type LogState = { dispatches: LoggedDispatch[]; events: LoggedEvent[] };

/**
 * The most recent dispatches and SDK commands and requests, collected from
 * the moment the app starts in every build and bounded, so devtools and a
 * diagnostics report explain what happened before anyone looked. Entries
 * hold identifiers, statuses, and codes only, never inputs, names, or links.
 */
export class DiagnosticsLog {
  private state: LogState = { dispatches: [], events: [] };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly limit = 100,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  recordDispatch(record: DispatchRecord): void {
    this.update({ ...this.state, dispatches: [{ ...record, time: this.now() }, ...this.state.dispatches].slice(0, this.limit) });
  }

  recordEvent(event: ClientDiagnosticEvent): void {
    this.update({ ...this.state, events: [{ ...event, time: this.now() }, ...this.state.events].slice(0, this.limit) });
  }

  clear(): void {
    this.update({ dispatches: [], events: [] });
  }

  snapshot = (): LogState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  /**
   * A report a person can send to support: app state as identifiers and
   * counts, and the recent log. Request ids match the Worker's request logs.
   */
  report(app: AppState, ui: UiState): string {
    const group = app.group;
    const session = group?.session;

    return JSON.stringify({
      generated_at: this.now(),
      app: { online: app.online, reachable: app.reachable, view: ui.view, phase: ui.phase, sync_error: app.syncError?.message ?? null },
      installation: session ? { identity_id: session.identity.id, device_id: session.device.id } : null,
      groups: app.groups.map((entry) => ({ group_id: entry.group_id, status: entry.status, pending_commands: entry.pending_commands, stored_locally: entry.stored_locally })),
      open_group: group
        ? {
            group_id: group.group_id,
            revision: group.revision,
            hidden: group.hidden,
            outbox: group.outbox.map((pending) => ({ command_id: pending.command.command_id, type: pending.command.type, queued_at: pending.queued_at })),
            notices: group.notices.map((notice) => ({ command_id: notice.command.command_id, type: notice.command.type, status: notice.outcome.status, reason: notice.outcome.reason })),
          }
        : null,
      dispatches: this.state.dispatches,
      requests: this.state.events,
    }, null, 2);
  }

  private update(state: LogState): void {
    this.state = state;

    for (const listener of this.listeners) listener();
  }
}
