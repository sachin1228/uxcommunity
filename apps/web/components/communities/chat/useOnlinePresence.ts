"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useDocumentVisible } from "@/lib/use-document-visible";

/**
 * Tracks how many members are currently online in a community using
 * Supabase Realtime Presence. Each tab tracks itself; the hook returns
 * the total number of distinct online users (including the current user).
 */
export function useOnlinePresence({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const [onlineCount, setOnlineCount] = useState(0);
  const isVisible = useDocumentVisible();

  useEffect(() => {
    if (!isVisible) return;
    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    const channel = supabase.channel(`community-online:${communityId}`, {
      config: { presence: { key: currentUserId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ user_id: string }>();
        // Count distinct user IDs (each key in presenceState is a user slot)
        const distinctUsers = new Set(Object.keys(state));
        setOnlineCount(distinctUsers.size);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ user_id: currentUserId });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [communityId, currentUserId, isVisible]);

  return { onlineCount };
}
