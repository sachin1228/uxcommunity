import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * DELETE /api/communities/[id]/messages/[msgId]
 *
 * Soft-deletes a message for everyone (owner only).
 * Sets deleted_at, clears content and image_url so data does not leak.
 * The Supabase Realtime UPDATE event propagates the change to all clients.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId, msgId } = await params;

  const db = createServiceClient();

  // Fetch message and verify ownership
  const { data: msg } = await db
    .from("community_messages")
    .select("id, user_id")
    .eq("id", msgId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (!msg) return NextResponse.json({ error: "Message not found." }, { status: 404 });
  if (msg.user_id !== userId) return NextResponse.json({ error: "You can only delete your own messages." }, { status: 403 });

  // Soft delete: stamp deleted_at, wipe content and image so data doesn't linger
  const { error } = await db
    .from("community_messages")
    .update({
      deleted_at: new Date().toISOString(),
      content:    null,
      image_url:  null,
      reply_to_id: null,
    })
    .eq("id", msgId)
    .eq("community_id", communityId);

  if (error) {
    console.error("[DELETE message]", error);
    return NextResponse.json({ error: "Failed to delete message." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/**
 * GET /api/communities/[id]/messages/[msgId]
 *
 * Lightweight endpoint used by the realtime handler to fetch the reply preview
 * of a parent message that may not be in the local message cache.
 *
 * Returns: { id: string; content: string | null; user_name: string }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const callerId = session.userId!;
  const { id: communityId, msgId } = await params;

  const db = createServiceClient();

  // Verify calling user is a member of this community.
  const { data: membership } = await db
    .from("community_members")
    .select("user_id")
    .eq("community_id", communityId)
    .eq("user_id", callerId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member." }, { status: 403 });
  }

  const { data: msg } = await db
    .from("community_messages")
    .select("id, content, user_id")
    .eq("id", msgId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (!msg) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  const { data: user } = await db
    .from("users")
    .select("name")
    .eq("id", msg.user_id)
    .maybeSingle();

  return NextResponse.json({
    id: msg.id,
    content: (msg as any).content ?? null,
    user_name: user?.name ?? "Unknown",
  });
}
