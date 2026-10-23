/**
 * The identity-independent half of session handling: the epoch clock that
 * invalidates late async work, the stale-401 gate, and the two teardown
 * orderings (expiry and explicit logout).
 *
 * Kept free of React and React Native so the race-sensitive branches run
 * under plain Node: a validation that settles after sign-out must not restore
 * the old identity, a late 401 from an old cookie must not clear a new
 * session, and a failed logout request must still clear local state.
 */

export interface SessionEpochClock {
  current(): number;
  advance(): number;
  isCurrent(epoch: number): boolean;
}

export function createSessionEpochClock(): SessionEpochClock {
  let value = 0;
  return {
    current: () => value,
    advance: () => {
      value += 1;
      return value;
    },
    isCurrent: (epoch: number) => epoch === value,
  };
}

/**
 * A 401 only means "this session ended" when the request used the cookie the
 * app still holds. A response from a request sent under the previous account
 * arrives with an old token and must be ignored.
 */
export function isUnauthorizedForCurrentSession(
  usedToken: string | null,
  currentToken: string | null | undefined,
): boolean {
  return currentToken !== undefined && usedToken === currentToken;
}

export interface MemberStateClearSteps {
  clearQueries(): void;
  clearLists(): void;
  resetReads(): void;
  clearSnapshot(): Promise<unknown>;
  clearCaches(): Promise<unknown>;
}

/**
 * Drops everything scoped to the member. Local-storage failures are absorbed:
 * a corrupt cache must never block the sign-out from completing.
 */
export async function clearMemberScopedState(
  steps: MemberStateClearSteps,
): Promise<void> {
  steps.clearQueries();
  steps.clearLists();
  steps.resetReads();
  await Promise.allSettled([steps.clearSnapshot(), steps.clearCaches()]);
}

export interface SignOutSteps extends MemberStateClearSteps {
  invalidateSession(): void;
  resetRealtime(): void;
  markSignedOut(): void;
  clearSession(): Promise<void>;
}

export interface SignOutCoordinator {
  isRunning(): boolean;
  /** Runs once at a time; concurrent 401s share the first teardown. */
  signOut(): Promise<boolean>;
}

export function createSignOutCoordinator(steps: SignOutSteps): SignOutCoordinator {
  let running = false;
  return {
    isRunning: () => running,
    async signOut() {
      if (running) return false;
      running = true;
      try {
        // Gate the identity first so no screen or late response can treat the
        // session as live while the async clears are still running.
        steps.invalidateSession();
        steps.resetRealtime();
        steps.markSignedOut();
        try {
          await steps.clearSession();
        } catch {
          // Local storage can fail; the in-memory session is already gone.
        }
        await clearMemberScopedState(steps);
        return true;
      } finally {
        running = false;
      }
    },
  };
}

export interface LogoutSteps {
  invalidateSession(): void;
  resetRealtime(): void;
  markSignedOut(): void;
  unregisterPush(): Promise<void>;
  logoutRequest(): Promise<void>;
  clearSession(): Promise<void>;
  clearMemberState(): Promise<void>;
}

export interface LogoutTimeouts {
  unregisterPush: number;
  logoutRequest: number;
  clearSession: number;
}

export const LOGOUT_STEP_TIMEOUTS: LogoutTimeouts = {
  unregisterPush: 2_500,
  logoutRequest: 4_000,
  clearSession: 1_500,
};

/**
 * A network or native call that never settles must not hold sign-out (and a
 * quick re-login, which waits for it) forever. Errors are absorbed here; the
 * caller only cares that the step had its chance.
 */
export async function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      promise.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export interface LogoutOptions {
  settle?: (promise: Promise<unknown>, ms: number) => Promise<void>;
  timeouts?: Partial<LogoutTimeouts>;
}

/**
 * Explicit sign-out is local-first and network-best-effort. The push detach
 * and server logout need the cookie, so they run before the clear; neither is
 * allowed to abort the local teardown, and neither can hold it forever.
 */
export async function performLogout(
  steps: LogoutSteps,
  options: LogoutOptions = {},
): Promise<void> {
  const settle = options.settle ?? settleWithin;
  const timeouts = { ...LOGOUT_STEP_TIMEOUTS, ...options.timeouts };

  steps.invalidateSession();
  steps.resetRealtime();
  steps.markSignedOut();

  await settle(steps.unregisterPush(), timeouts.unregisterPush);
  await settle(steps.logoutRequest(), timeouts.logoutRequest);
  await settle(steps.clearSession(), timeouts.clearSession);
  await steps.clearMemberState();
}
