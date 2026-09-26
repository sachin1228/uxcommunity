import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["__tests__/**/*.test.ts"],
    // The perf suites each start their own miniflare instance and hold hundreds
    // of live WebSockets. Running files in parallel (the vitest default) makes
    // every latency number depend on how many other suites happen to be running
    // and multiplies the runner's memory footprint — the 500-socket suites have
    // been observed to OOM the runner when they overlap. Keep them sequential.
    fileParallelism: false,
  },
});
