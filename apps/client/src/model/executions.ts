export type PendingExecution = {
  id: number;
  invocationId: string | null;
  name: string;
  origin: string;
  resources: readonly string[];
};

/** Pending work is shared by every caller of one dispatcher. */
export class ActionExecutions {
  private pending: readonly PendingExecution[] = [];
  private sequence = 0;
  private listeners = new Set<() => void>();

  snapshot = (): readonly PendingExecution[] => this.pending;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  start(name: string, origin: string, resources: readonly string[], invocationId?: string): number {
    const id = ++this.sequence;
    this.pending = [...this.pending, { id, invocationId: invocationId ?? null, name, origin, resources }];
    this.changed();

    return id;
  }

  finish(id: number): void {
    this.pending = this.pending.filter((entry) => entry.id !== id);
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Presentation observers must not strand resources or prevent user intent.
      }
    }
  }
}
