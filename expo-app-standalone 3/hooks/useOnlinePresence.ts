/**
 * Tracks how many members are currently online in a community — the React
 * Native port of the web useOnlinePresence.
 *
 * The Community Durable Object broadcasts the online-member count whenever it
 * changes, folding a member's multiple tabs/devices into one online user, so
 * this is a count of members, not sockets. The chat screen already holds the
 * socket; this hook only adds the presence handler (refcounted like every
 * other room subscription, so leaving the screen releases just its own).
 */

import { useEffect, useState } from 'react';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';

export function useOnlinePresence({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const [onlineCount, setOnlineCount] = useState(0);

  useEffect(() => {
    if (!communityId || !currentUserId) return;

    const room = realtimeRooms.chat(communityId);
    realtimeClient.init({ id: currentUserId, name: null, avatar: null });
    const unsubRoom = realtimeClient.subscribe(room);
    const unsubPresence = realtimeClient.onPresence(room, ({ count }) => {
      setOnlineCount(count);
    });
    realtimeClient.connect(room);

    return () => {
      unsubPresence();
      unsubRoom();
    };
  }, [communityId, currentUserId]);

  return { onlineCount };
}
