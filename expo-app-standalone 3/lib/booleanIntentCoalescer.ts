export interface BooleanIntentCoalescerOptions {
  initialValue: boolean;
  persist: (desired: boolean) => Promise<boolean>;
  onOptimisticChange: (value: boolean) => void;
  onError?: (error: unknown) => void;
  quietWindowMs?: number;
}

/**
 * Keep the overrides whose write is still on its way to the server.
 *
 * A list refetch or a realtime snapshot can land between the tap and the POST
 * response. That snapshot predates the write, so dropping the optimistic state
 * would flash the old heart and count until the response lands. Confirmed and
 * rolled-back overrides are dropped as before — only an intent that has not
 * settled survives the reset.
 */
export function retainPendingOverrides<T>(
  overrides: Record<string, T>,
  isPending: (key: string) => boolean,
): Record<string, T> {
  let dropped = false;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (isPending(key)) next[key] = value;
    else dropped = true;
  }
  return dropped ? next : overrides;
}

/**
 * Coalesces rapid boolean interactions into idempotent, explicit desired-state writes.
 * There is never more than one request in flight, and stale responses cannot replace
 * a newer local intent.
 */
export class BooleanIntentCoalescer {
  private confirmed: boolean;
  private desired: boolean;
  private version = 0;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly quietWindowMs: number;

  constructor(private readonly options: BooleanIntentCoalescerOptions) {
    this.confirmed = options.initialValue;
    this.desired = options.initialValue;
    this.quietWindowMs = options.quietWindowMs ?? 120;
  }

  toggle() {
    this.setDesired(!this.desired);
  }

  setDesired(value: boolean) {
    if (this.disposed) return;
    this.desired = value;
    this.version += 1;
    this.options.onOptimisticChange(value);
    this.schedule(this.quietWindowMs);
  }

  syncConfirmed(value: boolean) {
    this.confirmed = value;
    if (!this.isPending()) this.desired = value;
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
    if (this.disposed || this.inFlight || this.desired === this.confirmed) return;

    const submittedValue = this.desired;
    const submittedVersion = this.version;
    this.inFlight = true;

    try {
      const authoritativeValue = await this.options.persist(submittedValue);
      this.confirmed = authoritativeValue;

      if (this.version === submittedVersion) {
        this.desired = authoritativeValue;
        this.options.onOptimisticChange(authoritativeValue);
      }
    } catch (error) {
      if (this.version === submittedVersion) {
        this.desired = this.confirmed;
        this.options.onOptimisticChange(this.confirmed);
        this.options.onError?.(error);
      }
    } finally {
      this.inFlight = false;
      if (!this.disposed && this.desired !== this.confirmed) this.schedule(0);
    }
  }
}
