"use client";

import { useEffect, useState } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";

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

    const presenceRoom = realtimeRooms.presence(communityId);
    realtimeClient.init({ id: currentUserId, name: null, avatar: null });
    realtimeClient.subscribe(presenceRoom);
    realtimeClient.connect();

    const unsubPresence = realtimeClient.onPresence(presenceRoom, (users) => {
      setOnlineCount(users.length);
    });

    return () => {
      unsubPresence();
      realtimeClient.unsubscribe(presenceRoom);
    };
  }, [communityId, currentUserId, isVisible]);

  return { onlineCount };
}
