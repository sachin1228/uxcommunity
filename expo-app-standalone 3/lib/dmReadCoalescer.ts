/**
 * Coalesces DM read receipts onto the newest message.
 *
 * A thread marks read on every message state change (cache paint, page merge,
 * send, realtime echo). Without coalescing, three of those in one open became
 * three PATCHes, and the first one could mark a message that was already stale
 * by the time the throttle timer fired. This keeps one trailing read that
 * always uses the newest id seen, while a user open (`force`) bypasses the
 * throttle.
 */

export interface DmReadCoalescerOptions {
  throttleMs: number;
  send: (messageId: string) => void;
  now?: () => number;
  setTimeoutFn?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface DmReadCoalescer {
  request(messageId: string | null | undefined, force?: boolean): void;
  /**
   * Send the pending read now. Leaving the thread (or backgrounding the app)
   * would otherwise drop a trailing read queued inside the throttle window,
   * so the conversation stayed unread after the member had seen the message.
   */
  flush(): void;
  cancel(): void;
}

export function createDmReadCoalescer({
  throttleMs,
  send,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}: DmReadCoalescerOptions): DmReadCoalescer {
  let lastSent: string | null = null;
  let lastSentAt = 0;
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = (force = false) => {
    const messageId = pending;
    pending = null;
    // A forced fire may resend the last position: its PATCH can have failed
    // after it was recorded here, and a foreground/open retry must try again.
    if (!messageId || (!force && messageId === lastSent)) return;
    lastSent = messageId;
    lastSentAt = now();
    send(messageId);
  };

  const cancel = () => {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    pending = null;
  };

  const flush = () => {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    fire();
  };

  return {
    request(messageId, force = false) {
      if (!messageId) return;
      // A forced request is a retry (open, foreground): the previous attempt
      // may have failed after `lastSent` was recorded, so it may resend the
      // same position.
      if (messageId === lastSent && !force) return;
      pending = messageId;
      if (force || now() - lastSentAt > throttleMs) {
        if (timer !== null) {
          clearTimeoutFn(timer);
          timer = null;
        }
        fire(force);
        return;
      }
      if (timer === null) {
        timer = setTimeoutFn(() => {
          timer = null;
          fire();
        }, throttleMs);
      }
    },
    flush,
    cancel,
  };
}
