import worker from './.open-next/worker.js';
import { serveStagingMedia } from './lib/r2-delivery';
export * from './.open-next/worker.js';

// Keep the browser cookie on the staging web host, including its WebSocket.
export default {
  ...worker,
  async fetch(request, env, ctx) {
    if (env.APP_ENV !== 'staging') return new Response('Wrong environment', { status: 503 });
    const url = new URL(request.url);
    if (url.pathname.startsWith('/_media/') || url.pathname.startsWith('/_s3/')) {
      return serveStagingMedia(request, env);
    }
    if (url.pathname.startsWith('/_realtime/')) {
      if (url.pathname !== '/_realtime/ws' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Not found', { status: 404 });
      }
      url.pathname = '/ws';
      return env.REALTIME_SERVICE.fetch(new Request(url, request));
    }
    return worker.fetch(request, env, ctx);
  },
};
