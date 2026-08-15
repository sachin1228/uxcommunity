"use client";

import { useEffect, useState } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { RealtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";

/**
 * Tracks how many members are currently online in a community using the
 * Cloudflare realtime presence snapshot. Each tab joins the room; the hook
 * returns the number of distinct online users (including the current user).
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
    const client = new RealtimeClient({
      room: realtimeRooms.presence(communityId),
      user: { id: currentUserId, name: null, avatar: null },
    });

    const unsubPresence = client.onPresence((users) => {
      setOnlineCount(users.length);
    });

    client.connect();

    return () => {
      unsubPresence();
      client.close();
    };
  }, [communityId, currentUserId, isVisible]);

  return { onlineCount };
}