import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";

const MAX_CHANNEL_NAME = 80;

/** Members may read the channel list; only the owner may create channels. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (e) {
    return e as Response;
  }

  const { id: communityId } = await params;
  const db = createServiceClient();

  const { data: membership } = await db
    .from("community_members")
    .select("community_id")
    .eq("community_id", communityId)
    .eq("user_id", session.userId!)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  const { data, error } = await db
    .from("community_channels")
    .select("id, name, created_at")
    .eq("community_id", communityId)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "Failed to load channels." }, { status: 500 });
  }

  return NextResponse.json({ channels: data ?? [] });
}

// ── POST /api/communities/[id]/channels ──────────────────────────────────────
// Create a subchannel. Owner only.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;
  const { id: communityId } = await params;
  const db = createServiceClient();

  const { data: community } = await db
    .from("communities")
    .select("id, owner_id")
    .eq("id", communityId)
    .eq("is_active", true)
    .maybeSingle();

  if (!community) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  if (community.owner_id !== userId) return NextResponse.json({ error: "Owner only." }, { status: 403 });

  const limit = await rateLimit(`channel:create:${userId}:60s`, 10, 60);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Too many channels. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  let name: string;
  try {
    const body = await req.json();
    name = String(body.name ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (name.length < 1 || name.length > MAX_CHANNEL_NAME) {
    return NextResponse.json({ error: `Channel name must be 1–${MAX_CHANNEL_NAME} characters.` }, { status: 422 });
  }

  const { data: inserted, error } = await db
    .from("community_channels")
    .insert({ community_id: communityId, created_by: userId, name })
    .select("id, community_id, name, created_at")
    .single();

  if (error) {
    // Unique (community_id, lower(name)) violation.
    if (error.code === "23505") {
      return NextResponse.json({ error: "A channel with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create channel." }, { status: 500 });
  }

  return NextResponse.json({ channel: inserted }, { status: 201 });
}