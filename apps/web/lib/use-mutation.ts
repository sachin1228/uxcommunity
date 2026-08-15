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

/**
 * Per-item mutation lock for optimistic toggle buttons (like/save/bookmark/rsvp).
 *
 * Solves the "mash the button 20 times" problem at the UI layer: while an
 * action for a given `id` is running, further clicks for that `id` are dropped
 * synchronously (a ref check, so even two clicks in the same frame can't
 * double-fire), and `isPending` drives the button's `disabled` state.
 *
 *   const { run, isPending } = usePendingActions();
 *   <button disabled={isPending(post.id)} onClick={() => void run(post.id, async () => {
 *     await dedupeFetch(...);   // runs at most once until it settles
 *   })} />
 */
export function usePendingActions() {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef(new Set<string>());

  const run = useCallback(
    async <T,>(id: string, action: () => Promise<T>): Promise<T | undefined> => {
      if (pendingRef.current.has(id)) return undefined;
      pendingRef.current.add(id);
      setPending(new Set(pendingRef.current));
      try {
        return await action();
      } finally {
        pendingRef.current.delete(id);
        setPending(new Set(pendingRef.current));
      }
    },
    [],
  );

  const isPending = useCallback((id: string) => pending.has(id), [pending]);

  return { run, isPending };
}
