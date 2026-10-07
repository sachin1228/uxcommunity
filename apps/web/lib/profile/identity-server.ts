import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  slotUnlockDate,
  type IdentityDimension,
  type IdentitySlot,
  type OfficialGroup,
  type ProfileIdentityPayload,
} from "./identity";

/**
 * Loads everything the Edit Profile modal needs, for the profile page:
 * the current values, the option lists, the member's current official group
 * per dimension, and the per-slot cooldown dates.
 *
 * The cooldown rows live in `profile_field_changes`, created by the
 * profile-identity migration. Until that migration is applied the table is
 * missing — the loader then reports every slot as unlocked rather than
 * failing the page, and the RPC call is what would actually refuse.
 */

type OptionRow = { id: string; name: string; image_url: string | null };
type GroupRow = {
  id: string;
  name: string;
  image_url: string | null;
  type: string;
  reference_id: string | null;
};

const OFFICIAL_GROUP_TYPES = ["city", "sector", "experience_level", "job_title"] as const;

export async function loadProfileIdentity(userId: string): Promise<ProfileIdentityPayload> {
  const db = createServiceClient();

  const [userRes, profileRes, locksRes, citiesRes, sectorsRes, levelsRes, titlesRes, membersRes] =
    await Promise.all([
      db.from("users").select("name").eq("id", userId).maybeSingle(),
      db
        .from("designer_profiles")
        .select("city_id, sector_id, experience_level, job_title")
        .eq("user_id", userId)
        .maybeSingle(),
      db.from("profile_field_changes").select("field, changed_at").eq("user_id", userId),
      db.from("cities").select("id, name, image_url").eq("is_active", true).order("name"),
      db.from("design_sectors").select("id, name, image_url").eq("is_active", true).order("name"),
      db
        .from("experience_levels")
        .select("id, slug, name, image_url")
        .eq("is_active", true)
        .order("name"),
      db.from("job_titles").select("id, slug, name, image_url").eq("is_active", true).order("name"),
      db.from("community_members").select("community_id").eq("user_id", userId),
    ]);

  const profile = profileRes.data as {
    city_id: string | null;
    sector_id: string | null;
    experience_level: string | null;
    job_title: string | null;
  } | null;

  // Levels/titles are keyed by slug — the value the profile stores.
  const levels = ((levelsRes.data ?? []) as Array<OptionRow & { slug: string }>).map((r) => ({
    id: r.slug,
    name: r.name,
    image_url: r.image_url,
  }));
  const titles = ((titlesRes.data ?? []) as Array<OptionRow & { slug: string }>).map((r) => ({
    id: r.slug,
    name: r.name,
    image_url: r.image_url,
  }));

  // ── Cooldown locks (absent table = every slot free) ──
  const locks: Partial<Record<IdentitySlot, string>> = {};
  for (const row of (locksRes.data ?? []) as Array<{ field: string; changed_at: string }>) {
    const unlock = slotUnlockDate(row.changed_at);
    if (unlock.getTime() > Date.now()) locks[row.field as IdentitySlot] = unlock.toISOString();
  }

  // ── The member's current official groups ──
  const membershipIds = (membersRes.data ?? []).map((r) => r.community_id);
  let groupRows: GroupRow[] = [];
  if (membershipIds.length) {
    const { data } = await db
      .from("communities")
      .select("id, name, image_url, type, reference_id")
      .in("id", membershipIds)
      .in("type", [...OFFICIAL_GROUP_TYPES]);
    groupRows = (data ?? []) as GroupRow[];
  }

  const levelIdBySlug = new Map(
    ((levelsRes.data ?? []) as Array<{ id: string; slug: string }>).map((r) => [r.slug, r.id]),
  );
  const titleIdBySlug = new Map(
    ((titlesRes.data ?? []) as Array<{ id: string; slug: string }>).map((r) => [r.slug, r.id]),
  );

  const groupFor = (type: IdentityDimension, referenceId: string | null | undefined): OfficialGroup | null => {
    if (!referenceId) return null;
    const row = groupRows.find((g) => g.type === type && g.reference_id === referenceId);
    return row ? { id: row.id, name: row.name, image_url: row.image_url } : null;
  };

  return {
    current: {
      name: userRes.data?.name ?? "",
      city_id: profile?.city_id ?? null,
      sector_id: profile?.sector_id ?? null,
      experience_level: profile?.experience_level ?? null,
      job_title: profile?.job_title ?? null,
    },
    locks,
    options: {
      cities: (citiesRes.data ?? []) as OptionRow[],
      sectors: (sectorsRes.data ?? []) as OptionRow[],
      levels,
      titles,
    },
    groups: {
      city: groupFor("city", profile?.city_id),
      sector: groupFor("sector", profile?.sector_id),
      experience_level: groupFor("experience_level", levelIdBySlug.get(profile?.experience_level ?? "")),
      job_title: groupFor("job_title", titleIdBySlug.get(profile?.job_title ?? "")),
    },
  };
}
