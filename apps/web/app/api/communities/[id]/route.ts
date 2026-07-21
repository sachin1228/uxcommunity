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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id } = await params;

  const db = createServiceClient();

  // Run membership check and community fetch in parallel
  const [{ data: membership }, { data: community, error: commErr }] = await Promise.all([
    db
      .from("community_members")
      .select("joined_at")
      .eq("community_id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("communities")
      .select("id, name, type, image_url, reference_id, created_at")
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }
  if (commErr || !community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }

  // Resolve image_url + fetch member rows + member count — all in parallel
  const lookup = TABLE_LOOKUP[community.type];
  const [resolvedImageResult, { data: memberRows }, { count: member_count }] = await Promise.all([
    lookup && community.reference_id
      ? db
          .from(lookup.table as any)
          .select(`${lookup.idCol}, image_url`)
          .eq(lookup.idCol, community.reference_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from("community_members")
      .select("user_id, joined_at")
      .eq("community_id", id)
      .order("joined_at", { ascending: false })
      .limit(10),
    db
      .from("community_members")
      .select("*", { count: "exact", head: true })
      .eq("community_id", id),
  ]);

  const resolvedImageUrl: string | null =
    (resolvedImageResult as any)?.data?.image_url ?? community.image_url ?? null;

  // Batch-fetch member user info (1 query instead of N)
  const memberUserIds = (memberRows ?? []).map((m) => m.user_id);
  const [{ data: memberUsers }, { data: memberProfiles }] = memberUserIds.length
    ? await Promise.all([
        db.from("users").select("id, name").in("id", memberUserIds),
        db.from("designer_profiles").select("user_id, avatar_url").in("user_id", memberUserIds),
      ])
    : [{ data: [] }, { data: [] }];

  const userMap = Object.fromEntries((memberUsers ?? []).map((u) => [u.id, u]));
  const avatarMap = Object.fromEntries((memberProfiles ?? []).map((p) => [p.user_id, p.avatar_url]));

  const members = (memberRows ?? []).map((m) => ({
    user_id: m.user_id,
    joined_at: m.joined_at,
    users: userMap[m.user_id]
      ? {
          name: userMap[m.user_id].name,
          avatar_url: avatarMap[m.user_id] ?? null,
        }
      : null,
  }));

  return NextResponse.json({
    community: {
      ...community,
      image_url: resolvedImageUrl,
      member_count: member_count ?? 0,
    },
    members,
  });
}
