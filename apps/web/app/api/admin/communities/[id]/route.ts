import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { getMasterNameMap, TABLE_LOOKUP } from "@/lib/master-data-cache";
import { resolveCommunityDp } from "@/lib/communities/dp";

// ── GET /api/admin/communities/[id] ─────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();

  const { data: community, error } = await db
    .from("communities")
    .select("id, name, type, image_url, description, reference_id, owner_id, is_active, created_at, updated_at, lottie_url, lottie_format")
    .eq("id", id)
    .maybeSingle();

  if (error || !community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }

  // Resolve the display picture (image + lottie, embedded for the preview)
  // and the master reference name — cached, matching the app-wide convention.
  const [dp, masterNameMap] = await Promise.all([
    resolveCommunityDp({
      type: community.type,
      reference_id: community.reference_id,
      image_url: community.image_url ?? null,
      lottie_url: community.lottie_url ?? null,
      lottie_format: community.lottie_format ?? null,
      embedLottie: true,
    }),
    TABLE_LOOKUP[community.type]
      ? getMasterNameMap(community.type)
      : Promise.resolve({} as Record<string, string>),
  ]);
  const reference_name =
    community.reference_id && TABLE_LOOKUP[community.type]
      ? (masterNameMap[community.reference_id] ?? null)
      : null;

  // Counts + members + messages in parallel
  const [
    { count: member_count },
    { count: message_count },
    { data: memberRows },
    { data: msgRows },
  ] = await Promise.all([
    db.from("community_members").select("*", { count: "exact", head: true }).eq("community_id", id),
    db.from("community_messages").select("*", { count: "exact", head: true }).eq("community_id", id),
    db
      .from("community_members")
      .select("user_id, joined_at")
      .eq("community_id", id)
      .order("joined_at", { ascending: false })
      .limit(20),
    db
      .from("community_messages")
      .select("id, content, created_at, user_id")
      .eq("community_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  // Resolve member + sender names
  const allUserIds = [
    ...new Set([
      ...(memberRows ?? []).map((m) => m.user_id),
      ...(msgRows ?? []).map((m) => m.user_id),
    ]),
  ];

  const { data: userRows } = allUserIds.length
    ? await db.from("users").select("id, name, email").in("id", allUserIds)
    : { data: [] };

  const userMap = Object.fromEntries((userRows ?? []).map((u) => [u.id, u]));

  const members = (memberRows ?? []).map((m) => ({
    id:        m.user_id,
    name:      userMap[m.user_id]?.name  ?? "Unknown",
    email:     userMap[m.user_id]?.email ?? "",
    joined_at: m.joined_at,
  }));

  const messages = (msgRows ?? []).map((m) => ({
    id:         m.id,
    content:    m.content,
    created_at: m.created_at,
    user_name:  userMap[m.user_id]?.name ?? "Unknown",
  }));

  return NextResponse.json({
    community: {
      ...community,
      image_url: dp.image_url,
      lottie_url: dp.lottie_url,
      lottie_format: dp.lottie_format,
      lottie_data: dp.lottie_data,
      reference_name,
      member_count:  member_count  ?? 0,
      message_count: message_count ?? 0,
      members,
      messages,
    },
  });
}

// ── PATCH /api/admin/communities/[id] ────────────────────────────────────────
// Supports: { name?: string, is_active?: boolean }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { body = {}; }

  const update: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Name cannot be empty." }, { status: 422 });
    update.name = name;
  }
  if (typeof body.is_active === "boolean") {
    update.is_active = body.is_active;
  }
  if (typeof body.description === "string") {
    update.description = body.description.trim() || null;
  }

  if (!Object.keys(update).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 422 });
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("communities")
    .update(update)
    .eq("id", id)
    .select("id, name, type, image_url, description, reference_id, is_active, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: "Failed to update community." }, { status: 500 });
  return NextResponse.json({ community: data });
}

// ── DELETE /api/admin/communities/[id] ───────────────────────────────────────
// Hard-deletes community + cascades to members + messages via FK.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();

  const { error } = await db.from("communities").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Failed to delete community." }, { status: 500 });
  return NextResponse.json({ success: true });
}
