import { parseInviteLink } from '@splitnext/client';
import { incomingLinks, normalizeSystemLink } from '../native/incomingLinks';

/** Native invitations stay in one app route, including while an editor is open. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  // Accept both splitnext://j#code and splitnext:///j#code.
  const canonical = normalizeSystemLink(path);

  if (!parseInviteLink(canonical)) return path;
  incomingLinks.receive(canonical);

  return '/app';
}
