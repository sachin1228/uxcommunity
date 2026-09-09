import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { deleteR2AssetIfUnreferenced } from "@/lib/r2";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const { id } = await params;
  const db = createServiceClient();

  // Fetch the lottie URL before deleting so the R2 object can be cleaned up.
  // Cast matches the repo-wide untyped supabase-js baseline (see next.config.js).
  const { data: setting } = (await db
    .from("lottie_settings")
    .select("lottie_url")
    .eq("id", id)
    .maybeSingle()) as unknown as { data: { lottie_url: string | null } | null };

  const { error } = await db.from("lottie_settings").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: "Failed to delete lottie setting." }, { status: 500 });
  }

  // Best-effort R2 cleanup — the same lottie object may be mirrored onto a
  // community/master row, so only delete it when nothing references it.
  if (setting?.lottie_url) {
    try {
      await deleteR2AssetIfUnreferenced(db, setting.lottie_url, [
        { table: "lottie_settings", column: "lottie_url" },
        { table: "communities", column: "lottie_url" },
        { table: "cities", column: "lottie_url" },
        { table: "design_sectors", column: "lottie_url" },
        { table: "design_interests", column: "lottie_url" },
        { table: "experience_levels", column: "lottie_url" },
      ]);
    } catch (cleanupError) {
      // Non-fatal — re-run via the admin orphan scan (Tools → R2 storage health).
      console.error("[admin/lottie-settings] R2 cleanup error:", cleanupError);
    }
  }

  return NextResponse.json({ success: true });
}