/**
 * The recorded push-registration state, and who may move it on.
 *
 * `acquirePushTokenPair` writes "registering" before it asks the OS for a
 * token, because that is the step that can take seconds (or hang). Only the
 * registration that is still current may write a terminal status afterwards:
 * a registration dropped by sign-out or an account switch never posts, so
 * nothing would replace the marker and it would sit on disk — and in the
 * settings screen of the next session — as "registering" forever.
 *
 * Kept pure so the rule itself is testable without Expo or storage.
 */

export interface RecordedPushRegistration {
  /** 'unknown' | 'registering' | 'registered' | 'denied' | 'error' */
  status: string;
  error: string | null;
  checkedAt: number | null;
}

/**
 * Settles the marker an abandoned registration left behind.
 *
 * Returns the state to record, or null when there is nothing to settle. A
 * status that already settled is left alone: it was written by a run that
 * finished, which may well be a newer attempt than the one being dropped.
 * "unknown" is the truthful replacement — this session has not registered yet,
 * and the next registration will say what actually happened.
 */
export function settleAbandonedRegistration<T extends RecordedPushRegistration>(
  state: T,
  now: number,
): T | null {
  if (state.status !== 'registering') return null;
  return {
    ...state,
    status: 'unknown',
    error: null,
    checkedAt: now,
  };
}
