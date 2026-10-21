import app from './app';
import { GroupObject } from './groupObject';
import { debugEnabled } from './routes/debug';
import { createRequestHandler } from 'expo-server/adapter/workerd';

export { GroupObject };

const renderApp = createRequestHandler({ build: './generated/expo-server' });

export default {
  fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> | Response {
    const path = new URL(request.url).pathname;

    const frontend =
      path === '/' ||
      path === '/app' ||
      path === '/app/' ||
      path === '/j' ||
      path === '/j/' ||
      path.startsWith('/join/') ||
      // The component workbench is a development tool.
      ((path === '/components' || path === '/components/') &&
        debugEnabled(env));

    return frontend
      ? renderApp(request, env, context)
      : app.fetch(request, env, context);
  },
};
