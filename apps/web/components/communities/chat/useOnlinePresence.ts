"use client";

import { useEffect, useState } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";

/**
 * Tracks how many members are currently online in a community.
 *
 * The Community Durable Object broadcasts the online-member count whenever it
 * changes. Multiple tabs/devices belonging to the same member are folded into
 * one online user by the server, so this is a count of members, not sockets.
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
    const unsubPresence = realtimeClient.onPresence(chatRoom, ({ count }) => {
      setOnlineCount(count);
    });

    realtimeClient.connect();

    return () => {
      unsubPresence();
      unsubRoom();
    };
  }, [communityId, currentUserId, isVisible]);

  return { onlineCount };
}
