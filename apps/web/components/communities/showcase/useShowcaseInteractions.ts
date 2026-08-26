"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BooleanIntentCoalescer } from "@/lib/boolean-intent-coalescer";
import { dedupeFetch } from "@/lib/dedupe-fetch";

type Options = {
  communityId: string;
  postId: string;
  liked: boolean;
  likeCount: number;
  saved: boolean;
  onLikeChanged: (liked: boolean, count: number) => void;
  onSaveChanged: (saved: boolean) => void;
};

type InteractionResponse = {
  active?: boolean;
  count?: number;
  error?: string;
};

export function useShowcaseInteractions(options: Options) {
  const latestRef = useRef(options);
  const likeRef = useRef<BooleanIntentCoalescer | null>(null);
  const saveRef = useRef<BooleanIntentCoalescer | null>(null);
  const [likePending, setLikePending] = useState(false);
  const [savePending, setSavePending] = useState(false);

  useEffect(() => {
    latestRef.current = options;
  });

  useEffect(() => {
    const url = `/api/communities/${options.communityId}/showcase/${options.postId}`;

    const persist = async (action: "like" | "save", active: boolean) => {
      const response = await dedupeFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, active }),
      }, { cooldownMode: "url" });
      const result = (await response.json().catch(() => null)) as InteractionResponse | null;
      if (!response.ok || typeof result?.active !== "boolean") {
        throw new Error(result?.error ?? `Failed to update showcase ${action}.`);
      }
      return result;
    };

    const like = new BooleanIntentCoalescer({
      initialValue: options.liked,
      onOptimisticChange: (liked) => {
        const current = latestRef.current;
        const count = Math.max(0, current.likeCount + (liked === current.liked ? 0 : liked ? 1 : -1));
        current.onLikeChanged(liked, count);
      },
      onPendingChange: setLikePending,
      persist: async (liked) => {
        const result = await persist("like", liked);
        latestRef.current.onLikeChanged(result.active!, result.count ?? latestRef.current.likeCount);
        return result.active!;
      },
    });

    const save = new BooleanIntentCoalescer({
      initialValue: options.saved,
      onOptimisticChange: (saved) => latestRef.current.onSaveChanged(saved),
      onPendingChange: setSavePending,
      persist: async (saved) => (await persist("save", saved)).active!,
    });

    likeRef.current = like;
    saveRef.current = save;
    return () => {
      like.dispose();
      save.dispose();
      likeRef.current = null;
      saveRef.current = null;
    };
  }, [options.communityId, options.postId]);

  useEffect(() => likeRef.current?.syncConfirmed(options.liked), [options.liked]);
  useEffect(() => saveRef.current?.syncConfirmed(options.saved), [options.saved]);

  const toggleLike = useCallback(() => likeRef.current?.toggle(), []);
  const toggleSave = useCallback(() => saveRef.current?.toggle(), []);
  return { toggleLike, toggleSave, likePending, savePending };
}
