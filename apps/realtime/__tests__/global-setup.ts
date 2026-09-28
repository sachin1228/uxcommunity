/**
 * Vitest global setup for the realtime suites.
 *
 * Community sockets are authorized against `API_URL`, and the DO fails CLOSED
 * when it is unusable (production-readiness audit, M-8). This starts one
 * membership stub for the whole run and points `API_URL` at it, then puts
 * `.dev.vars` back — including when the run is killed instead of finishing,
 * since a leftover stub URL refuses every community socket in local dev.
 *
 * Suites that need a non-member or an outage (the M-8 regression tests in
 * `realtime.integration.test.ts`) still rewrite `API_URL` for their own Worker.
 */

import {
  pointDevVarsAt,
  restoreDevVarsFromBackup,
  startMembershipStub,
} from "./helpers/membership-stub";

export async function setup(): Promise<() => void> {
  // A run killed before its teardown left the recovery copy behind: put the
  // developer's `.dev.vars` back before starting anything.
  restoreDevVarsFromBackup();

  const stub = await startMembershipStub();
  const restoreDevVars = pointDevVarsAt(stub.url);

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    restoreDevVars();
    stub.stop();
  };

  // The teardown returned below runs only when the suite finishes by itself.
  // A killed run (Ctrl-C, `timeout`, a stopped task) exits through a signal
  // instead, and would otherwise leave `API_URL` aimed at a port that is gone.
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
    process.once(signal, () => {
      cleanup();
      process.exit(code);
    });
  }
  process.once("exit", cleanup);

  return cleanup;
}
