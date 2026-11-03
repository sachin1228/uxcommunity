import worker from './.open-next/worker.js';
import { withServiceUnavailableFallback } from './lib/service-unavailable';

export * from './.open-next/worker.js';

// Keep the production entry behind a wrapper so a Worker-side crash or an
// empty 503 still renders the branded page instead of the browser's grey one.
const handler = {
  ...worker,
  fetch(request, env, ctx) {
    return withServiceUnavailableFallback(request, () => worker.fetch(request, env, ctx));
  },
};

export default handler;
