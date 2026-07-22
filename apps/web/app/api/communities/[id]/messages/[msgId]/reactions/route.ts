import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import type { MessageReaction } from "@/lib/communities/cache";

interface Params {
  params: Promise<{ id: string; msgId: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId, msgId: messageId } = await params;

  let emoji: string;
  try {
    const body = await req.json();
    emoji = (body.emoji ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!emoji) {
    return NextResponse.json({ error: "emoji is required." }, { status: 422 });
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

  // Check existing reaction for this user on this message
  const { data: existing } = await db
    .from("message_reactions")
    .select("id, emoji")
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    if (existing.emoji === emoji) {
      // Same emoji — toggle OFF (delete)
      await db.from("message_reactions").delete().eq("id", existing.id);
    } else {
      // Different emoji — update to new one
      await db
        .from("message_reactions")
        .update({ emoji, created_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
  } else {
    // No existing reaction — insert
    await db.from("message_reactions").insert({
      message_id: messageId,
      community_id: communityId,
      user_id: userId,
      emoji,
    });
  }

  // Return updated reactions for this message
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

  return NextResponse.json({ reactions });
}
