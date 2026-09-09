import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deleteR2AssetIfUnreferenced } from "@/lib/r2";

// ── DELETE /api/admin/communities/messages ────────────────────────────────────
// Deletes ALL messages across ALL communities. Admin only.
// Also cleans up the R2 objects behind every message image (best-effort;
// anything that survives can be re-run via the admin orphan scan).
export async function DELETE() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const db = createServiceClient();

  // Cast matches the repo-wide untyped supabase-js baseline (see next.config.js).
  const { data: rows } = (await db
    .from("community_messages")
    .select("image_url")
    .not("image_url", "is", null)) as unknown as { data: Array<{ image_url: string | null }> | null };
  const imageUrls = Array.from(new Set((rows ?? []).map((row) => row.image_url).filter(Boolean)));

  const { error, count } = await db
    .from("community_messages")
    .delete({ count: "exact" })
    .neq("id", "00000000-0000-0000-0000-000000000000"); // match all rows

  if (error) {
    return NextResponse.json({ error: "Failed to reset chat messages." }, { status: 500 });
  }

  for (const url of imageUrls) {
    try {
      await deleteR2AssetIfUnreferenced(db, url, [
        { table: "community_messages", column: "image_url" },
      ]);
    } catch (cleanupError) {
      console.error("[admin/messages] R2 cleanup error:", cleanupError);
    }
  }

  return NextResponse.json({ success: true, deleted: count ?? 0 });
}
