export interface BooleanIntentCoalescerOptions {
  initialValue: boolean;
  persist: (desired: boolean) => Promise<boolean>;
  onOptimisticChange: (value: boolean) => void;
  onError?: (error: unknown) => void;
  quietWindowMs?: number;
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

    // Start the first write immediately. Deferring it to a quiet-window timer
    // allowed an optimistic parent update to replace this card and dispose the
    // coalescer before persist() (and therefore fetch()) ever ran. While a
    // request is in flight, subsequent taps are still coalesced and flushed
    // after the quiet window.
    if (this.inFlight) {
      this.schedule(this.quietWindowMs);
    } else {
      void this.flush();
    }
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
