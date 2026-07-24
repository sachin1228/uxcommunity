"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { CachedSidebarCommunity } from "@/lib/communities/cache";

const TYPING_EXPIRY_MS = 3500;

/**
 * Subscribes to the same `community-typing:<id>` broadcast channels used by
 * CommunityChat's useTypingPresence, but across ALL joined communities at once.
 *
 * Returns a Map<communityId, displayText> so the sidebar can show
 * "John is typing…" in place of the last-message preview for any community
 * where someone is actively typing.
 *
 * Read-only — this hook never broadcasts (the active chat's useTypingPresence
 * handles broadcasting for the current user).
 */
export function useSidebarTyping({
  communities,
  userId,
}: {
  communities: CachedSidebarCommunity[];
  userId: string;
}): Map<string, string> {
  const [typingMap, setTypingMap] = useState<Map<string, string>>(new Map());

  // communityId → ( senderId → { name, lastSeen } )
  const stateRef = useRef<Map<string, Map<string, { name: string; lastSeen: number }>>>(
    new Map(),
  );

  const communityIds = [...communities].map((c) => c.id).sort().join(",");

  useEffect(() => {
    if (!communityIds) return;

    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    stateRef.current.clear();

    /** Expire stale entries and push the updated map into React state. */
    const flush = () => {
      const now = Date.now();
      stateRef.current.forEach((userMap, commId) => {
        for (const [uid, entry] of userMap.entries()) {
          if (now - entry.lastSeen > TYPING_EXPIRY_MS) userMap.delete(uid);
        }
        if (userMap.size === 0) stateRef.current.delete(commId);
      });

      const next = new Map<string, string>();
      stateRef.current.forEach((userMap, commId) => {
        const names = [...userMap.values()].map((e) => e.name);
        if (!names.length) return;
        const text =
          names.length === 1
            ? `${names[0]} is typing…`
            : names.length === 2
            ? `${names[0]} & ${names[1]} are typing…`
            : "Several people are typing…";
        next.set(commId, text);
      });
      setTypingMap(next);
    };

    const channels = communities.map((comm) =>
      supabase
        .channel(`community-typing:${comm.id}`, {
          config: { broadcast: { ack: false, self: false } },
        })
        .on(
          "broadcast",
          { event: "typing" },
          ({ payload }: { payload: Record<string, unknown> }) => {
            const senderId =
              typeof payload?.user_id === "string" ? payload.user_id : "";
            const name =
              typeof payload?.name === "string" ? payload.name : "Someone";
            const typing  = payload?.typing === true;
            const ts      =
              typeof payload?.ts === "number" ? payload.ts : Date.now();

            // Ignore our own broadcasts and malformed payloads.
            if (!senderId || senderId === userId) return;

            let userMap = stateRef.current.get(comm.id);
            if (!userMap) {
              userMap = new Map();
              stateRef.current.set(comm.id, userMap);
            }

            if (typing) {
              userMap.set(senderId, { name, lastSeen: ts });
            } else {
              userMap.delete(senderId);
              if (userMap.size === 0) stateRef.current.delete(comm.id);
            }

            flush();
          },
        )
        .subscribe(),
    );

    // Sweep every second to expire anyone who closed their tab silently.
    const timer = window.setInterval(flush, 1000);

    return () => {
      window.clearInterval(timer);
      stateRef.current.clear();
      channels.forEach((ch) => supabase.removeChannel(ch));
      setTypingMap(new Map());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityIds, userId]);

  return typingMap;
}
