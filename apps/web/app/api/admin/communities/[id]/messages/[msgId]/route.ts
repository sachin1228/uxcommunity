import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

// ── DELETE /api/admin/communities/[id]/messages/[msgId] ─────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id, msgId } = await params;
  const db = createServiceClient();

  const { error } = await db
    .from("community_messages")
    .delete()
    .eq("id", msgId)
    .eq("community_id", id);

  if (error) return NextResponse.json({ error: "Failed to delete message." }, { status: 500 });
  return NextResponse.json({ success: true });
}
