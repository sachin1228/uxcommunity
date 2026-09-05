import { createServiceClient } from "@/lib/supabase/service";

/**
 * Auto-join a user to every community implied by their profile:
 * General (always) + city + sector + experience level + each design interest.
 *
 * The catch-all "Other" options (cities / sectors / interests named "Other")
 * intentionally do NOT produce a dedicated community — those members already
 * land in the always-joined General community.
 *
 * Runs server-side (service role) at signup completion and again, once per
 * member, as a dashboard repair for accounts created before this logic was
 * added. Idempotent: communities are upserted on (type, reference_id) and
 * memberships are upserted on (community_id, user_id).
 */
export async function autoJoinCommunities(userId: string): Promise<string[]> {
  const db = createServiceClient();
  const joinedCommunities: string[] = [];

  // ── 1. Load full profile ─────────────────────────────────────
  const { data: profile } = await db
    .from("designer_profiles")
    .select(`
      city_id, sector_id, experience_level,
      cities(name, image_url),
      design_sectors(name, image_url)
    `)
    .eq("user_id", userId)
    .maybeSingle();

  // ── 2. Load interests ────────────────────────────────────────
  const { data: interests } = await db
    .from("user_interests")
    .select("interest_id, design_interests(name, image_url)")
    .eq("user_id", userId);

  type CommunitySpec = {
    type: "city" | "sector" | "interest" | "experience_level";
    reference_id: string;
    name: string;
    image_url: string | null;
  };
  const specs: CommunitySpec[] = [];

  const isCatchAll = (name: string | null | undefined) =>
    (name ?? "").trim().toLowerCase() === "other";

  if (profile?.city_id) {
    const city = profile.cities as unknown as { name: string; image_url: string | null } | null;
    // "Other" cities don't get a community — the member stays in General.
    if (city && !isCatchAll(city.name)) {
      specs.push({
        type: "city",
        reference_id: profile.city_id,
        name: `${city.name} Designers`,
        image_url: city.image_url ?? null,
      });
    }
  }

  if (profile?.sector_id) {
    const sector = profile.design_sectors as unknown as { name: string; image_url: string | null } | null;
    // "Other" sectors don't get a community — the member stays in General.
    if (sector && !isCatchAll(sector.name)) {
      specs.push({
        type: "sector",
        reference_id: profile.sector_id,
        name: `${sector.name} Community`,
        image_url: sector.image_url ?? null,
      });
    }
  }

  if (profile?.experience_level) {
    // Look up the experience level by slug — use the admin-managed `name` directly
    const { data: expLevel } = await db
      .from("experience_levels")
      .select("id, name, image_url")
      .eq("slug", profile.experience_level)
      .maybeSingle();

    if (expLevel && !isCatchAll((expLevel as { name: string }).name)) {
      specs.push({
        type: "experience_level",
        reference_id: (expLevel as { id: string }).id,
        name: (expLevel as { name: string }).name,
        image_url: (expLevel as { image_url: string | null }).image_url ?? null,
      });
    }
  }

  for (const row of interests ?? []) {
    const interest = row.design_interests as unknown as { name: string; image_url: string | null } | null;
    if (row.interest_id && interest?.name && !isCatchAll(interest.name)) {
      specs.push({
        type: "interest",
        reference_id: row.interest_id,
        name: interest.name,
        image_url: interest.image_url ?? null,
      });
    }
  }

  // ── 3. Always join the default general community ─────────────
  const { data: generalCommunity } = await db
    .from("communities")
    .select("id")
    .eq("type", "general")
    .maybeSingle();

  if (generalCommunity) {
    const { error } = await db
      .from("community_members")
      .upsert(
        { community_id: generalCommunity.id, user_id: userId },
        { onConflict: "community_id,user_id", ignoreDuplicates: true }
      );
    if (!error) joinedCommunities.push((generalCommunity as { id: string }).id);
  }

  if (specs.length) {
    // ── 4. Upsert each profile-based community (parallel) ───────
    const upserted = await Promise.all(
      specs.map(async (spec) => {
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

        if (error || !community) {
          console.error("[auto-join] community upsert failed:", error ?? "no id returned");
          return null;
        }
        return community as { id: string };
      })
    );

    const valid = upserted.filter((c): c is { id: string } => Boolean(c));

    if (valid.length) {
      const { error: memberError } = await db
        .from("community_members")
        .upsert(
          valid.map((community) => ({ community_id: community.id, user_id: userId })),
          { onConflict: "community_id,user_id", ignoreDuplicates: true }
        );
      if (memberError) {
        console.error("[auto-join] membership upsert failed:", memberError);
      } else {
        for (const community of valid) joinedCommunities.push(community.id);
      }
    }
  }

  // ── 5. Mark the profile so dashboard repair runs only once ──
  if (profile) {
    await db
      .from("designer_profiles")
      .update({ communities_auto_joined: true })
      .eq("user_id", userId);
  }

  return joinedCommunities;
}
