import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["__tests__/**/*.test.ts"],
    // Supplies a local membership API for every suite: the room DO fails closed
    // without one (audit M-8). See __tests__/global-setup.ts.
    globalSetup: ["./__tests__/global-setup.ts"],
    // The perf suites each start their own miniflare instance and hold hundreds
    // of live WebSockets. Running files in parallel (the vitest default) makes
    // every latency number depend on how many other suites happen to be running
    // and multiplies the runner's memory footprint — the 500-socket suites have
    // been observed to OOM the runner when they overlap. Keep them sequential.
    fileParallelism: false,
    // A single shared vitest process retained Miniflare workers, Durable
    // Objects and sockets across files. The 1,000-client test passed alone and
    // with the other scale tests but timed out waiting for `hello` after the
    // earlier suites in the same process — a test-run resource accumulation,
    // not a DO fan-out failure. Forks give each file a clean process while
    // fileParallelism:false keeps the socket-heavy suites sequential.
    pool: "forks",
    isolate: true,
  },
});
