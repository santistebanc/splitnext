import {
  createDeviceSecret,
  deviceSecretSchema,
  IndexedDbClientStorage,
} from '@splitnext/client';
import { reportBrowserErrors } from './errorReports';
import { createAppRuntime } from './runtime';
import type { AppController } from './controller';

const installationKey = 'splitnext.installation.v1';

const lastGroupKey = 'splitnext.last-group.v1';

const lastYouNameKey = 'splitnext.last-you-name.v1';

/** The Worker serving the API: Expo development points elsewhere. */
export function apiBaseUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? window.location.origin;
}

function installationSecret(): string {
  let secret = localStorage.getItem(installationKey);

  if (!secret) {
    secret = createDeviceSecret();
    localStorage.setItem(installationKey, secret);
  }

  if (!deviceSecretSchema.safeParse(secret).success) throw new Error('corrupt_document');

  return secret;
}

export async function createBrowserApp(): Promise<AppController> {
  reportBrowserErrors(apiBaseUrl());

  const secret = await navigator.locks.request(
    'splitnext-installation',
    installationSecret,
  );

  const channel = new BroadcastChannel('splitnext-replicas');

  const controller = createAppRuntime({
    secret,
    storage: new IndexedDbClientStorage({ database_name: 'splitnext-app', document_key: secret }),
    transport: { baseUrl: apiBaseUrl(), fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
    preferences: {
      lastGroup: () => localStorage.getItem(lastGroupKey),
      rememberGroup: (groupId) => {
        if (groupId) localStorage.setItem(lastGroupKey, groupId);
        else localStorage.removeItem(lastGroupKey);
      },
      lastYouName: () => localStorage.getItem(lastYouNameKey),
      rememberYouName: (name) => localStorage.setItem(lastYouNameKey, name),
    },
    notifications: { changed: () => channel.postMessage('replica-changed'), dispose: () => channel.close() },
  });

  channel.onmessage = () => {
    void controller?.readStorage().catch((error) => controller?.reportSyncError(error));
  };

  if (!process.env.EXPO_PUBLIC_API_URL && 'serviceWorker' in navigator) {
    void navigator.serviceWorker
      .register('/service-worker.js', { updateViaCache: 'none' })
      .catch(() => undefined);
  }

  return controller;
}
