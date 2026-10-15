export type RefreshPolicy = {
  run(): Promise<void>;
  needsRetry(): boolean;
  failed(error: Error): void;
};

/** One refresh in flight; connectivity changes request at most one follow-up. */
export class RefreshCoordinator {
  private running: Promise<void> | null = null;
  private followup = false;
  private disposed = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly policy: RefreshPolicy) {}

  request(followup = false): Promise<void> {
    this.cancelTimer();

    if (this.disposed) return Promise.resolve();

    if (this.running) {
      this.followup ||= followup;

      return this.running;
    }

    this.running = this.run().finally(() => {
      this.running = null;
      this.schedule();
    });

    return this.running;
  }

  schedule(): void {
    this.cancelTimer();

    if (this.disposed || this.running) return;

    if (!this.policy.needsRetry()) {
      this.attempt = 0;

      return;
    }

    const delay = Math.min(10000 * 2 ** this.attempt++, 60000);

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.request().catch(() => undefined);
    }, delay);
  }

  cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.disposed = true;
    this.followup = false;
    this.cancelTimer();
  }

  private async run(): Promise<void> {
    do {
      this.followup = false;

      try {
        await this.policy.run();
      } catch (cause) {
        this.policy.failed(cause instanceof Error ? cause : new Error('sync_failed'));
        throw cause;
      }
    } while (this.followup && !this.disposed);
  }
}
