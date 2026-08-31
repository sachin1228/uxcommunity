import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import type { MessageReaction } from "@/lib/communities/cache";
import { publishChatEvent } from "@/lib/realtime/server";

interface Params {
  params: Promise<{ id: string; msgId: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId, msgId: messageId } = await params;

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

  // Verify membership and message ownership in parallel
  const [{ data: membership }, { data: message }] = await Promise.all([
    db
      .from("community_members")
      .select("joined_at")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("community_messages")
      .select("id, community_id")
      .eq("id", messageId)
      .eq("community_id", communityId)
      .maybeSingle(),
  ]);

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }
  if (!message) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  // Persist an explicit desired state. This contract is idempotent, so retries
  // and coalesced rapid clicks cannot accidentally invert the final reaction.
  // Capture the previous row first so the realtime event can describe the
  // INSERT / UPDATE / DELETE transition (matching the old postgres_changes feed).
  const { data: existingRow } = (await db
    .from("message_reactions")
    .select("emoji, created_at")
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .maybeSingle()) as unknown as {
    data: { emoji: string; created_at: string | null } | null;
  };
  const existingEmoji = existingRow?.emoji ?? null;

  const now = new Date().toISOString();

  const mutation = desiredEmoji === null
    ? db
        .from("message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", userId)
    : db
        .from("message_reactions")
        .upsert(
          {
            message_id: messageId,
            community_id: communityId,
            user_id: userId,
            emoji: desiredEmoji,
            created_at: now,
          },
          { onConflict: "message_id,user_id" },
        );

  const { error: mutationError } = await mutation;
  if (mutationError) {
    return NextResponse.json(
      { error: "Unable to update reaction." },
      { status: 500 },
    );
  }

  // Broadcast the transition to the community chat room.
  // Skip when the upsert was a no-op (same emoji already set on this message).
  if (!(desiredEmoji !== null && existingEmoji === desiredEmoji)) {
    after(async () => {
      try {
        if (desiredEmoji === null) {
          if (!existingEmoji) return; // nothing was removed
          await publishChatEvent({
            communityId,
            topic: "reaction-delete",
            data: { community_id: communityId, message_id: messageId, user_id: userId, emoji: existingEmoji },
          });
        } else if (existingEmoji && existingEmoji !== desiredEmoji) {
          await publishChatEvent({
            communityId,
            topic: "reaction-update",
            data: {
              old: { community_id: communityId, message_id: messageId, user_id: userId, emoji: existingEmoji },
              new: { community_id: communityId, message_id: messageId, user_id: userId, emoji: desiredEmoji },
            },
          });
        } else {
          await publishChatEvent({
            communityId,
            topic: "reaction-insert",
            data: { community_id: communityId, message_id: messageId, user_id: userId, emoji: desiredEmoji },
          });
        }
      } catch (err) {
        console.error("[reactions] realtime publish error:", err);
      }
    });
  }

  // Return authoritative state for this user plus grouped message reactions.
  const { data: rows } = await db
    .from("message_reactions")
    .select("emoji, user_id")
    .eq("message_id", messageId);

  const reactionMap: Record<string, string[]> = {};
  for (const row of rows ?? []) {
    if (!reactionMap[row.emoji]) reactionMap[row.emoji] = [];
    reactionMap[row.emoji].push(row.user_id);
  }

  const reactions: MessageReaction[] = Object.entries(reactionMap).map(
    ([emoji, user_ids]) => ({ emoji, user_ids })
  );

  return NextResponse.json({ reactions, currentUserEmoji: desiredEmoji });
}
