import { useEffect, useMemo, useRef } from 'react';
import { createCatchUpScheduler } from '@/lib/realtimeCatchUp';
import { parseThreadPollEvent, type ThreadPollEvent } from '@/lib/feedPollRealtime';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';

/**
 * Live thread-poll tallies for the mixed feeds (home, own profile, a member's
 * profile).
 *
 * Those screens keep their own card arrays instead of a React Query cache, so
 * they cannot refetch the way the community tab does. This hook subscribes to
 * the `poll` topic of each visible community's `threads:` room and hands every
 * valid event to the caller, which patches the row in place.
 *
 * Only communities that currently have a poll-bearing thread are subscribed:
 * a feed of plain posts needs no sockets at all.
 *
 * A socket that comes up for the first time has missed nothing, so no catch-up
 * is requested. A *re*-connect has missed everything published while it was
 * down; `onGap` asks the screen to settle the feed from the API, debounced so a
 * burst of reconnects produces one refetch.
 */
export function useThreadPollRealtime({
  communityIds,
  onEvent,
  onGap,
  enabled = true,
}: {
  /** Communities whose threads rooms to listen to (see `feedPollCommunityIds`). */
  communityIds: string[];
  onEvent: (event: ThreadPollEvent) => void;
  /** Called when a previously-connected room reconnects. */
  onGap?: () => void;
  enabled?: boolean;
}) {
  // Callbacks change identity on most renders (they close over screen state);
  // keeping them in refs means the subscription effect only tracks the rooms.
  const eventRef = useRef(onEvent);
  const gapRef = useRef(onGap);
  useEffect(() => {
    eventRef.current = onEvent;
    gapRef.current = onGap;
  });

  const roomsKey = useMemo(
    () => [...new Set(communityIds)].filter(Boolean).sort().join('|'),
    [communityIds],
  );

  const gapRefetch = useMemo(
    () => createCatchUpScheduler(() => gapRef.current?.(), { debounceMs: 500 }),
    [],
  );
  useEffect(() => () => gapRefetch.cancel(), [gapRefetch]);

  /** Rooms this hook has already seen open once. */
  const seenRooms = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || !roomsKey) return;
    const cleanups: Array<() => void> = [];

    for (const communityId of roomsKey.split('|')) {
      const room = realtimeRooms.threads(communityId);
      realtimeClient.connect(room);
      cleanups.push(realtimeClient.subscribe(room));
      cleanups.push(
        realtimeClient.on(room, 'poll', (data) => {
          const event = parseThreadPollEvent(data);
          if (event) eventRef.current(event);
        }),
      );
      cleanups.push(
        realtimeClient.onRoomStatus(room, (connected) => {
          if (!connected) return;
          // The first open is the baseline, not a gap.
          if (seenRooms.current.has(room)) gapRefetch.schedule();
          else seenRooms.current.add(room);
        }),
      );
    }

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [enabled, roomsKey, gapRefetch]);
}
