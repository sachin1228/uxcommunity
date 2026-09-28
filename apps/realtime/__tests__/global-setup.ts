/**
 * Vitest global setup for the realtime suites.
 *
 * Community sockets are authorized against `API_URL`, and the DO fails CLOSED
 * when it is unset (production-readiness audit, M-8). The local `.dev.vars`
 * leaves `API_URL` blank, so every suite that opens a community socket needs a
 * configured membership API. This starts one stub for the whole run and points
 * `API_URL` at it, restoring `.dev.vars` afterwards.
 *
 * Suites that need a non-member or an outage (the M-8 regression tests in
 * `realtime.integration.test.ts`) still rewrite `API_URL` for their own Worker
 * and restore it here.
 */

import { pointDevVarsAt, startMembershipStub } from "./helpers/membership-stub";

export async function setup(): Promise<() => void> {
  const stub = await startMembershipStub();
  const restoreDevVars = pointDevVarsAt(stub.url);

  return () => {
    restoreDevVars();
    stub.stop();
  };
}
