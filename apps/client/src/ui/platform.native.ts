import { AppState, BackHandler, Keyboard, Linking, Platform, Share } from 'react-native';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import * as Clipboard from 'expo-clipboard';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { z } from 'zod';
import Storage from 'expo-sqlite/kv-store';
import { ClientStorageError, createDeviceSecret, deviceSecretSchema, parseInviteLink } from '@splitnext/client';
import { randomUUID } from 'expo-crypto';
import { createAppRuntime } from '../model/runtime';
import { SqliteClientStorage } from '../native/storage';
import { createNativeNavigation } from '../native/navigation';
import type { AppSubstrate } from './substrate';

const history = createNativeNavigation();

let database: Promise<SQLiteDatabase> | null = null;

const seenSchema = z.record(z.string(), z.number().int().nonnegative());

let online = true;

let openingSecret: Promise<string> | null = null;

async function installationSecret(): Promise<string> {
  const id = Storage.getItemSync('credential-id');

  if (id) {
    const existing = await SecureStore.getItemAsync(`splitnext.installation.${id}`);

    if (!existing) throw new ClientStorageError('storage_unavailable');

    return deviceSecretSchema.parse(existing);
  }

  // Keychain values may outlive an iOS uninstall. A new local installation
  // gets a new key rather than claiming an old installation's identity.
  const nextId = randomUUID();
  const secret = createDeviceSecret();

  await SecureStore.setItemAsync(`splitnext.installation.${nextId}`, secret, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  Storage.setItemSync('credential-id', nextId);

  return secret;
}

function connected(state: Network.NetworkState): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

function apiUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;

  if (!url || !/^https?:\/\//.test(url)) throw new Error('native_api_url_required');

  return url;
}

export const defaultSubstrate: AppSubstrate = {
  createApp: async () => {
    // A failed credential read must never silently create a new identity.
    openingSecret ??= installationSecret().catch((error) => { openingSecret = null; throw error; });
    const secret = await openingSecret;
    const baseUrl = apiUrl();
    database ??= openDatabaseAsync('splitnext-ledger.db').catch((error) => {
      database = null;

      throw error;
    });

    history.setUrl(await Linking.getInitialURL() ?? '');
    online = await Network.getNetworkStateAsync().then(connected, () => true);

    return createAppRuntime({
      secret,
      storage: new SqliteClientStorage(await database, 'installation'),
      transport: { baseUrl, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
      preferences: {
        lastGroup: () => Storage.getItemSync('last-group'),
        rememberGroup: (id) => { if (id) Storage.setItemSync('last-group', id); else Storage.removeItemSync('last-group'); },
        lastYouName: () => Storage.getItemSync('last-you-name'),
        rememberYouName: (name) => Storage.setItemSync('last-you-name', name),
      },
      notifications: { changed: () => undefined, dispose: () => undefined },
    });
  },
  actions: () => ({
    appUrl: process.env.EXPO_PUBLIC_APP_URL ?? apiUrl(),
    copyText: async (text) => { await Clipboard.setStringAsync(text); },
    shareLink: async (url, title) => { await Share.share(Platform.OS === 'ios' ? { url, title } : { message: url, title }); },
    openHomepage: () => { void Linking.openURL(process.env.EXPO_PUBLIC_APP_URL ?? apiUrl()); },
  }),
  navigation: history.navigation,
  seenStorage: {
    read: () => {
      try {
        const parsed = seenSchema.safeParse(JSON.parse(Storage.getItemSync('activity-seen') ?? '{}'));

        return parsed.success ? parsed.data : {};
      } catch { return {}; }
    },
    write: (seen) => Storage.setItemSync('activity-seen', JSON.stringify(seen)),
  },
  lifecycle: {
    online: () => online,
    subscribe: (changed, foreground) => {
      let disposed = false;

      const update = (state: Network.NetworkState) => {
        if (disposed) return;
        online = connected(state);
        changed();
      };

      const network = Network.addNetworkStateListener(update);

      const app = AppState.addEventListener('change', (state) => {
        if (state !== 'active') return;

        void Network.getNetworkStateAsync().then((state) => {
          update(state);

          if (!disposed) foreground();
        }, () => { if (!disposed) foreground(); });
      });

      // Close the race between the startup read and subscribing.
      void Network.getNetworkStateAsync().then(update, () => undefined);

      return () => {
        disposed = true;
        network.remove();
        app.remove();
      };
    },
  },
  observe: (app, actions) => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Keyboard.isVisible()) {
        Keyboard.dismiss();

        return true;
      }

      return history.back();
    });

    const links = Linking.addEventListener('url', ({ url }) => {
      if (parseInviteLink(url)) {
        history.setUrl(url);
        void actions.dispatch('showJoinGroup', { link: url }, { origin: 'link' }).then((result) => {
          if (result.status === 'done' && app.snapshot().online)
            void actions.dispatch('checkInvite', { link: url }, { origin: 'link' });
        });
      }
    });

    return () => { back.remove(); links.remove(); };
  },
};
