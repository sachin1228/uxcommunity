import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deleteR2AssetIfUnreferenced } from "@/lib/r2";

// ── DELETE /api/admin/communities/[id]/messages/[msgId] ─────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; msgId: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id, msgId } = await params;
  const db = createServiceClient();

  // Fetch the image before deleting so the R2 object can be cleaned up after.
  // Cast matches the repo-wide untyped supabase-js baseline (see next.config.js).
  const { data: msg } = (await db
    .from("community_messages")
    .select("image_url")
    .eq("id", msgId)
    .eq("community_id", id)
    .maybeSingle()) as unknown as { data: { image_url: string | null } | null };

  const { error } = await db
    .from("community_messages")
    .delete()
    .eq("id", msgId)
    .eq("community_id", id);

  if (error) return NextResponse.json({ error: "Failed to delete message." }, { status: 500 });

  // R2 cleanup is best-effort: a failure leaves the object for the orphan
  // sweep (grace period) instead of blocking the deletion.
  if (msg?.image_url) {
    try {
      await deleteR2AssetIfUnreferenced(db, msg.image_url, [
        { table: "community_messages", column: "image_url" },
      ]);
    } catch (cleanupError) {
      console.error("[admin/messages] R2 cleanup error:", cleanupError);
    }
  }

  return NextResponse.json({ success: true });
}