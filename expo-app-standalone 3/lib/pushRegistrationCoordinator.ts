/**
 * The push-registration state machine.
 *
 * Expo fires a token event whenever the device token is read, so a listener
 * that starts a registration can schedule the next one forever. The original
 * unbounded `POST /api/push/register` loop came from exactly that feedback.
 * This coordinator makes the rules explicit:
 *
 *   - one acquire/post at a time per session epoch (callers share the promise)
 *   - the same Expo+FCM token pair is posted at most once per epoch; a skipped
 *     post is reported through `onAlreadyRegistered` (see its note), so a
 *     caller that recorded "registering" can settle on "registered"
 *   - `reset()` (sign-in/out, account switch) abandons in-flight work: a late
 *     acquire/post from the old account can never be recorded or retried
 *
 * The token acquisition and HTTP POST are injected, so the loop, token
 * rotation and account-switch races run under plain Node.
 */

export interface PushTokenPair {
  token: string;
  fcmToken: string | null;
}

export interface PushRegistrationDependencies {
  /** Reads the current tokens, or null when permission/configuration denies. */
  acquire(): Promise<PushTokenPair | null>;
  /** Posts one token pair for the current session. */
  post(tokens: PushTokenPair): Promise<void>;
  /**
   * Called instead of `post` when this session already posted the same pair.
   *
   * The caller's acquisition step has just reported "registering", and no POST
   * will follow — so without this the recorded state would stay there until
   * the process ends even though the device is registered. Kept out of the
   * coordinator so the state machine stays free of storage and diagnostics;
   * it must not change the outcome of `register()`.
   */
  onAlreadyRegistered?(tokens: PushTokenPair): void | Promise<void>;
}

export interface PushRegistrationCoordinator {
  register(): Promise<string | null>;
  /** Abandons in-flight work and forgets the posted signature. */
  reset(): void;
  /** The registration currently running, if any (logout orders around it). */
  pending(): Promise<string | null> | null;
  isInFlight(): boolean;
  registeredSignature(): string | null;
}

function signatureOf(tokens: PushTokenPair): string {
  return `${tokens.token}|${tokens.fcmToken ?? ''}`;
}

export function createPushRegistrationCoordinator({
  acquire,
  post,
  onAlreadyRegistered,
}: PushRegistrationDependencies): PushRegistrationCoordinator {
  let epoch = 0;
  let inFlight: { epoch: number; promise: Promise<string | null> } | null = null;
  let registered: string | null = null;

  function register(): Promise<string | null> {
    const startedEpoch = epoch;
    if (inFlight && inFlight.epoch === startedEpoch) return inFlight.promise;

    const promise = (async () => {
      const tokens = await acquire();
      // Sign-out / account switch replaced this registration while the token
      // read was in flight.
      if (startedEpoch !== epoch) return null;
      if (!tokens) return null;

      const nextSignature = signatureOf(tokens);
      if (nextSignature !== registered) {
        await post(tokens);
        // Do not remember a post that belongs to the previous account.
        if (startedEpoch !== epoch) return null;
        registered = nextSignature;
      } else {
        await onAlreadyRegistered?.(tokens);
      }
      return tokens.token;
    })().finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });

    inFlight = { epoch: startedEpoch, promise };
    return promise;
  }

  return {
    register,
    reset() {
      epoch += 1;
      inFlight = null;
      registered = null;
    },
    pending: () => inFlight?.promise ?? null,
    isInFlight: () => inFlight !== null,
    registeredSignature: () => registered,
  };
}
