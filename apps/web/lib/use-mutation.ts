"use client";

/**
 * Reusable mutation loading pattern.
 *
 * Wraps any async mutation so that:
 *
 *   - Only one invocation runs at a time — concurrent calls are swallowed and
 *     join nothing (the first call owns the request).
 *   - `pending` flips true while the mutation runs and back to false when it
 *     settles — including on failure — so buttons can render a spinner and a
 *     `disabled` state, and the user can retry right after an error.
 *   - The in-flight promise is shared with concurrent callers, so multiple
 *     handlers can await the same result.
 */
import { useCallback, useRef, useState } from "react";

export interface PendingMutation<Args extends unknown[], Result> {
  /** True while a mutation is running. Use for spinner + `disabled`. */
  pending: boolean;
  /**
   * Runs the mutation. Concurrent calls while one is in flight receive the
   * same promise (they do not start a second request).
   */
  run: (...args: Args) => Promise<Result>;
}

export function usePendingMutation<Args extends unknown[], Result>(
  mutation: (...args: Args) => Promise<Result>,
): PendingMutation<Args, Result> {
  const [pending, setPending] = useState(false);
  const inFlightRef = useRef<Promise<Result> | null>(null);

  const run = useCallback(
    (...args: Args): Promise<Result> => {
      if (inFlightRef.current) return inFlightRef.current;
      const promise = mutation(...args);
      inFlightRef.current = promise;
      setPending(true);
      void promise
        .finally(() => {
          inFlightRef.current = null;
          setPending(false);
        })
        .catch(() => undefined);
      return promise;
    },
    [mutation],
  );

  return { pending, run };
}
