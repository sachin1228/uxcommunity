/**
 * The identity slots behind the Edit Profile modal.
 *
 * Signup picks the four things that also place a member in an official group
 * — name, designation (experience level + job title), city and sector — and
 * `autoJoinCommunities()` turns the last three into communities. The modal
 * lets a member change them again, under a three-month cooldown per slot
 * (`profile_field_changes`), swapping the memberships the change implies.
 *
 * This file is the client-safe half: the types the page, the API and the
 * modal share, plus the two naming rules that must match `auto-join.ts` and
 * the `update_profile_identity()` RPC exactly — the catch-all skip and the
 * "City Designers" / "Sector Community" name patterns. Pure, no server
 * imports, so the unit test can pin the formulas.
 */

/** One cooldown per slot; designation covers experience level AND job title. */
export type IdentitySlot = "name" | "designation" | "city" | "sector";

/** The profile dimensions that place a member in an official group. */
export type IdentityDimension = "city" | "sector" | "experience_level" | "job_title";

/** A selectable master-data value (city/sector uuid, level/title slug). */
export interface ProfileOption {
  id: string;
  name: string;
  image_url: string | null;
}

/** A community as the modal shows it — gone or gained. */
export interface OfficialGroup {
  id: string;
  name: string;
  image_url: string | null;
}

/** Everything the Edit Profile modal needs, loaded by the profile page. */
export interface ProfileIdentityPayload {
  current: {
    name: string;
    city_id: string | null;
    sector_id: string | null;
    experience_level: string | null;
    job_title: string | null;
  };
  /** Slot → ISO timestamp it unlocks; absent means "can change now". */
  locks: Partial<Record<IdentitySlot, string>>;
  options: {
    cities: ProfileOption[];
    sectors: ProfileOption[];
    levels: ProfileOption[];
    titles: ProfileOption[];
  };
  /** The member's current official group per dimension, when they hold one. */
  groups: Record<IdentityDimension, OfficialGroup | null>;
}

/** The RPC's report after a successful edit (`PATCH /api/profile/identity`). */
export interface IdentityUpdateResult {
  changed_fields: IdentitySlot[];
  left_communities: OfficialGroup[];
  joined_communities: OfficialGroup[];
}

/** The cooldown slot a dimension bills its change to. */
export function slotForDimension(dimension: IdentityDimension): IdentitySlot {
  return dimension === "experience_level" || dimension === "job_title" ? "designation" : dimension;
}

/**
 * The date a slot changed at `changedAt` unlocks again — three calendar
 * months later, clamped to the target month's last day, exactly like the
 * RPC's `changed_at + interval '3 months'` (Jan 31 → Apr 30, not May 1).
 * UTC arithmetic so the result does not depend on the viewer's timezone.
 * The database stays the authority (it re-checks on write); this only feeds
 * the modal's "Can change again on …" lock.
 */
export function slotUnlockDate(changedAt: string | Date): Date {
  const from = new Date(changedAt);
  const day = from.getUTCDate();
  const unlock = new Date(from.getTime());
  unlock.setUTCDate(1);
  unlock.setUTCMonth(unlock.getUTCMonth() + 3);
  const lastDay = new Date(Date.UTC(unlock.getUTCFullYear(), unlock.getUTCMonth() + 1, 0)).getUTCDate();
  unlock.setUTCDate(Math.min(day, lastDay));
  return unlock;
}

/**
 * "Other" is the catch-all option in every master table, and it stays
 * community-free on purpose: those members are already in General. The
 * comparison trims and lowercases so a stray " Other " cannot slip past —
 * same rule as `auto-join.ts` and the RPC.
 */
export function isCatchAllName(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === "other";
}

/**
 * The name of the official group a master-data value implies.
 * Must stay in lockstep with `auto-join.ts` and `update_profile_identity()`:
 * cities read "{City} Designers", sectors "{Sector} Community", and
 * experience levels / job titles carry the admin-managed name as-is.
 */
export function officialGroupName(dimension: IdentityDimension, masterName: string): string {
  if (dimension === "city") return `${masterName} Designers`;
  if (dimension === "sector") return `${masterName} Community`;
  return masterName;
}

/**
 * The group a not-yet-saved selection will produce, for the live preview.
 * Catch-all "Other" selections produce no group (the member stays in General),
 * which the modal renders as "no group" rather than an empty row.
 */
export function previewGroup(
  dimension: IdentityDimension,
  option: ProfileOption,
): { name: string; image_url: string | null } | null {
  if (isCatchAllName(option.name)) return null;
  return { name: officialGroupName(dimension, option.name), image_url: option.image_url };
}
