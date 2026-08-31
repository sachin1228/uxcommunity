"use client";

import { useEffect, useRef, MutableRefObject } from "react";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import {
  sidebarStore,
  type CachedSidebarCommunity,
} from "@/lib/communities/cache";
import { shouldSuppressReactionEcho } from "@/lib/reaction-intent-coordinator";
import { noteCommunityActivity, scheduleMarkRead } from "@/lib/communities/read-manager";
import { notifyIncomingCommunityMessage } from "@/lib/communities/message-notifications";

interface Options {
  communities: CachedSidebarCommunity[];
  userId: string;
  activeCommunityIdRef: MutableRefObject<string | undefined>;
  setCommunities: React.Dispatch<React.SetStateAction<CachedSidebarCommunity[]>>;
}

function applyUpdate(
  prev: CachedSidebarCommunity[],
  communityId: string,
  patch: (c: CachedSidebarCommunity) => CachedSidebarCommunity,
): CachedSidebarCommunity[] {
  const updated = prev.map((c) => (c.id === communityId ? patch(c) : c));
  if (sidebarStore.data) {
    const storeById = new Map(sidebarStore.data.communities.map((c) => [c.id, c]));
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: updated.map((c) => ({
        ...c,
        last_read_at: storeById.get(c.id)?.last_read_at ?? c.last_read_at,
      })),
    };
  }
  return updated;
}

export function useSidebarRealtime({
  communities,
  userId,
  activeCommunityIdRef,
  setCommunities,
}: Options) {
  const communityIds = [...communities].map((c) => c.id).sort().join(",");
  const communitiesRef = useRef(communities);
  useEffect(() => { communitiesRef.current = communities; }, [communities]);

  useEffect(() => {
    if (!communities.length) return;

    realtimeClient.init({ id: userId, name: null, avatar: null });
    const unsubscribes: Array<() => void> = [];
    const resolvedNames = new Map<string, string>();
    const joinedCommunityIds = new Set(communities.map((c) => c.id));

    type ReactionRow = { community_id: string; message_id: string; user_id: string; emoji: string; created_at?: string };
    type ReactionMessage = { content?: string | null; image_url?: string | null };

    async function resolveName(commId: string, uid: string): Promise<string | null> {
      if (resolvedNames.has(uid)) return resolvedNames.get(uid)!;
      try {
        const res = await fetch(`/api/communities/${commId}/members/${uid}`);
        if (!res.ok) return null;
        const data = await res.json() as { name?: string };
        if (data?.name) { resolvedNames.set(uid, data.name); return data.name; }
      } catch {}
      return null;
    }

    function reactionPreview(row: ReactionRow, message: ReactionMessage | null): string {
      if (message?.content) return `"${message.content.slice(0, 40)}${message.content.length > 40 ? "…" : ""}"`;
      if (message?.image_url) return "📷 Photo";
      return "a message";
    }

    function applyReaction(row: ReactionRow, message?: ReactionMessage | null) {
      const isOwn = row.user_id === userId;
      setCommunities((prev) =>
        applyUpdate(prev, row.community_id, (c) => {
          if (c.lastReaction?.createdAt && row.created_at && c.lastReaction.createdAt > row.created_at) return c;
          const fallbackMessage = c.last_message?.id === row.message_id ? c.last_message : null;
          return {
            ...c,
            lastReaction: {
              messageId: row.message_id, createdAt: row.created_at, emoji: row.emoji,
              firstName: isOwn ? "You" : (resolvedNames.get(row.user_id)?.split(" ")[0] ?? "Someone"),
              isOwn,
              messagePreview: reactionPreview(row, message ?? (fallbackMessage ? { content: fallbackMessage.content, image_url: fallbackMessage.has_image ? "present" : null } : null)),
            },
          };
        }),
      );
    }

    function fetchAndApplyReaction(row: ReactionRow) {
      const community = sidebarStore.data?.communities.find((item) => item.id === row.community_id);
      const fallbackMessage = community?.last_message?.id === row.message_id
        ? { content: community.last_message.content, image_url: community.last_message.has_image ? "present" : null }
        : null;
      if (fallbackMessage) { applyReaction(row, fallbackMessage); return; }
      fetch(`/api/communities/${row.community_id}/messages/${row.message_id}`)
        .then((res) => (res.ok ? (res.json() as Promise<ReactionMessage>) : null))
        .then((message) => { if (message) applyReaction(row, message); })
        .catch(() => {});
    }

    for (const community of communities) {
      const cid = community.id;
      const chatRoom = realtimeRooms.chat(cid);
      realtimeClient.subscribe(chatRoom);
      realtimeClient.connect(chatRoom);

      unsubscribes.push(
        realtimeClient.on(chatRoom, "message", (data) => {
          const row = data as { id: string; community_id: string; content: string; created_at: string; user_id: string; reply_to_id?: string | null; image_url?: string | null };
          if (!joinedCommunityIds.has(row.community_id)) return;
          const isOwn = row.user_id === userId;
          const isActive = row.community_id === activeCommunityIdRef.current;
          const knownName = resolvedNames.get(row.user_id) ?? null;
          if (!isOwn) {
            if (isActive) {
              scheduleMarkRead(row.community_id, { unreadCount: 1, lastMessageTimestamp: row.created_at, reason: "realtime message" });
            } else {
              const currentEntry = communitiesRef.current.find((c) => c.id === row.community_id);
              noteCommunityActivity(row.community_id, { unreadCount: (currentEntry?.message_count ?? 0) + 1, lastMessageTimestamp: row.created_at });
            }
          }
          setCommunities((prev) =>
            applyUpdate(prev, row.community_id, (c) => ({
              ...c, is_archived: false, lastReaction: null,
              last_message: { id: row.id, content: row.content, created_at: row.created_at, user: knownName ? { name: knownName } : isOwn ? c.last_message?.user ?? null : null, is_own: isOwn, has_image: !row.content && !!row.image_url, is_reply: !!row.reply_to_id, is_deleted: false, reactions: [] },
              message_count: !isOwn && !isActive ? c.message_count + 1 : c.message_count,
            })),
          );
          if (!isOwn) {
            const communityName = communitiesRef.current.find((item) => item.id === row.community_id)?.name ?? "Community chat";
            const senderNamePromise = knownName ? Promise.resolve(knownName) : resolveName(row.community_id, row.user_id);
            void senderNamePromise.then((senderName) => notifyIncomingCommunityMessage(userId, { id: row.id, communityId: row.community_id, communityName, senderId: row.user_id, senderName, content: row.content, hasImage: !!row.image_url, isReply: !!row.reply_to_id }));
          }
          if (!isOwn && !resolvedNames.has(row.user_id)) {
            const commId = row.community_id; const msgAt = row.created_at; const senderId = row.user_id;
            resolveName(commId, senderId).then((name) => {
              if (!name) return;
              setCommunities((prev) => applyUpdate(prev, commId, (c) => { if (c.last_message?.created_at !== msgAt) return c; return { ...c, last_message: { ...c.last_message!, user: { name } } }; }));
            });
          }
          if (row.reply_to_id) {
            const commId = row.community_id; const msgAt = row.created_at; const replyId = row.reply_to_id;
            fetch(`/api/communities/${commId}/messages/${replyId}`).then((r) => (r.ok ? r.json() : null))
              .then((parent: { user_name?: string } | null) => {
                if (!parent?.user_name) return;
                const firstName = parent.user_name.split(" ")[0];
                setCommunities((prev) => applyUpdate(prev, commId, (c) => { if (c.last_message?.created_at !== msgAt) return c; return { ...c, last_message: { ...c.last_message!, reply_to_user: firstName } }; }));
              }).catch(() => {});
          }
        }),
      );

      unsubscribes.push(
        realtimeClient.on(chatRoom, "message-edit", (data) => {
          const updated = data as { community_id: string; created_at: string; content: string };
          if (!joinedCommunityIds.has(updated.community_id)) return;
          setCommunities((prev) => applyUpdate(prev, updated.community_id, (c) => {
            if (c.last_message?.created_at !== updated.created_at) return c;
            return { ...c, last_message: { ...c.last_message!, content: updated.content } };
          }));
        }),
      );

      unsubscribes.push(
        realtimeClient.on(chatRoom, "message-delete", (data) => {
          const updated = data as { community_id: string; created_at: string; deleted_at: string | null };
          if (!joinedCommunityIds.has(updated.community_id) || !updated.deleted_at) return;
          setCommunities((prev) => applyUpdate(prev, updated.community_id, (c) => {
            if (c.last_message?.created_at !== updated.created_at) return c;
            return { ...c, last_message: { ...c.last_message!, content: "", is_deleted: true, has_image: false, is_reply: false } };
          }));
        }),
      );

      unsubscribes.push(
        realtimeClient.on(chatRoom, "reaction-insert", (data) => {
          const r = data as ReactionRow;
          if (!joinedCommunityIds.has(r.community_id)) return;
          if (r.user_id === userId && shouldSuppressReactionEcho(r.community_id, r.message_id, r.user_id)) return;
          fetchAndApplyReaction(r);
          if (r.user_id !== userId && !resolvedNames.has(r.user_id)) {
            const msgId = r.message_id; const rEmoji = r.emoji; const uid = r.user_id; const createdAt = r.created_at;
            resolveName(r.community_id, uid).then((name) => {
              if (!name) return;
              setCommunities((prev) => applyUpdate(prev, r.community_id, (c) => {
                if (!c.lastReaction || c.lastReaction.messageId !== msgId || c.lastReaction.emoji !== rEmoji || c.lastReaction.createdAt !== createdAt) return c;
                return { ...c, lastReaction: { ...c.lastReaction, firstName: name.split(" ")[0] } };
              }));
            });
          }
        }),
      );

      unsubscribes.push(
        realtimeClient.on(chatRoom, "reaction-update", (data) => {
          const r = data as ReactionRow;
          if (!joinedCommunityIds.has(r.community_id)) return;
          if (r.user_id === userId && shouldSuppressReactionEcho(r.community_id, r.message_id, r.user_id)) return;
          fetchAndApplyReaction(r);
        }),
      );

      unsubscribes.push(
        realtimeClient.on(chatRoom, "reaction-delete", (data) => {
          const r = data as { community_id?: string; message_id?: string; user_id?: string; emoji?: string; created_at?: string };
          if (!r.community_id || !joinedCommunityIds.has(r.community_id) || !r.message_id || !r.user_id || !r.emoji) return;
          if (r.user_id === userId && shouldSuppressReactionEcho(r.community_id, r.message_id, r.user_id)) return;
          const reactionId = r.community_id; const reactionMessageId = r.message_id; const reactionEmoji = r.emoji; const reactionCreatedAt = r.created_at;
          setCommunities((prev) => applyUpdate(prev, reactionId, (c) => {
            const current = c.lastReaction;
            if (!current) return c;
            if (current.messageId === reactionMessageId && current.emoji === reactionEmoji && (!current.createdAt || !reactionCreatedAt || current.createdAt === reactionCreatedAt)) return { ...c, lastReaction: null };
            return c;
          }));
        }),
      );

      unsubscribes.push(() => realtimeClient.unsubscribe(chatRoom));
    }

    return () => { unsubscribes.forEach((unsub) => unsub()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityIds, userId]);
}
