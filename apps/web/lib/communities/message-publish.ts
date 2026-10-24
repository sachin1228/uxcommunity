/**
 * Announcing a newly created chat message: realtime event + device push.
 *
 * WHY THIS EXISTS
 *   These ran inline in the message route's `after()` block, which is why that
 *   route read as one long handler. What a *new message* means to the rest of the
 *   system — the event's field names, the reply-sender lookup, who gets pushed —
 *   is one responsibility with one owner, and it is the half of the route that is
 *   allowed to fail without failing the request.
 *
 * WHAT THE CALLER MUST KNOW
 *   * Always called from `after()`, never before the response: a slow lookup or a
 *     slow push fan-out must not delay the sender. Every failure is the caller's
 *     to swallow (the route logs it) — the message row is already committed and
 *     is the source of truth; a missed realtime event is corrected by the
 *     client's next catch-up, and push covers only the devices whose app is not
 *     running.
 *   * `replyContentKind` / `replyContentTitle` are passed already gated by the
 *     route: a content anchor the route could not validate in this community has
 *     `reply_to_content_id === null`, and the event then carries no
 *     content-reply fields at all.
 *   * `sender_name` rides along on the event on purpose: without it every
 *     receiving client rendered "Someone: …" in the sidebar preview (and an
 *     anonymous sender row in the chat) until its per-user profile fetch
 *     round-tripped — the "Someone said hi → John: hi" flicker.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { publishChatEvent } from "@/lib/realtime/server";
import { sendChatMessagePush, type ChatPushWarmup } from "@/lib/push/chat";

/** The inserted row, as the message route's `select` returns it. */
export interface InsertedChatMessage {
  id: string;
  content: string | null;
  created_at: string;
  user_id: string;
  reply_to_id: string | null;
  reply_to_content_id: string | null;
  image_url: string | null;
  mentions: Array<{ user_id: string; name: string }>;
}

export interface NewChatMessageAnnouncement {
  communityId: string;
  inserted: InsertedChatMessage;
  senderName: string | null;
  senderAvatarUrl: string | null;
  /** Content-reply fields, already gated by the route (see the module doc). */
  replyContentKind: string | null;
  replyContentTitle: string | null;
  /**
   * Fan-out reads the route started before its insert (see
   * `warmChatPushTargets`). Optional: without it the push reads everything
   * itself, one round trip later.
   */
  pushWarmup?: ChatPushWarmup;
}

/**
 * Publish the message to the community chat room and wake every other member's
 * device.
 *
 * Realtime reaches only an app that is running — once the OS suspends it the
 * socket dies — so background delivery has to go through Expo's push service.
 */
export async function announceNewChatMessage(
  input: NewChatMessageAnnouncement,
): Promise<void> {
  const { communityId, inserted, senderName, senderAvatarUrl } = input;
  const db = createServiceClient();

  // The device fan-out needs nothing from the reply lookup: who was replied to
  // is a field on the realtime event, not a push input. Starting the push here
  // rather than after the lookup keeps a reply's two sequential profile reads
  // off the notification's path.
  const push = sendChatMessagePush(
    {
      communityId,
      messageId: inserted.id,
      senderId: inserted.user_id,
      senderName,
      senderAvatarUrl,
      content: inserted.content ?? null,
      hasImage: !!inserted.image_url,
      isReply: !!inserted.reply_to_id,
    },
    { warmup: input.pushWarmup },
  );

  // The reply bubble shows who was replied to; the event carries the author's
  // id and name so a receiving client does not have to fetch either — the id
  // is what lets the quote wear that author's chat color immediately.
  let replySenderName: string | null = null;
  let replySenderId: string | null = null;
  if (inserted.reply_to_id) {
    const { data: parentRow } = await db
      .from("community_messages")
      .select("user_id")
      .eq("id", inserted.reply_to_id)
      .maybeSingle();
    const parentId = (parentRow as { user_id?: string } | null)?.user_id ?? null;
    if (parentId) {
      replySenderId = parentId;
      const { data: parentUser } = await db
        .from("users")
        .select("name")
        .eq("id", parentId)
        .maybeSingle();
      replySenderName = (parentUser as { name?: string } | null)?.name ?? null;
    }
  }

  // The live event and the device fan-out are independent; start both at once.
  // The push used to wait for the realtime POST (and its retries) to finish,
  // which is a round trip of pure delay on every background notification.
  const publish = publishChatEvent({
    communityId,
    topic: "message",
    data: {
      id: inserted.id,
      community_id: communityId,
      user_id: inserted.user_id,
      sender_name: senderName,
      sender_avatar_url: senderAvatarUrl,
      content: inserted.content ?? "",
      created_at: inserted.created_at,
      reply_to_id: inserted.reply_to_id ?? null,
      reply_sender_name: replySenderName,
      reply_sender_id: replySenderId,
      // Content-anchored replies carry their own preview fields.
      reply_to_content_id: inserted.reply_to_content_id ?? null,
      reply_content_kind: input.replyContentKind,
      reply_content_title: input.replyContentTitle,
      image_url: inserted.image_url ?? null,
      mentions: inserted.mentions ?? [],
    },
  });

  await Promise.all([publish, push]);
}
