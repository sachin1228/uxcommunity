import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Invite tokens are 32-char hex strings (UUID without dashes). */
function extractToken(slug: string): string | null {
  const stripped = slug.replace(/-/g, "").slice(-32);
  return /^[0-9a-f]{32}$/.test(stripped) ? stripped : null;
}

// ── GET /api/communities/join/[token]
// Look up a community by invite token — no auth required so the page can
// show community info before the user is logged in.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: slug } = await params;
  const token = extractToken(slug);
  if (!token) {
    return NextResponse.json({ error: "Invalid invite link." }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: community, error } = await db
    .from("communities")
    .select("id, name, type, image_url, is_private, description")
    .eq("invite_token", token)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !community) {
    return NextResponse.json({ error: "Invite link not found or expired." }, { status: 404 });
  }

  const { count } = await db
    .from("community_members")
    .select("*", { count: "exact", head: true })
    .eq("community_id", community.id);

  return NextResponse.json({ community: { ...community, member_count: count ?? 0 } });
}

// ── POST /api/communities/join/[token]
// Authenticated. For public communities: join immediately.
// For private communities: insert a join request (idempotent).
// ──────────────────────────────────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;

  const { token: slug } = await params;
  const token = extractToken(slug);
  if (!token) {
    return NextResponse.json({ error: "Invalid invite link." }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: community, error } = await db
    .from("communities")
    .select("id, name, is_private")
    .eq("invite_token", token)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !community) {
    return NextResponse.json({ error: "Invite link not found or expired." }, { status: 404 });
  }

  // Already a member?
  const { data: existing } = await db
    .from("community_members")
    .select("community_id")
    .eq("community_id", community.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ status: "already_member", communityId: community.id });
  }

  if (community.is_private) {
    // Upsert a join request (idempotent)
    const { error: reqErr } = await db
      .from("community_join_requests")
      .upsert(
        { community_id: community.id, user_id: userId, status: "pending" },
        { onConflict: "community_id,user_id", ignoreDuplicates: true },
      );
    if (reqErr) {
      console.error("[community-join] join request failed:", reqErr);
      return NextResponse.json({ error: "Failed to submit join request." }, { status: 500 });
    }
    return NextResponse.json({ status: "requested", communityId: community.id });
  }

  // Public — join immediately
  const { error: joinErr } = await db
    .from("community_members")
    .insert({ community_id: community.id, user_id: userId, role: "member" });

  if (joinErr) {
    console.error("[community-join] join failed:", joinErr);
    return NextResponse.json({ error: "Failed to join community." }, { status: 500 });
  }

  return NextResponse.json({ status: "joined", communityId: community.id });
}
