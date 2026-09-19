"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BooleanIntentCoalescer } from "@/lib/boolean-intent-coalescer";
import { dedupeFetch, TOGGLE_FETCH_OPTIONS } from "@/lib/dedupe-fetch";

type Options = {
  slug: string;
  entryId: string;
  voted: boolean;
  voteCount: number;
  bookmarked: boolean;
  /** Voting is server-closed outside the cycle's window; the button goes quiet. */
  votingOpen?: boolean;
  /** Optional hooks for a parent that keeps its own list state. */
  onVoteChanged?: (voted: boolean, count: number) => void;
  onBookmarkChanged?: (bookmarked: boolean) => void;
};

type VoteResponse = { active?: boolean; count?: number; error?: string };

/**
 * Vote + bookmark for one competition entry.
 *
 * Both are toggles, so they reuse the app's `BooleanIntentCoalescer` (the same
 * one showcase likes and saves use): rapid clicks collapse into a single
 * request, stale responses can never replace newer intent, and the optimistic
 * change rolls back if the write fails.
 *
 * Nothing here decides a rule. The deadline, the one-vote-per-entry limit and
 * the self-vote ban are all enforced by the API and the database — this hook
 * only shows the server's number and surfaces its error message verbatim.
 */
export function useEntryInteractions(options: Options) {
  const latestRef = useRef(options);
  const voteRef = useRef<BooleanIntentCoalescer | null>(null);
  const bookmarkRef = useRef<BooleanIntentCoalescer | null>(null);
  const voteCountRef = useRef(options.voteCount);
  const [voted, setVoted] = useState(options.voted);
  const [voteCount, setVoteCount] = useState(options.voteCount);
  const [bookmarked, setBookmarked] = useState(options.bookmarked);
  const [votePending, setVotePending] = useState(false);
  const [bookmarkPending, setBookmarkPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    latestRef.current = options;
  });

  useEffect(() => {
    const base = `/api/competitions/${options.slug}/entries/${options.entryId}`;

    const vote = new BooleanIntentCoalescer({
      initialValue: options.voted,
      onOptimisticChange: (nextVoted) => {
        const current = latestRef.current;
        const delta = nextVoted === current.voted ? 0 : nextVoted ? 1 : -1;
        const next = Math.max(0, voteCountRef.current + delta);
        voteCountRef.current = next;
        setVoted(nextVoted);
        setVoteCount(next);
        current.onVoteChanged?.(nextVoted, next);
      },
      onPendingChange: setVotePending,
      persist: async (nextVoted) => {
        const response = await dedupeFetch(
          `${base}/vote`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: nextVoted }),
          },
          TOGGLE_FETCH_OPTIONS,
        );
        const result = (await response.json().catch(() => null)) as VoteResponse | null;

        if (!response.ok || typeof result?.active !== "boolean") {
          // The server's reason (deadline passed, self-vote, rate limited) is
          // the useful message here, so it is shown as-is.
          setError(result?.error ?? "Failed to record your vote.");
          throw new Error(result?.error ?? "Failed to record your vote.");
        }

        setError(null);
        const count = typeof result.count === "number" ? result.count : voteCountRef.current;
        voteCountRef.current = count;
        setVoteCount(count);
        latestRef.current.onVoteChanged?.(result.active, count);
        return result.active;
      },
    });

    const bookmark = new BooleanIntentCoalescer({
      initialValue: options.bookmarked,
      onOptimisticChange: (nextSaved) => {
        setBookmarked(nextSaved);
        latestRef.current.onBookmarkChanged?.(nextSaved);
      },
      onPendingChange: setBookmarkPending,
      persist: async (nextSaved) => {
        const response = await dedupeFetch(
          `${base}/bookmark`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: nextSaved }),
          },
          TOGGLE_FETCH_OPTIONS,
        );
        const result = (await response.json().catch(() => null)) as { active?: boolean } | null;
        if (!response.ok || typeof result?.active !== "boolean") throw new Error("save failed");
        return result.active;
      },
    });

    voteRef.current = vote;
    bookmarkRef.current = bookmark;
    return () => {
      vote.dispose();
      bookmark.dispose();
      voteRef.current = null;
      bookmarkRef.current = null;
    };
    // Intentionally keyed to the target only: rebuilding the coalescers on
    // every vote/bookmark change would cancel in-flight requests. The latest
    // props are read through `latestRef` instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.slug, options.entryId]);

  // Re-sync when the server-rendered value changes (a refetch, another tab, or
  // realtime). While a write is outstanding the local intent keeps the screen
  // stable, exactly like `syncConfirmed` documents.
  useEffect(() => voteRef.current?.syncConfirmed(options.voted), [options.voted]);

  useEffect(() => {
    if (!voteRef.current?.isPending()) {
      voteCountRef.current = options.voteCount;
      setVoteCount(options.voteCount);
    }
  }, [options.voteCount]);

  useEffect(() => {
    const coordinator = bookmarkRef.current;
    if (!coordinator) return;
    const pending = coordinator.isPending();
    coordinator.syncConfirmed(options.bookmarked);
    if (!pending) setBookmarked(options.bookmarked);
  }, [options.bookmarked]);

  const toggleVote = useCallback(() => {
    if (!latestRef.current.votingOpen) return;
    voteRef.current?.toggle();
  }, []);

  const toggleBookmark = useCallback(() => bookmarkRef.current?.toggle(), []);

  return {
    voted,
    voteCount,
    bookmarked,
    toggleVote,
    toggleBookmark,
    votePending,
    bookmarkPending,
    error,
  };
}
