import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

const TABLE_LOOKUP: Record<string, { table: string; idCol: string }> = {
  city:             { table: "cities",            idCol: "id" },
  sector:           { table: "design_sectors",    idCol: "id" },
  interest:         { table: "design_interests",  idCol: "id" },
  company:          { table: "companies",         idCol: "id" },
  experience_level: { table: "experience_levels", idCol: "id" },
};

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
    .select("id, name, type, image_url, description, reference_id, is_active, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }

  // Resolve reference entity name + image from master table
  let reference_name: string | null = null;
  const lookup = TABLE_LOOKUP[community.type];
  if (lookup && community.reference_id) {
    const { data: refRow } = await db
      .from(lookup.table as any)
      .select("name")
      .eq(lookup.idCol, community.reference_id)
      .maybeSingle();
    reference_name = (refRow as any)?.name ?? null;
  }

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
