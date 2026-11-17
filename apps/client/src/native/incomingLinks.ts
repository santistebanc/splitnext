/** Preserve fragments when the router supplies a custom-scheme URL or a path. */
export function normalizeSystemLink(path: string): string {
  const canonical = path.replace(/^splitnext:\/\/(j|join)(?=[/#])/, 'splitnext:///$1');

  return canonical.startsWith('/') ? `https://native.invalid${canonical}` : canonical;
}

/** Retain a system link across native route setup; the app action rules decide when to open it. */
export function createIncomingLinks() {
  let latest = '';
  const listeners = new Set<(url: string) => void>();

  return {
    url: () => latest,
    receive: (url: string) => {
      latest = url;

      for (const listener of listeners) listener(url);
    },
    subscribe: (listener: (url: string) => void) => {
      listeners.add(listener);

      return () => { listeners.delete(listener); };
    },
  };
}

export const incomingLinks = createIncomingLinks();
