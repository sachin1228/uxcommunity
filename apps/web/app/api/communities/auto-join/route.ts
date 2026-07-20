import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function POST() {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;

  const db = createServiceClient();

  // ── 1. Load full profile ─────────────────────────────────────
  const { data: profile } = await db
    .from("designer_profiles")
    .select(`
      city_id, sector_id, company_id, experience_level,
      cities(name, image_url),
      design_sectors(name, image_url),
      companies(name, image_url)
    `)
    .eq("user_id", userId)
    .maybeSingle();

  // ── 2. Load interests ────────────────────────────────────────
  const { data: interests } = await db
    .from("user_interests")
    .select("interest_id, design_interests(name, image_url)")
    .eq("user_id", userId);

  type CommunitySpec = {
    type: "city" | "sector" | "interest" | "company" | "experience_level";
    reference_id: string;
    name: string;
    image_url: string | null;
  };
  const specs: CommunitySpec[] = [];

  if (profile?.city_id) {
    const city = profile.cities as unknown as { name: string; image_url: string | null } | null;
    specs.push({
      type: "city",
      reference_id: profile.city_id,
      name: `${city?.name ?? "Unknown City"} Designers`,
      image_url: city?.image_url ?? null,
    });
  }

  if (profile?.sector_id) {
    const sector = profile.design_sectors as unknown as { name: string; image_url: string | null } | null;
    specs.push({
      type: "sector",
      reference_id: profile.sector_id,
      name: `${sector?.name ?? "Unknown Sector"} Community`,
      image_url: sector?.image_url ?? null,
    });
  }

  if (profile?.company_id) {
    const company = profile.companies as unknown as { name: string; image_url: string | null } | null;
    specs.push({
      type: "company",
      reference_id: profile.company_id,
      name: `${company?.name ?? "Unknown Company"} Designers`,
      image_url: company?.image_url ?? null,
    });
  }

  if (profile?.experience_level) {
    // Look up the experience level by slug — use the admin-managed `name` directly
    const { data: expLevel } = await db
      .from("experience_levels")
      .select("id, name, image_url")
      .eq("slug", profile.experience_level)
      .maybeSingle();

    if (expLevel) {
      specs.push({
        type: "experience_level",
        reference_id: expLevel.id,
        name: expLevel.name,
        image_url: expLevel.image_url ?? null,
      });
    }
  }

  for (const row of interests ?? []) {
    const interest = row.design_interests as unknown as { name: string; image_url: string | null } | null;
    if (row.interest_id && interest?.name) {
      specs.push({
        type: "interest",
        reference_id: row.interest_id,
        name: interest.name,
        image_url: interest.image_url ?? null,
      });
    }
  }

  if (!specs.length) return NextResponse.json({ joined: [] });

  // ── 3. Upsert each community ─────────────────────────────────
  const joinedCommunities: string[] = [];

  for (const spec of specs) {
    const { data: community, error } = await db
      .from("communities")
      .upsert(
        {
          type: spec.type,
          reference_id: spec.reference_id,
          name: spec.name,
          image_url: spec.image_url,
        },
        { onConflict: "type,reference_id", ignoreDuplicates: false }
      )
      .select("id")
      .single();

    if (error || !community) continue;

    await db
      .from("community_members")
      .upsert(
        { community_id: community.id, user_id: userId },
        { onConflict: "community_id,user_id", ignoreDuplicates: true }
      );

    joinedCommunities.push(community.id);
  }

  return NextResponse.json({ joined: joinedCommunities });
}
