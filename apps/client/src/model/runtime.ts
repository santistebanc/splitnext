import { SplitnextClient, SplitnextSyncClient, type ClientStorageAdapter, type SplitnextClientOptions } from '@splitnext/client';
import { AppController, type AppPreferences, type AppNotifications } from './controller';

/** Installation assembly shared by substrates; no browser globals. */
export type AppRuntimeOptions = {
  secret: string;
  storage: ClientStorageAdapter;
  transport: SplitnextClientOptions;
  preferences: AppPreferences;
  notifications: AppNotifications;
};

export function createAppRuntime(options: AppRuntimeOptions): AppController {
  let controller: AppController | null = null;

  const api = new SplitnextClient({
    ...options.transport,
    observer: (event) => {
      options.transport.observer?.(event);

      if (event.kind === 'network_error') controller?.setReachable(false);

      if (event.kind === 'response') controller?.setReachable(true);
    },
  });

  const client = new SplitnextSyncClient({
    api,
    device_secret: options.secret,
    storage: options.storage,
    on_background_sync: (state) => {
      void controller?.receive(state).catch((error) => controller?.reportSyncError(error));
    },
    on_background_error: (error) => controller?.reportSyncError(error),
    on_presence_change: (groupId) => controller?.presenceChanged(groupId),
  });

  controller = new AppController(client, options.preferences, options.notifications);

  return controller;
}
