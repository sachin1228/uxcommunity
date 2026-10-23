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

  const fire = () => {
    const messageId = pending;
    pending = null;
    if (!messageId || messageId === lastSent) return;
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

  return {
    request(messageId, force = false) {
      if (!messageId || messageId === lastSent) return;
      pending = messageId;
      if (force || now() - lastSentAt > throttleMs) {
        if (timer !== null) {
          clearTimeoutFn(timer);
          timer = null;
        }
        fire();
        return;
      }
      if (timer === null) {
        timer = setTimeoutFn(() => {
          timer = null;
          fire();
        }, throttleMs);
      }
    },
    cancel,
  };
}
