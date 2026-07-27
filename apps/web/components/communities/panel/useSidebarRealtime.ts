"use client";

import { useEffect, MutableRefObject } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { sidebarStore, type CachedSidebarCommunity } from "@/lib/communities/cache";

interface Options {
  communities: CachedSidebarCommunity[];
  userId: string;
  activeCommunityIdRef: MutableRefObject<string | undefined>;
  setCommunities: React.Dispatch<React.SetStateAction<CachedSidebarCommunity[]>>;
}

/**
 * Applies a patch to one community in React state and mirrors it into
 * sidebarStore, preserving last_read_at from the store.
 */
function applyUpdate(
  prev: CachedSidebarCommunity[],
  communityId: string,
  patch: (c: CachedSidebarCommunity) => CachedSidebarCommunity,
): CachedSidebarCommunity[] {
  const updated = prev.map((c) => (c.id === communityId ? patch(c) : c));
  if (sidebarStore.data) {
    const storeById = new Map(
      sidebarStore.data.communities.map((c) => [c.id, c]),
    );
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

/**
 * Subscribes to community_messages + message_reactions changes for every
 * joined community and keeps the sidebar preview in sync.
 *
 * Handles:
 *  - New messages (text, image-only, replies)  → updates last_message, clears lastReaction
 *  - Soft-deleted messages                     → marks last_message as deleted
 *  - Reaction INSERT                           → sets lastReaction (descriptive preview)
 *  - Reaction DELETE                           → clears lastReaction if it matched
 */
export function useSidebarRealtime({
  communities,
  userId,
  activeCommunityIdRef,
  setCommunities,
}: Options) {
  const communityIds = [...communities].map((c) => c.id).sort().join(",");

  useEffect(() => {
    if (!communities.length) return;

    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    // Cache resolved sender names for the lifetime of this subscription.
    const resolvedNames = new Map<string, string>();

    type ReactionRow = {
      community_id: string;
      message_id: string;
      user_id: string;
      emoji: string;
      created_at?: string;
    };

    type ReactionMessage = {
      content?: string | null;
      image_url?: string | null;
    };

    /** Fetch a member's profile and cache their name. */
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

    function reactionPreview(
      row: ReactionRow,
      message: ReactionMessage | null,
    ): string {
      if (message?.content) {
        return `"${message.content.slice(0, 40)}${message.content.length > 40 ? "…" : ""}"`;
      }
      if (message?.image_url) return "📷 Photo";
      return "a message";
    }

    function applyReaction(
      row: ReactionRow,
      message?: ReactionMessage | null,
    ) {
      const isOwn = row.user_id === userId;

      setCommunities((prev) =>
        applyUpdate(prev, row.community_id, (c) => {
          // Realtime can deliver events out of order. Keep the newest reaction
          // preview instead of allowing a delayed lookup to overwrite it.
          if (
            c.lastReaction?.createdAt &&
            row.created_at &&
            c.lastReaction.createdAt > row.created_at
          ) {
            return c;
          }

          const fallbackMessage =
            c.last_message?.id === row.message_id ? c.last_message : null;

          return {
            ...c,
            lastReaction: {
              messageId: row.message_id,
              createdAt: row.created_at,
              emoji: row.emoji,
              firstName: isOwn
                ? "You"
                : (resolvedNames.get(row.user_id)?.split(" ")[0] ?? "Someone"),
              isOwn,
              messagePreview: reactionPreview(
                row,
                message ??
                  (fallbackMessage
                    ? {
                        content: fallbackMessage.content,
                        image_url: fallbackMessage.has_image ? "present" : null,
                      }
                    : null),
              ),
            },
          };
        }),
      );
    }

    function fetchAndApplyReaction(row: ReactionRow) {
      applyReaction(row);

      // The reacted message may not be the community's last message. Fetch it
      // so reactions on older messages still have the correct sidebar snippet.
      fetch(`/api/communities/${row.community_id}/messages/${row.message_id}`)
        .then((res) => (res.ok ? (res.json() as Promise<ReactionMessage>) : null))
        .then((message) => {
          if (message) applyReaction(row, message);
        })
        .catch(() => {});
    }

    const channels = communities.map((comm) =>
      supabase
        .channel(`panel:${comm.id}`)

        // ── New message ────────────────────────────────────────────────────
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "community_messages",
            filter: `community_id=eq.${comm.id}`,
          },
          (payload) => {
            const row = payload.new as {
              id: string;
              community_id: string;
              content: string;
              created_at: string;
              user_id: string;
              reply_to_id?: string | null;
              image_url?: string | null;
            };

            const isOwn    = row.user_id === userId;
            const isActive = row.community_id === activeCommunityIdRef.current;
            const knownName = resolvedNames.get(row.user_id) ?? null;

            setCommunities((prev) =>
              applyUpdate(prev, row.community_id, (c) => ({
                ...c,
                 is_archived: false,
                lastReaction: null, // new message clears any pending reaction preview
                last_message: {
                  id:         row.id,
                  content:    row.content,
                  created_at: row.created_at,
                  user:       knownName
                    ? { name: knownName }
                    : isOwn
                    ? c.last_message?.user ?? null
                    : null,
                  has_image:  !row.content && !!row.image_url,
                  is_reply:   !!row.reply_to_id,
                  is_deleted: false,
                  reactions:  [],
                },
                message_count:
                  !isOwn && !isActive ? c.message_count + 1 : c.message_count,
              })),
            );

            // Async name resolution for unknown senders.
            if (!isOwn && !resolvedNames.has(row.user_id)) {
              const commId   = row.community_id;
              const msgAt    = row.created_at;
              const senderId = row.user_id;
              resolveName(commId, senderId).then((name) => {
                if (!name) return;
                setCommunities((prev) =>
                  applyUpdate(prev, commId, (c) => {
                    if (c.last_message?.created_at !== msgAt) return c;
                    return { ...c, last_message: { ...c.last_message!, user: { name } } };
                  }),
                );
              });
            }

            // Async: resolve the replied-to user's name for reply messages.
            if (row.reply_to_id) {
              const commId  = row.community_id;
              const msgAt   = row.created_at;
              const replyId = row.reply_to_id;
              fetch(`/api/communities/${commId}/messages/${replyId}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((parent: { user_name?: string } | null) => {
                  if (!parent?.user_name) return;
                  const firstName = parent.user_name.split(" ")[0];
                  setCommunities((prev) =>
                    applyUpdate(prev, commId, (c) => {
                      if (c.last_message?.created_at !== msgAt) return c;
                      return {
                        ...c,
                        last_message: { ...c.last_message!, reply_to_user: firstName },
                      };
                    }),
                  );
                })
                .catch(() => {});
            }
          },
        )

        // ── Soft-delete ────────────────────────────────────────────────────
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "community_messages",
            filter: `community_id=eq.${comm.id}`,
          },
          (payload) => {
            const updated = payload.new as {
              community_id: string;
              created_at: string;
              deleted_at: string | null;
            };
            if (!updated.deleted_at) return;

            setCommunities((prev) =>
              applyUpdate(prev, updated.community_id, (c) => {
                if (c.last_message?.created_at !== updated.created_at) return c;
                return {
                  ...c,
                  last_message: {
                    ...c.last_message!,
                    content:    "",
                    is_deleted: true,
                    has_image:  false,
                    is_reply:   false,
                  },
                };
              }),
            );
          },
        )

        // ── Reaction added ────────────────────────────────────────────────
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "message_reactions",
            filter: `community_id=eq.${comm.id}`,
          },
          (payload) => {
            const r = payload.new as ReactionRow;
            fetchAndApplyReaction(r);

            // Async: resolve reactor name for others so it shows correctly.
            if (r.user_id !== userId && !resolvedNames.has(r.user_id)) {
              const msgId  = r.message_id;
              const rEmoji = r.emoji;
              const uid    = r.user_id;
              const createdAt = r.created_at;
              resolveName(comm.id, uid).then((name) => {
                if (!name) return;
                setCommunities((prev) =>
                  applyUpdate(prev, comm.id, (c) => {
                    if (
                      !c.lastReaction ||
                      c.lastReaction.messageId !== msgId ||
                      c.lastReaction.emoji !== rEmoji ||
                      c.lastReaction.createdAt !== createdAt
                    ) return c;
                    return {
                      ...c,
                      lastReaction: { ...c.lastReaction, firstName: name.split(" ")[0] },
                    };
                  }),
                );
              });
            }
          },
        )

        // ── Reaction changed ───────────────────────────────────────────────
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "message_reactions",
            filter: `community_id=eq.${comm.id}`,
          },
          (payload) => {
            const r = payload.new as ReactionRow;
            fetchAndApplyReaction(r);
          },
        )

        // ── Reaction removed ──────────────────────────────────────────────
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "message_reactions",
            filter: `community_id=eq.${comm.id}`,
          },
          (payload) => {
            const r = payload.old as {
              message_id?: string;
              user_id?: string;
              emoji?: string;
              created_at?: string;
            };
            if (!r.message_id || !r.user_id || !r.emoji) return;

            setCommunities((prev) =>
              applyUpdate(prev, comm.id, (c) => {
                // Clear lastReaction only if it matches the removed reaction.
                const current = c.lastReaction;
                if (!current) return c;
                if (
                  current.messageId === r.message_id &&
                  current.emoji === r.emoji &&
                  (!current.createdAt ||
                    !r.created_at ||
                    current.createdAt === r.created_at)
                ) {
                  return { ...c, lastReaction: null };
                }
                return c;
              }),
            );
          },
        )

        .subscribe(),
    );

    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityIds, userId]);
}
