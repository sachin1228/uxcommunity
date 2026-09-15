"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BooleanIntentCoalescer } from "@/lib/boolean-intent-coalescer";
import { dedupeFetch, TOGGLE_FETCH_OPTIONS } from "@/lib/dedupe-fetch";

export type EventLikeState = { liked: boolean; like_count: number };
export type EventSaveState = { saved: boolean; save_count: number };

type Options = {
  eventId: string;
  communityId: string;
  liked: boolean;
  likeCount: number;
  saved: boolean;
  saveCount: number;
  onLikeChanged: (eventId: string, liked: boolean, count: number) => void;
  onSaveChanged: (eventId: string, saved: boolean, count: number) => void;
};

async function persistBoolean<T>(url: string, key: "liked" | "saved", desired: boolean) {
  // A settled response must never answer the next click: taps that alternate
  // (save → unsave) each need to reach the server. The coalescer keeps bursts
  // to one in-flight request plus one trailing flush, so replay is not needed.
  const response = await dedupeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: desired }),
  }, TOGGLE_FETCH_OPTIONS);
  const data = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !data) throw new Error(`Unable to update event ${key}`);
  return data;
}

export function useEventInteractions(options: Options) {
  const latestRef = useRef(options);
  // Keep the latest props visible to the coalescer callbacks (which run from
  // event handlers / async settles, always after this effect has flushed).
  useEffect(() => {
    latestRef.current = options;
  });
  const likeCoordinatorRef = useRef<BooleanIntentCoalescer | null>(null);
  const saveCoordinatorRef = useRef<BooleanIntentCoalescer | null>(null);
  // A write is pending while desired !== confirmed (or a request is in flight).
  // The button keeps its label and only shows a small syncing hint, so a slow
  // round trip never hides the state the user just chose.
  const [likePending, setLikePending] = useState(false);
  const [savePending, setSavePending] = useState(false);
  /**
   * The save state the card renders. It follows the coalescer's local intent,
   * so a list refetch that lands while the write is still in flight can't flip
   * the bookmark back to its pre-click state.
   */
  const [savedState, setSavedState] = useState(options.saved);

  useEffect(() => {
    const likeUrl = `/api/communities/${options.communityId}/events/${options.eventId}/like`;
    const saveUrl = `/api/communities/${options.communityId}/events/${options.eventId}/save`;

    const likeCoordinator = new BooleanIntentCoalescer({
      initialValue: options.liked,
      onOptimisticChange: (liked) => {
        const current = latestRef.current;
        const count = Math.max(0, current.likeCount + (liked === current.liked ? 0 : liked ? 1 : -1));
        current.onLikeChanged(current.eventId, liked, count);
      },
      onPendingChange: (pending) => setLikePending(pending),
      persist: async (desired) => {
        const data = await persistBoolean<EventLikeState>(likeUrl, "liked", desired);
        latestRef.current.onLikeChanged(options.eventId, data.liked, data.like_count);
        return data.liked;
      },
    });

    const saveCoordinator = new BooleanIntentCoalescer({
      initialValue: options.saved,
      onOptimisticChange: (saved) => {
        setSavedState(saved);
        const current = latestRef.current;
        const count = Math.max(0, current.saveCount + (saved === current.saved ? 0 : saved ? 1 : -1));
        current.onSaveChanged(current.eventId, saved, count);
      },
      onPendingChange: (pending) => setSavePending(pending),
      persist: async (desired) => {
        const data = await persistBoolean<EventSaveState>(saveUrl, "saved", desired);
        latestRef.current.onSaveChanged(options.eventId, data.saved, data.save_count);
        return data.saved;
      },
    });

    likeCoordinatorRef.current = likeCoordinator;
    saveCoordinatorRef.current = saveCoordinator;
    return () => {
      likeCoordinator.dispose();
      saveCoordinator.dispose();
      likeCoordinatorRef.current = null;
      saveCoordinatorRef.current = null;
    };
  }, [options.communityId, options.eventId]);

  useEffect(() => { likeCoordinatorRef.current?.syncConfirmed(options.liked); }, [options.liked]);

  useEffect(() => {
    const coordinator = saveCoordinatorRef.current;
    if (!coordinator) return;
    // Read `pending` before syncing: while a write is outstanding the local
    // intent stays on screen; once the coalescer was idle the server-backed
    // prop is authoritative again (realtime, another tab).
    const pending = coordinator.isPending();
    coordinator.syncConfirmed(options.saved);
    if (!pending) setSavedState(options.saved);
  }, [options.saved]);

  const toggleLike = useCallback(() => likeCoordinatorRef.current?.toggle(), []);
  const toggleSave = useCallback(() => saveCoordinatorRef.current?.toggle(), []);
  return { toggleLike, toggleSave, likePending, savePending, saved: savedState };
}
