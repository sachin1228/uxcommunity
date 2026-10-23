/**
 * One bounded follow-up for a token rotation that arrives while a
 * registration is already in flight.
 *
 * The in-flight registration read the old token. If we simply share its
 * promise, the new token waits for the next foreground/launch. This queues
 * exactly one registration after that promise settles, and only while a
 * session still exists. Duplicate rotation events cannot stack.
 */

export interface PushRotationFollowUp {
  schedule(inFlight: Promise<unknown> | null, run: () => void): void;
  isQueued(): boolean;
}

export function createPushRotationFollowUp(
  isSessionCurrent: () => boolean,
): PushRotationFollowUp {
  let queued = false;

  const finish = (run: () => void) => {
    queued = false;
    if (isSessionCurrent()) run();
  };

  return {
    schedule(inFlight, run) {
      if (!inFlight) {
        run();
        return;
      }
      if (queued) return;
      queued = true;
      void inFlight.then(
        () => finish(run),
        () => finish(run),
      );
    },
    isQueued: () => queued,
  };
}
