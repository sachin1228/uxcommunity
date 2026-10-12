import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { dmReadColumn, loadDmConversationForUser } from "@/lib/direct-messages/server";

/**
 * PATCH /api/dm/conversations/[id]/read
 *
 * Advance the viewer's own read marker. The client asks once per open (to
 * position the unread divider and clear the badge) and then on a cooldown
 * while live messages keep arriving (see lib/direct-messages/read-manager).
 * Returns the marker it replaced, like the community chat's read route.
 */
export async function PATCH(
  _req: Request,
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

  const db = createServiceClient();
  const access = await loadDmConversationForUser(db, conversationId, userId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const conversation = access.conversation;

  const column = dmReadColumn(conversation, userId);
  const previousLastReadAt = conversation[column];
  const markedAt = new Date().toISOString();
  const patch =
    column === "user_a_last_read_at"
      ? { user_a_last_read_at: markedAt }
      : { user_b_last_read_at: markedAt };

  const { error } = await db
    .from("dm_conversations")
    .update(patch)
    .eq("id", conversationId);

  if (error) {
    console.error("[PATCH dm read] Supabase error:", error);
    return NextResponse.json({ error: "Failed to mark as read." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, previousLastReadAt, markedAt });
}
