/**
 * The identity slots behind the identity editor — a port of the web's
 * `lib/profile/identity.ts`: the types and the pure naming/cooldown rules
 * every surface must agree on (the API calls live in ./profile).
 *
 * Signup picks the details that also place a member in an official group —
 * name, job title, experience level, city and industry sector — and
 * `autoJoinCommunities()` turns the group-bearing ones into communities.
 * Editing them again is under a three-month per-slot cooldown
 * (`profile_field_changes`); the database is the authority and re-checks on
 * write, these helpers only drive the UI.
 */

/** One cooldown slot per editable field; each can change once every three months. */
export type IdentitySlot = 'name' | 'job_title' | 'experience_level' | 'city' | 'sector';

/** The profile dimensions that place a member in an official group. */
export type IdentityDimension = 'city' | 'sector' | 'experience_level' | 'job_title';

/** A selectable master-data value (city/sector uuid, level/title slug). */
export interface ProfileOption {
  id: string;
  name: string;
  image_url: string | null;
}

/** A community as the editor shows it — gone or gained. */
export interface OfficialGroup {
  id: string;
  name: string;
  image_url: string | null;
}

/** Everything the identity editor needs, served by GET /api/profile/identity. */
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
  groups: Record<IdentityDimension, OfficialGroup | null>;
}

/** The RPC's report after a successful edit (`PATCH /api/profile/identity`). */
export interface IdentityUpdateResult {
  changed_fields: IdentitySlot[];
  left_communities: OfficialGroup[];
  joined_communities: OfficialGroup[];
}

/** One label per slot, shared by the lock notes and the review sheet. */
export const SLOT_LABEL: Record<IdentitySlot, string> = {
  name: 'Name',
  job_title: 'Job Title',
  experience_level: 'Experience Level',
  city: 'City',
  sector: 'Industry Sector',
};

/**
 * The date a slot changed at `changedAt` unlocks again — three calendar
 * months later, clamped to the target month's last day, exactly like the
 * RPC's `changed_at + interval '3 months'` (Jan 31 → Apr 30, not May 1).
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
 * community-free on purpose: a catch-all pick produces no group.
 */
export function isCatchAllName(name: string | null | undefined): boolean {
  return (name ?? '').trim().toLowerCase() === 'other';
}

/**
 * The name of the official group a master-data value implies.
 * Must stay in lockstep with `auto-join.ts` and `update_profile_identity()`:
 * cities read "{City} Designers", sectors "{Sector} Community", and
 * experience levels / job titles carry the admin-managed name as-is.
 */
export function officialGroupName(dimension: IdentityDimension, masterName: string): string {
  if (dimension === 'city') return `${masterName} Designers`;
  if (dimension === 'sector') return `${masterName} Community`;
  return masterName;
}

/** The group a not-yet-saved selection will produce, for the review sheet. */
export function previewGroup(
  dimension: IdentityDimension,
  option: ProfileOption,
): { name: string; image_url: string | null } | null {
  if (isCatchAllName(option.name)) return null;
  return { name: officialGroupName(dimension, option.name), image_url: option.image_url };
}

/** "Jun 15, 2027" — UTC, so the date shown is the date stored. */
export function formatUnlockDate(iso: string | Date): string {
  const date = new Date(iso);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()];
  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}
