import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

// Persist the Next.js data cache (unstable_cache) in R2 instead of falling back
// to per-isolate memory. The home feed (10s revalidate), embedded Lottie
// payloads (1h), and master-data maps are all unstable_cache reads; without a
// shared store every isolate / cold start recomputes or re-fetches them, which
// is the bulk of the 0.8–1.8s wall time on the dashboard data endpoints.
// Requires the NEXT_INC_CACHE_R2_BUCKET binding in wrangler.toml (bucket must
// exist: `wrangler r2 bucket create uxcommunity-web-next-cache`).
export default defineCloudflareConfig({ incrementalCache: r2IncrementalCache });
