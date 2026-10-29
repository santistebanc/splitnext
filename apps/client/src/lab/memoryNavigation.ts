import type { AppNavigation, NavigationEntry } from '../ui/navigation';

/** Navigation kept in memory: history entries the screen writes, read back by Back. */
export class MemoryNavigation implements AppNavigation {
  entries: (NavigationEntry | null)[] = [null];
  index = 0;
  private readonly listeners = new Set<(entry: NavigationEntry) => void>();

  constructor(private readonly address: string) {}

  url = () => this.address;
  enterApp = () => undefined;

  write = (entry: NavigationEntry, mode: 'push' | 'replace') => {
    if (mode === 'push') {
      this.entries.splice(this.index + 1, this.entries.length, entry);
      this.index = this.entries.length - 1;
    } else this.entries[this.index] = entry;
  };

  subscribe = (listener: (entry: NavigationEntry) => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  go(step: -1 | 1): boolean {
    const next = this.index + step;
    const entry = this.entries[next];

    if (!entry) return false;
    this.index = next;
    this.listeners.forEach((listener) => listener(entry));

    return true;
  }
}
