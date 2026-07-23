import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

// ── DELETE /api/admin/communities/messages ────────────────────────────────────
// Deletes ALL messages across ALL communities. Admin only.
export async function DELETE() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const db = createServiceClient();

  const { error, count } = await db
    .from("community_messages")
    .delete({ count: "exact" })
    .neq("id", "00000000-0000-0000-0000-000000000000"); // match all rows

  if (error) {
    return NextResponse.json({ error: "Failed to reset chat messages." }, { status: 500 });
  }

  return NextResponse.json({ success: true, deleted: count ?? 0 });
}
