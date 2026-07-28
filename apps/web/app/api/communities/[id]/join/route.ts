import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * POST /api/communities/[id]/join
 *
 * Access rules:
 *  - interest / general / user  → anyone can join
 *  - company                    → user's company_id must match community reference_id
 *  - sector                     → user's sector_id must match community reference_id
 *  - city                       → user's city_id must match community reference_id
 *  - experience_level           → user's experience_level slug must resolve to matching reference_id
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId } = await params;

  const db = createServiceClient();

  // 1. Load community
  const { data: community } = await db
    .from("communities")
    .select("id, type, reference_id")
    .eq("id", communityId)
    .eq("is_active", true)
    .maybeSingle();

  if (!community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }

  // 2. Interest / general / user communities are open to all
  const FREE_TYPES = new Set(["interest", "general", "user"]);

  if (!FREE_TYPES.has(community.type)) {
    const { data: profile } = await db
      .from("designer_profiles")
      .select("city_id, sector_id, company_id, experience_level")
      .eq("user_id", userId)
      .maybeSingle();

    let allowed = false;

    if (community.type === "company") {
      allowed = profile?.company_id === community.reference_id;
    } else if (community.type === "sector") {
      allowed = profile?.sector_id === community.reference_id;
    } else if (community.type === "city") {
      allowed = profile?.city_id === community.reference_id;
    } else if (community.type === "experience_level" && profile?.experience_level) {
      const { data: expLevel } = await db
        .from("experience_levels")
        .select("id")
        .eq("slug", profile.experience_level)
        .maybeSingle();
      allowed = expLevel?.id === community.reference_id;
    }

    if (!allowed) {
      const labels: Record<string, string> = {
        company:          "company",
        sector:           "industry",
        city:             "city",
        experience_level: "experience level",
      };
      return NextResponse.json(
        {
          error: `You can only join this ${labels[community.type] ?? "profile"} community if it matches your profile. Update your profile to join.`,
          code:  "PROFILE_MISMATCH",
        },
        { status: 403 },
      );
    }
  }

  // 3. Upsert membership
  const { error } = await db
    .from("community_members")
    .upsert(
      { community_id: communityId, user_id: userId },
      { onConflict: "community_id,user_id", ignoreDuplicates: true },
    );

  if (error) {
    return NextResponse.json({ error: "Failed to join community." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
