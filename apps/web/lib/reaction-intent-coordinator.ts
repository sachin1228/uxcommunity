export type ReactionIntent = string | null;

export interface ReactionPersistResult<T> {
  value: ReactionIntent;
  data: T;
}

export interface ReactionIntentCoordinatorOptions<T> {
  initialValue: ReactionIntent;
  persist: (desired: ReactionIntent) => Promise<ReactionPersistResult<T>>;
  onOptimisticChange: (value: ReactionIntent) => void;
  onConfirmed: (result: ReactionPersistResult<T>) => void;
  onError?: (error: unknown) => void;
  onIntentChange?: (value: ReactionIntent, pending: boolean) => void;
  quietWindowMs?: number;
}

/**
 * Coalesces rapid reaction changes into explicit, idempotent writes. A message
 * never has more than one request in flight and stale responses never paint
 * over a newer local choice.
 */
export class ReactionIntentCoordinator<T> {
  private confirmed: ReactionIntent;
  private desired: ReactionIntent;
  private version = 0;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly quietWindowMs: number;

  constructor(private readonly options: ReactionIntentCoordinatorOptions<T>) {
    this.confirmed = options.initialValue;
    this.desired = options.initialValue;
    this.quietWindowMs = options.quietWindowMs ?? 100;
  }

  toggle(emoji: string) {
    this.setDesired(this.desired === emoji ? null : emoji);
  }

  setDesired(value: ReactionIntent) {
    if (this.disposed) return;
    this.desired = value;
    this.version += 1;
    this.options.onOptimisticChange(value);
    this.options.onIntentChange?.(value, true);
    this.schedule(this.quietWindowMs);
  }

  syncConfirmed(value: ReactionIntent) {
    this.confirmed = value;
    if (!this.isPending()) this.desired = value;
  }

  getDesired() {
    return this.desired;
  }

  isPending() {
    return this.inFlight || this.timer !== null || this.desired !== this.confirmed;
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private async flush() {
    if (this.disposed || this.inFlight || this.desired === this.confirmed) {
      if (!this.disposed && !this.isPending()) {
        this.options.onIntentChange?.(this.desired, false);
      }
      return;
    }

    const submittedValue = this.desired;
    const submittedVersion = this.version;
    this.inFlight = true;

    try {
      const result = await this.options.persist(submittedValue);
      this.confirmed = result.value;

      if (this.version === submittedVersion) {
        this.desired = result.value;
        this.options.onConfirmed(result);
      }
    } catch (error) {
      if (this.version === submittedVersion) {
        this.desired = this.confirmed;
        this.options.onOptimisticChange(this.confirmed);
        this.options.onError?.(error);
      }
    } finally {
      this.inFlight = false;
      if (!this.disposed && this.desired !== this.confirmed) {
        this.schedule(0);
      } else if (!this.disposed) {
        this.options.onIntentChange?.(this.desired, false);
      }
    }
  }
}

interface RecentReactionIntent {
  value: ReactionIntent;
  pending: boolean;
  updatedAt: number;
}

const recentReactionIntents = new Map<string, RecentReactionIntent>();
const ECHO_SUPPRESSION_MS = 10_000;

function intentKey(communityId: string, messageId: string, userId: string) {
  return `${communityId}:${messageId}:${userId}`;
}

/** Records local intent so Supabase echoes cannot repaint intermediate states. */
export function trackReactionIntent(
  communityId: string,
  messageId: string,
  userId: string,
  value: ReactionIntent,
  pending: boolean,
) {
  recentReactionIntents.set(intentKey(communityId, messageId, userId), {
    value,
    pending,
    updatedAt: Date.now(),
  });
}

/**
 * Own-user Realtime events are echoes of the HTTP write. Suppress them while a
 * local intent is active and briefly after settlement; the authoritative HTTP
 * response already reconciles the UI.
 */
export function shouldSuppressReactionEcho(
  communityId: string,
  messageId: string,
  userId: string,
) {
  const key = intentKey(communityId, messageId, userId);
  const intent = recentReactionIntents.get(key);
  if (!intent) return false;
  if (intent.pending) return true;
  if (Date.now() - intent.updatedAt <= ECHO_SUPPRESSION_MS) return true;
  recentReactionIntents.delete(key);
  return false;
}

export function clearReactionIntentsForCommunity(communityId: string) {
  const prefix = `${communityId}:`;
  for (const key of recentReactionIntents.keys()) {
    if (key.startsWith(prefix)) recentReactionIntents.delete(key);
  }
}
