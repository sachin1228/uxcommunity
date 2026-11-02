import worker from './.open-next/worker.js';
import { serveStagingMedia } from './lib/r2-delivery';
import { assertWebEnvironment } from '../../packages/shared/src/environment';
import { timingSafeEqual } from 'node:crypto';
export * from './.open-next/worker.js';

// Keep the browser cookie on the staging web host, including its WebSocket.
export default {
  ...worker,
  async fetch(request, env, ctx) {
    if (env.APP_ENV !== 'staging') return new Response('Wrong environment', { status: 503 });
    const url = new URL(request.url);
    if (url.pathname === '/_isolation/check') {
      const provided = Buffer.from(request.headers.get('Authorization') ?? '');
      const expected = Buffer.from(`Bearer ${env.API_SECRET}`);
      if (!env.API_SECRET || provided.length !== expected.length || !timingSafeEqual(provided, expected)) return new Response('Forbidden', { status: 403 });
      try {
        assertWebEnvironment(env);
        const target = new URL('/rest/v1/users?select=id&email=eq.designer@staging.invalid', env.NEXT_PUBLIC_SUPABASE_URL);
        const response = await fetch(target, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }, redirect: 'manual' });
        const rows = response.ok ? await response.json() : [];
        await worker.fetch(new Request(new URL('/api/healthz', url)), env, ctx);
        return Response.json({ environment: env.APP_ENV, database: target.origin, databaseStatus: response.status, fixtureExists: rows.length === 1,
          runtimeMatches: Object.fromEntries(['APP_ENV','STAGING_ALLOWED_ORIGINS','SUPABASE_SERVICE_ROLE_KEY'].map(key => [key, process.env[key] === env[key]])) });
      } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Isolation check failed' }, { status: 503 }); }
    }
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
