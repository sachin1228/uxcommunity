import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Optional: enable Next.js data cache in an R2 bucket by adding an
// r2_buckets binding named NEXT_INC_CACHE_R2_BUCKET in wrangler.toml and:
//   import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
//   defineCloudflareConfig({ incrementalCache: r2IncrementalCache })
export default defineCloudflareConfig({});