"use client";

import { NotificationBubble } from "./NotificationBubble";
import { fmtEventWhen } from "./chatUtils";
import type { CachedContentEvent, ContentEventKind } from "@/lib/communities/cache";

interface ContentNotificationBubbleProps {
  event: CachedContentEvent;
  communityId: string;
  currentUserId: string;
}

function hrefFor(kind: ContentEventKind, communityId: string, id: string): string {
  switch (kind) {
    case "thread":   return `/dashboard/communities/${communityId}/threads/${id}`;
    case "showcase": return `/dashboard/communities/${communityId}/showcase/${id}`;
    case "resource": return `/dashboard/communities/${communityId}/resources/${id}`;
    case "event":    return `/dashboard/communities/${communityId}/events/${id}`;
  }
}

/**
 * The permanent "John created a …" entry in the chat timeline, for all four
 * areas. It renders through the shared NotificationBubble, so a created
 * resource, event, showcase post or thread reads as a message bubble carrying
 * its own accent — and, being seeded from the bootstrap history rather than
 * session state, it survives reloads exactly like a normal message does.
 */
export function ContentNotificationBubble({
  event,
  communityId,
  currentUserId,
}: ContentNotificationBubbleProps) {
  const sender = event.users;
  // A created event's card carries its start date/time as the second line —
  // "when is it?" is the question the notification should already answer.
  const subtitle =
    event.kind === "event" && event.event_date
      ? fmtEventWhen(event.event_date)
      : null;

  return (
    <NotificationBubble
      kind={event.kind}
      title={event.title}
      href={hrefFor(event.kind, communityId, event.id)}
      createdAt={event.created_at}
      // "You" is only the label — the avatar and its color key off the real name.
      senderName={sender?.name ?? null}
      senderId={event.user_id}
      avatarUrl={sender?.avatar_url ?? null}
      isMe={event.user_id === currentUserId}
      subtitle={subtitle}
    />
  );
}
