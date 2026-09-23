"use client";

import { NotificationBubble } from "./NotificationBubble";
import type { CachedThreadEvent } from "@/lib/communities/cache";
import { THREAD_CATEGORIES } from "@/components/communities/threads/types";

interface ThreadNotificationBubbleProps {
  event: CachedThreadEvent;
  communityId: string;
  currentUserId: string;
}

function categoryLabel(value: string): string {
  return (
    THREAD_CATEGORIES.find((c) => c.value === value)?.label ?? value
  );
}

/** Picks the first image attachment from a thread, if any. */
function thumbnailUrl(event: CachedThreadEvent): string | null {
  const img = event.attachments.find((a) =>
    a.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(a.name)
  );
  return img?.url ?? null;
}

/**
 * "John created a thread" for threads that only exist as the legacy
 * thread-events row (threads created before content events were persisted
 * server-side). Newer threads arrive as content events and render through
 * ContentNotificationBubble; both share NotificationBubble, so they look
 * identical. The thread's category becomes the card's second line, and its
 * first image attachment becomes the tile once one exists.
 */
export function ThreadNotificationBubble({
  event,
  communityId,
  currentUserId,
}: ThreadNotificationBubbleProps) {
  const sender = event.users;

  return (
    <NotificationBubble
      kind="thread"
      title={event.title}
      href={`/dashboard/communities/${communityId}/threads/${event.id}`}
      createdAt={event.created_at}
      // The avatar must always key off the real display name — "You" is only
      // the label, both here and inside the bubble.
      senderName={sender?.name ?? null}
      senderId={event.user_id}
      avatarUrl={sender?.avatar_url ?? null}
      isMe={event.user_id === currentUserId}
      subtitle={categoryLabel(event.category)}
      thumbnailUrl={thumbnailUrl(event)}
    />
  );
}
