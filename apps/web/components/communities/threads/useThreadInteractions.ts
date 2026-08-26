"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BooleanIntentCoalescer } from "@/lib/boolean-intent-coalescer";
import { dedupeFetch } from "@/lib/dedupe-fetch";

type Options = {
  threadId: string;
  communityId: string;
  liked: boolean;
  likeCount: number;
  saved: boolean;
  onLikeChanged: (threadId: string, liked: boolean, count: number) => void;
  onSaveChanged: (threadId: string, saved: boolean) => void;
};

async function persistBoolean(url: string, key: "liked" | "saved", desired: boolean) {
  const response = await dedupeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: desired }),
  }, { cooldownMode: "url" });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) throw new Error(`Unable to update thread ${key}`);
  return data;
}

export function useThreadInteractions(options: Options) {
  const latestRef = useRef(options);
  useEffect(() => {
    latestRef.current = options;
  });

  const likeCoordinatorRef = useRef<BooleanIntentCoalescer | null>(null);
  const saveCoordinatorRef = useRef<BooleanIntentCoalescer | null>(null);
  const [likePending, setLikePending] = useState(false);
  const [savePending, setSavePending] = useState(false);

  useEffect(() => {
    const likeUrl = `/api/communities/${options.communityId}/threads/${options.threadId}/like`;
    const saveUrl = `/api/communities/${options.communityId}/threads/${options.threadId}/save`;

    const likeCoordinator = new BooleanIntentCoalescer({
      initialValue: options.liked,
      onOptimisticChange: (liked) => {
        const current = latestRef.current;
        const count = Math.max(0, current.likeCount + (liked === current.liked ? 0 : liked ? 1 : -1));
        current.onLikeChanged(current.threadId, liked, count);
      },
      onPendingChange: (pending) => setLikePending(pending),
      persist: async (desired) => {
        const data = await persistBoolean(likeUrl, "liked", desired);
        const liked = data.liked as boolean;
        const count = (data.count as number) ?? latestRef.current.likeCount;
        latestRef.current.onLikeChanged(options.threadId, liked, count);
        return liked;
      },
    });

    const saveCoordinator = new BooleanIntentCoalescer({
      initialValue: options.saved,
      onOptimisticChange: (saved) => {
        latestRef.current.onSaveChanged(latestRef.current.threadId, saved);
      },
      onPendingChange: (pending) => setSavePending(pending),
      persist: async (desired) => {
        const data = await persistBoolean(saveUrl, "saved", desired);
        return data.saved as boolean;
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
  }, [options.communityId, options.threadId]);

  useEffect(() => { likeCoordinatorRef.current?.syncConfirmed(options.liked); }, [options.liked]);
  useEffect(() => { saveCoordinatorRef.current?.syncConfirmed(options.saved); }, [options.saved]);

  const toggleLike = useCallback(() => likeCoordinatorRef.current?.toggle(), []);
  const toggleSave = useCallback(() => saveCoordinatorRef.current?.toggle(), []);
  return { toggleLike, toggleSave, likePending, savePending };
}
