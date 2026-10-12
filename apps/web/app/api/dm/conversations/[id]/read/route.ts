import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { normalizeUtcCursor } from "@/lib/direct-messages/cursor";

/**
 * PATCH /api/dm/conversations/[id]/read  { last_read_at }
 *
 * Advance the caller's read marker to the timestamp of the newest message
 * they have actually DISPLAYED — never merely "now", which would also swallow
 * messages that arrived between render and request.
 *
 * The marker is advanced by mark_dm_conversation_read, which stores
 * greatest(existing, incoming): a stale tab, an out-of-order request or a
 * second device can therefore never move the marker backwards, and only a
 * participant can touch their own side. Returns the previous and effective
 * markers.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;
  const { id: conversationId } = await params;

  // A read marker without a displayed message is meaningless — refuse rather
  // than fall back to now().
  let lastReadAt: string | null = null;
  try {
    const body = (await req.json()) as { last_read_at?: unknown };
    if (typeof body.last_read_at === "string") {
      lastReadAt = normalizeUtcCursor(body.last_read_at);
    }
  } catch {
    // Fall through to the 400 below.
  }
  if (!lastReadAt) {
    return NextResponse.json(
      { error: "A valid last_read_at is required." },
      { status: 400 },
    );
  }

  const db = createServiceClient();
  const { data, error } = await callPerformanceRpc(db, "mark_dm_conversation_read", {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_last_read_at: lastReadAt,
  });

  const row = data?.[0];
  if (error || !row) {
    if (error?.code === "P0002") {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }
    if (error?.code === "42501") {
      return NextResponse.json(
        { error: "You are not part of this conversation." },
        { status: 403 },
      );
    }
    console.error("[PATCH dm read] RPC error:", error);
    return NextResponse.json({ error: "Failed to mark as read." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    previousLastReadAt: row.previous_marked_at ?? null,
    markedAt: row.marked_at,
  });
}
