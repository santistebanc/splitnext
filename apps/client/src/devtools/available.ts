import { apiBaseUrl } from '../model/browser';

/**
 * Whether devtools may run. Expo development always allows them; exported
 * builds ask the Worker, which answers only when debug inspection is enabled
 * (as `npm run dev` does, never in production). Deciding at runtime keeps every
 * build identical, so a cached build can never enable them by mistake.
 */
export async function devtoolsAllowed(): Promise<boolean> {
  if (__DEV__) return true;

  try {
    return (await fetch(`${apiBaseUrl()}/debug/status`)).ok;
  } catch {
    return false;
  }
}
