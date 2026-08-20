import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

const MAX_CHANNEL_NAME = 80;

async function loadOwnedCommunity(communityId: string, userId: string) {
  const db = createServiceClient();
  const { data: community } = await db
    .from("communities")
    .select("id, owner_id")
    .eq("id", communityId)
    .eq("is_active", true)
    .maybeSingle();

  if (!community) return { db, error: NextResponse.json({ error: "Community not found." }, { status: 404 }) as Response };
  if (community.owner_id !== userId) return { db, error: NextResponse.json({ error: "Owner only." }, { status: 403 }) as Response };
  return { db, error: null };
}

// ── PATCH /api/communities/[id]/channels/[channelId] ─────────────────────────
// Rename a subchannel. Owner only.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; channelId: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const { id: communityId, channelId } = await params;
  const { db, error } = await loadOwnedCommunity(communityId, session.userId!);
  if (error) return error;

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

  const { data: updated, error: updateError } = await db
    .from("community_channels")
    .update({ name })
    .eq("id", channelId)
    .eq("community_id", communityId)
    .select("id, community_id, name, created_at")
    .single();

  if (updateError) {
    if (updateError.code === "23505") {
      return NextResponse.json({ error: "A channel with that name already exists." }, { status: 409 });
    }
    if (updateError.code === "PGRST116") {
      return NextResponse.json({ error: "Channel not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to rename channel." }, { status: 500 });
  }

  return NextResponse.json({ channel: updated });
}

// ── DELETE /api/communities/[id]/channels/[channelId] ────────────────────────
// Permanently delete a subchannel and its messages (cascade). Owner only.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; channelId: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const { id: communityId, channelId } = await params;
  const { db, error } = await loadOwnedCommunity(communityId, session.userId!);
  if (error) return error;

  const { data: existing } = await db
    .from("community_channels")
    .select("id")
    .eq("id", channelId)
    .eq("community_id", communityId)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Channel not found." }, { status: 404 });

  const { error: deleteError } = await db
    .from("community_channels")
    .delete()
    .eq("id", channelId)
    .eq("community_id", communityId);
  if (deleteError) return NextResponse.json({ error: "Failed to delete channel." }, { status: 500 });

  return NextResponse.json({ success: true });
}