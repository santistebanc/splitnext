import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AppController } from '../model/controller';
import { createDispatcher } from '../model/actions';
import { browserActionPlatform } from '../ui/browserPlatform';
import { createWorkbenchApp, type FakeAppOptions } from './app';

export type { FakeApp, FakeAppOptions } from './app';

const noSubscription = () => () => undefined;

const noSnapshot = () => null;

export function useFakeApp(options: FakeAppOptions): AppController | null {
  const [app, setApp] = useState<AppController | null>(null);

  useEffect(() => {
    let disposed = false;
    let current: AppController | null = null;

    void createWorkbenchApp(options).then((created) => {
      current = created;

      if (disposed) created.dispose();
      else setApp(created);
    }).catch((cause) => options.log('Fixture failed', cause instanceof Error ? cause.message : 'fixture_failed'));

    return () => {
      disposed = true;
      current?.dispose();
    };
  }, []);

  useSyncExternalStore(app?.subscribe ?? noSubscription, app?.snapshot ?? noSnapshot, noSnapshot);

  return app;
}

export function useFakeDispatcher(app: AppController | null) {
  return useMemo(() => app ? createDispatcher(app, browserActionPlatform()) : null, [app]);
}
