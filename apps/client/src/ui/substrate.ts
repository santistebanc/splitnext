import type { AppController } from '../model/controller';
import type { ActionPlatform, Dispatcher } from '../model/actions';
import type { SeenStorage } from '../model/uiState';
import type { AppNavigation } from './navigation';

/** Services the shared screen needs from its installation's host. */
export type AppSubstrate = {
  createApp(): Promise<AppController>;
  actions(): ActionPlatform;
  navigation: AppNavigation;
  seenStorage: SeenStorage;
  observe?: (app: AppController, actions: Dispatcher) => void | (() => void);
  lifecycle: {
    online(): boolean;
    subscribe(online: () => void, foreground: () => void): () => void;
  };
};
