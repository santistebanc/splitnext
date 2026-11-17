import type { AppNavigation, NavigationEntry } from '../ui/navigation';

/** Back requests use the shared action rules; history moves only after success. */
export function createNativeNavigation() {
  const entries: NavigationEntry[] = [];
  const listeners = new Set<(entry: NavigationEntry) => void>();
  let url = '';
  const same = (left: NavigationEntry | undefined, right: NavigationEntry) => JSON.stringify(left) === JSON.stringify(right);

  const navigation: AppNavigation = {
    url: () => url,
    enterApp: () => { url = ''; },
    write: (entry, mode) => {
      if (mode === 'push' && !same(entries.at(-1), entry)) entries.push(entry);
      else if (entries.length > 1 && same(entries.at(-2), entry)) entries.pop();
      else if (entries.length) entries[entries.length - 1] = entry;
      else entries.push(entry);
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => { listeners.delete(listener); };
    },
  };

  return {
    navigation,
    setUrl: (next: string) => { url = next; },
    back: () => {
      const previous = entries.at(-2);

      if (!previous) return false;

      for (const listener of listeners) listener(previous);

      return true;
    },
  };
}
