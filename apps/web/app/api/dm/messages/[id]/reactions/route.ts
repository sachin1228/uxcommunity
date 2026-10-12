import { NextRequest, NextResponse, after } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient, type ServiceClient } from "@/lib/supabase/service";
import type { MessageReaction } from "@/lib/communities/cache";
import { dmParticipants } from "@/lib/direct-messages/server";
import { publishDmEvent } from "@/lib/direct-messages/publish";

/**
 * POST /api/dm/messages/[id]/reactions  { desiredEmoji: string | null }
 *
 * One reaction per user per message. Persists an explicit desired state (so
 * retries and coalesced rapid taps cannot invert the final reaction) and
 * broadcasts the INSERT / UPDATE / DELETE transition to both participants.
 * Same contract as the community chat's reaction route.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: messageId } = await params;

  let desiredEmoji: string | null;
  try {
    const body = await req.json() as { desiredEmoji?: unknown };
    if (body.desiredEmoji === null) {
      desiredEmoji = null;
    } else if (typeof body.desiredEmoji === "string") {
      desiredEmoji = body.desiredEmoji.trim();
    } else {
      return NextResponse.json(
        { error: "desiredEmoji must be a string or null." },
        { status: 422 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (desiredEmoji !== null && !desiredEmoji) {
    return NextResponse.json({ error: "desiredEmoji cannot be empty." }, { status: 422 });
  }

  const db = createServiceClient();

  // The message carries its conversation; the pair on that conversation is
  // the participant check.
  const { data: message } = (await db
    .from("dm_messages")
    .select("id, conversation_id, dm_conversations(user_a, user_b)")
    .eq("id", messageId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      conversation_id: string;
      dm_conversations: { user_a: string; user_b: string } | null;
    } | null;
  };

  if (!message) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }
  const conversation = message.dm_conversations;
  if (!conversation || (conversation.user_a !== userId && conversation.user_b !== userId)) {
    return NextResponse.json({ error: "You are not part of this conversation." }, { status: 403 });
  }

  // Capture the previous row first so the broadcast can describe the
  // transition, and a no-op upsert publishes nothing.
  const { data: existingRow } = (await db
    .from("dm_message_reactions")
    .select("emoji")
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .maybeSingle()) as unknown as {
    data: { emoji: string } | null;
  };
  const existingEmoji = existingRow?.emoji ?? null;

  const mutation = desiredEmoji === null
    ? db
        .from("dm_message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", userId)
    : db
        .from("dm_message_reactions")
        .upsert(
          {
            message_id: messageId,
            conversation_id: message.conversation_id,
            user_id: userId,
            emoji: desiredEmoji,
            created_at: new Date().toISOString(),
          },
          { onConflict: "message_id,user_id" },
        );

  const { error: mutationError } = await mutation;
  if (mutationError) {
    return NextResponse.json({ error: "Unable to update reaction." }, { status: 500 });
  }

  if (!(desiredEmoji !== null && existingEmoji === desiredEmoji)) {
    after(async () => {
      try {
        const base = {
          conversation_id: message.conversation_id,
          message_id: messageId,
          user_id: userId,
        };
        if (desiredEmoji === null) {
          if (!existingEmoji) return; // nothing was removed
          await publishDmEvent({
            participants: dmParticipants(conversation),
            topic: "dm-reaction-delete",
            data: { ...base, emoji: existingEmoji },
          });
        } else if (existingEmoji && existingEmoji !== desiredEmoji) {
          await publishDmEvent({
            participants: dmParticipants(conversation),
            topic: "dm-reaction-update",
            data: {
              old: { ...base, emoji: existingEmoji },
              new: { ...base, emoji: desiredEmoji },
            },
          });
        } else {
          await publishDmEvent({
            participants: dmParticipants(conversation),
            topic: "dm-reaction-insert",
            data: { ...base, emoji: desiredEmoji },
          });
        }
      } catch (err) {
        console.error("[dm reactions] realtime publish error:", err);
      }
    });
  }

  // Authoritative state for this user plus grouped message reactions.
  const { data: rows } = await db
    .from("dm_message_reactions")
    .select("emoji, user_id")
    .eq("message_id", messageId);

  const reactionMap: Record<string, string[]> = {};
  for (const row of (rows ?? []) as Array<{ emoji: string; user_id: string }>) {
    if (!reactionMap[row.emoji]) reactionMap[row.emoji] = [];
    reactionMap[row.emoji].push(row.user_id);
  }

  const reactions: MessageReaction[] = Object.entries(reactionMap).map(
    ([emoji, user_ids]) => ({ emoji, user_ids })
  );

  return NextResponse.json({ reactions, currentUserEmoji: desiredEmoji });
}
