import {
  IndexedDbClientStorage,
  SplitnextClient,
  SplitnextSyncClient,
} from '@splitnext/client';
import { AppController } from './controller';

const installationKey = 'splitnext.installation.v1';

const lastGroupKey = 'splitnext.last-group.v1';

const lastYouNameKey = 'splitnext.last-you-name.v1';

function installationSecret(): string {
  let secret = localStorage.getItem(installationKey);

  if (!secret) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));

    secret = btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    localStorage.setItem(installationKey, secret);
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('corrupt_document');

  return secret;
}

export async function createBrowserApp(): Promise<AppController> {
  const secret = await navigator.locks.request(
    'splitnext-installation',
    installationSecret,
  );

  const channel = new BroadcastChannel('splitnext-replicas');

  let controller: AppController | null = null;

  const api = new SplitnextClient({
    baseUrl: process.env.EXPO_PUBLIC_API_URL ?? window.location.origin,
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
    observer: (event) => {
      if (event.kind === 'network_error') controller?.setReachable(false);

      if (event.kind === 'response') controller?.setReachable(true);
    },
  });

  const client = new SplitnextSyncClient({
    api,
    device_secret: secret,
    storage: new IndexedDbClientStorage({
      database_name: 'splitnext-app',
      document_key: secret,
    }),
    on_background_sync: (state) => {
      void controller?.receive(state);
    },
    on_presence_change: (groupId) => controller?.presenceChanged(groupId),
  });

  controller = new AppController(
    client,
    {
      lastGroup: () => localStorage.getItem(lastGroupKey),
      rememberGroup: (groupId) => {
        if (groupId) localStorage.setItem(lastGroupKey, groupId);
        else localStorage.removeItem(lastGroupKey);
      },
      lastYouName: () => localStorage.getItem(lastYouNameKey),
      rememberYouName: (name) => localStorage.setItem(lastYouNameKey, name),
    },
    {
      changed: () => channel.postMessage('replica-changed'),
      dispose: () => channel.close(),
    },
  );

  channel.onmessage = () => {
    void controller?.readStorage().catch(() => undefined);
  };

  if (!process.env.EXPO_PUBLIC_API_URL && 'serviceWorker' in navigator) {
    void navigator.serviceWorker
      .register('/service-worker.js', { updateViaCache: 'none' })
      .catch(() => undefined);
  }

  return controller;
}
