import { z } from 'zod';
import { router } from 'expo-router';
import type { ActionPlatform } from '../model/actions';
import { createBrowserApp } from '../model/browser';
import { browserNavigation } from './navigation';
import { browserLifecycle } from './browserLifecycle';
import type { AppSubstrate } from './substrate';
import { attachLabBridge } from '../lab/bridge';

/** Browser effects at the action layer's platform seam. */
export function browserActionPlatform(): ActionPlatform {
  const platform: ActionPlatform = {
    appUrl: window.location.origin,
    openHomepage: () => router.push('/'),
  };

  if (navigator.clipboard)
    platform.copyText = (text) => navigator.clipboard.writeText(text);

  if (navigator.share)
    platform.shareLink = async (url, title) => {
      try {
        await navigator.share({ url, title });
      } catch (cause) {
        if (!(cause instanceof Error) || cause.name !== 'AbortError') throw cause;
      }
    };

  return platform;
}

/** How far this installation has seen each group's Activity, kept in localStorage. */
export const browserSeenStorage = {
  read(): Record<string, number> {
    try {
      const parsed = seenSchema.safeParse(JSON.parse(localStorage.getItem(activitySeenKey) ?? '{}'));

      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  },
  write(seen: Record<string, number>): void {
    try {
      localStorage.setItem(activitySeenKey, JSON.stringify(seen));
    } catch {
      // Seen markers are a convenience; a full store only shows items as new again.
    }
  },
};

const activitySeenKey = 'splitnext.activity-seen.v1';

const seenSchema = z.record(z.string(), z.number().int());

export const browserSubstrate: AppSubstrate = {
  createApp: createBrowserApp,
  actions: browserActionPlatform,
  navigation: browserNavigation,
  lifecycle: browserLifecycle,
  seenStorage: browserSeenStorage,
  observe: attachLabBridge,
};
