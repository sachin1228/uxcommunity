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
    // One database transaction so the operator override (the join-cap
    // bypass) and the writes share it — see public.admin_join_all_communities
    // in the creation-limits migration. Joining this member into every
    // community is an operator action, so the cap does not apply to it.
    const { data, error } = await db.rpc("admin_join_all_communities", { p_user_id: id });

    if (error) {
      console.error("[admin/join-all] join failed:", error);
      return NextResponse.json({ error: "Failed to add user to communities." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, joined: data ?? 0 });
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
