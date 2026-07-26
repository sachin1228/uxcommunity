import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * POST /api/admin/users/[id]/join-all-communities
 * body: { join: true }  → upsert user into every community
 * body: { join: false } → remove user from every community
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { join } = body as { join?: boolean };

  if (typeof join !== "boolean") {
    return NextResponse.json({ error: "join must be a boolean." }, { status: 422 });
  }

  const db = createServiceClient();

  if (join) {
    // Fetch all community IDs
    const { data: communities, error: cErr } = await db
      .from("communities")
      .select("id");

    if (cErr) {
      console.error("[admin/join-all] fetch communities:", cErr);
      return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
    }

    const rows = (communities ?? []).map((c) => ({
      community_id: c.id,
      user_id: id,
    }));

    if (rows.length > 0) {
      const { error } = await db
        .from("community_members")
        .upsert(rows, { onConflict: "community_id,user_id" });

      if (error) {
        console.error("[admin/join-all] upsert members:", error);
        return NextResponse.json({ error: "Failed to add user to communities." }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, joined: rows.length });
  } else {
    // Remove from every community
    const { error } = await db
      .from("community_members")
      .delete()
      .eq("user_id", id);

    if (error) {
      console.error("[admin/join-all] delete members:", error);
      return NextResponse.json({ error: "Failed to remove user from communities." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, removed: true });
  }
}
