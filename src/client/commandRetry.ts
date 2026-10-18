import type { ClientNotice } from './storage';
import { commandFromIntent, intentForRetry, type GroupCommand } from '../domain/commands';
import type { GroupSnapshot } from '../domain/sync';

/** A notice retry is new intent, based on the current projected state. */
export function commandForRetry(
  notice: ClientNotice,
  snapshot: GroupSnapshot,
  createId: () => string,
): GroupCommand {
  return commandFromIntent(intentForRetry(notice.command), snapshot, createId);
}
