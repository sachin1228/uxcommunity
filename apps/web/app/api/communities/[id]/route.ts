import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id } = await params;

  const db = createServiceClient();

  // Verify user is a member
  const { data: membership } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  const { data: community, error } = await db
    .from("communities")
    .select("id, name, type, image_url, reference_id, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }

  // Resolve image_url from master table (same logic as the list API)
  // so the chat header always shows the same logo as the sidebar.
  const tableLookup: Record<string, { table: string; idCol: string }> = {
    city:             { table: "cities",            idCol: "id" },
    sector:           { table: "design_sectors",    idCol: "id" },
    interest:         { table: "design_interests",  idCol: "id" },
    company:          { table: "companies",         idCol: "id" },
    experience_level: { table: "experience_levels", idCol: "id" },
  };
  let resolvedImageUrl: string | null = community.image_url ?? null;
  const lookup = tableLookup[community.type];
  if (lookup && community.reference_id) {
    const { data: masterRow } = await db
      .from(lookup.table as any)
      .select(`${lookup.idCol}, image_url`)
      .eq(lookup.idCol, community.reference_id)
      .maybeSingle();
    if ((masterRow as any)?.image_url) resolvedImageUrl = (masterRow as any).image_url;
  }

  // Member count
  const { count: member_count } = await db
    .from("community_members")
    .select("*", { count: "exact", head: true })
    .eq("community_id", id);

  // Recent members — fetch user info separately to avoid !inner join issues
  const { data: memberRows } = await db
    .from("community_members")
    .select("user_id, joined_at")
    .eq("community_id", id)
    .order("joined_at", { ascending: false })
    .limit(10);

  const members = await Promise.all(
    (memberRows ?? []).map(async (m) => {
      const { data: user } = await db
        .from("users")
        .select("name, avatar_url")
        .eq("id", m.user_id)
        .single();
      return { ...m, users: user ?? null };
    })
  );

  return NextResponse.json({
    community: { ...community, image_url: resolvedImageUrl, member_count: member_count ?? 0 },
    members,
  });
}
