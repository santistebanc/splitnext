import { z } from 'zod';
import { router } from 'expo-router';

import { groupViews, viewNames } from '../model/uiState';

/** Browser history entries the app writes, read back on Back and Forward. */
export const navigationSchema = z.object({
  splitnext: z.literal(true),
  view: z.enum(viewNames),
  trail: z.array(z.enum(groupViews)).optional(),
  person: z.string().nullable().optional(),
  groupId: z.string().nullable(),
});

export type NavigationEntry = z.output<typeof navigationSchema>;

export type AppNavigation = {
  url(): string;
  enterApp(): void;
  write(entry: NavigationEntry, mode: 'push' | 'replace'): void;
  subscribe(listener: (entry: NavigationEntry) => void): () => void;
};

/** Browser URL and history effects stay at this adapter boundary. */
export const browserNavigation: AppNavigation = {
  url: () => window.location.href,
  enterApp: () => {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    router.replace('/app');
  },
  write: (entry, mode) => {
    if (mode === 'push') window.history.pushState(entry, '', window.location.href);
    else window.history.replaceState(entry, '', window.location.href);
  },
  subscribe: (listener) => {
    const back = (event: PopStateEvent) => {
      const parsed = navigationSchema.safeParse(event.state);

      if (parsed.success) listener(parsed.data);
    };

    window.addEventListener('popstate', back);

    return () => window.removeEventListener('popstate', back);
  },
};
