import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/communities/[id]/members/[userId]/check
 *
 * Internal-only membership verification endpoint.
 * Called by the realtime Durable Object (CommunityDO) via server-to-server HTTP.
 *
 * Authentication:
 *   Requires `Authorization: Bearer <API_SECRET>` header.
 *   The API_SECRET must match the realtime worker's API_SECRET env var.
 *
 * Behavior:
 *   member → 200 { ok: true }
 *   non-member → 403 { ok: false }
 *   malformed request → 400
 *   internal error → 500
 *
 * This is a lightweight check — does NOT require the calling user to be
 * a member (unlike the parent [userId] endpoint which has a caller auth guard).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  // 1. Verify internal API secret
  const authHeader = req.headers.get("authorization");
  const apiSecret = process.env.API_SECRET;

  if (!apiSecret) {
    return NextResponse.json(
      { ok: false, error: "API_SECRET not configured" },
      { status: 500 }
    );
  }

  if (!authHeader || authHeader !== `Bearer ${apiSecret}`) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  // 2. Extract params
  const { id: communityId, userId } = await params;

  if (!communityId || !userId) {
    return NextResponse.json(
      { ok: false, error: "missing communityId or userId" },
      { status: 400 }
    );
  }

  // 3. Check membership in community_members table
  const db = createServiceClient();

  try {
    const { data, error } = await db
      .from("community_members")
      .select("user_id")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "database_error" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
