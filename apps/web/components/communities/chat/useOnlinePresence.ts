"use client";

import { useEffect, useState } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";

/**
 * Tracks how many members are currently online in a community.
 *
 * NOTE: The new Cloudflare DO architecture does not implement server-side
 * presence tracking for chat rooms. This hook returns the community member
 * count from the database as a fallback. To show true online counts, the
 * Room DO would need to track WebSocket connections and publish
 * presence_delta events.
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
    if (!isVisible || !communityId || !currentUserId) return;

    const chatRoom = realtimeRooms.chat(communityId);
    realtimeClient.init({ id: currentUserId, name: null, avatar: null });

    const unsubRoom = realtimeClient.subscribe(chatRoom);
    realtimeClient.connect();

    const unsubPresence = realtimeClient.onPresence(chatRoom, (users) => {
      setOnlineCount(users.length);
    });

    return () => {
      unsubPresence();
      unsubRoom();
    };
  }, [communityId, currentUserId, isVisible]);

  return { onlineCount };
}
