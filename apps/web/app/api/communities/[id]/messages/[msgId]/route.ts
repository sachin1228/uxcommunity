import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

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
