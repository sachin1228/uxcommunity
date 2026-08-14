"use client";

import { useCallback, useEffect, useRef } from "react";
import { BooleanIntentCoalescer } from "@/lib/boolean-intent-coalescer";
import { dedupeFetch } from "@/lib/dedupe-fetch";

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
  const response = await dedupeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: desired }),
  });
  const data = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !data) throw new Error(`Unable to update event ${key}`);
  return data;
}

export function useEventInteractions(options: Options) {
  const latestRef = useRef(options);
  latestRef.current = options;
  const likeCoordinatorRef = useRef<BooleanIntentCoalescer | null>(null);
  const saveCoordinatorRef = useRef<BooleanIntentCoalescer | null>(null);

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
      persist: async (desired) => {
        const data = await persistBoolean<EventLikeState>(likeUrl, "liked", desired);
        latestRef.current.onLikeChanged(options.eventId, data.liked, data.like_count);
        return data.liked;
      },
    });

    const saveCoordinator = new BooleanIntentCoalescer({
      initialValue: options.saved,
      onOptimisticChange: (saved) => {
        const current = latestRef.current;
        const count = Math.max(0, current.saveCount + (saved === current.saved ? 0 : saved ? 1 : -1));
        current.onSaveChanged(current.eventId, saved, count);
      },
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
  useEffect(() => { saveCoordinatorRef.current?.syncConfirmed(options.saved); }, [options.saved]);

  const toggleLike = useCallback(() => likeCoordinatorRef.current?.toggle(), []);
  const toggleSave = useCallback(() => saveCoordinatorRef.current?.toggle(), []);
  return { toggleLike, toggleSave };
}
