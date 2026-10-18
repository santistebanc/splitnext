import { router } from 'expo-router';
import type { ActionPlatform } from '../model/actions';
import { localeRegion } from '../model/currency';

/** Browser effects at the action layer's platform seam. */
export function browserActionPlatform(): ActionPlatform {
  const platform: ActionPlatform = {
    appUrl: window.location.origin,
    openHomepage: () => router.push('/'),
    localeRegion: localeRegion(navigator.languages[0] ?? navigator.language),
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
