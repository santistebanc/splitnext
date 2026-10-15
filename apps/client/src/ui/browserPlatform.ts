import { router } from 'expo-router';
import type { ActionPlatform } from '../model/actions';

/** Browser effects at the action layer's platform seam. */
export function browserActionPlatform(): ActionPlatform {
  const platform: ActionPlatform = {
    appUrl: window.location.origin,
    openHomepage: () => router.push('/'),
  };

  if (navigator.clipboard)
    platform.copyLink = (link) => navigator.clipboard.writeText(link);

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
