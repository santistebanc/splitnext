import { useEffect } from 'react';
import type { AppController, AppState } from '../model/controller';

/**
 * Keeps the open group's Activity current while connected, so the bell can
 * count new changes from others without opening Activity. This is background
 * synchronization, outside the action catalog.
 */
export function useActivityFeed(app: AppController, state: AppState): void {
  const group = state.group;
  const groupId = group?.group_id;
  const active = state.online && state.reachable && Boolean(groupId) && !group?.hidden;

  useEffect(() => {
    if (!active || !groupId) return;

    // History-read failures leave sync and review feedback as they were.
    void app.client.activity(groupId).then(() => app.readStorage()).catch(() => undefined);
  }, [groupId, group?.revision, active]);
}
