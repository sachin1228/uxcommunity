import type { CachedSidebarCommunity } from "@/lib/communities/cache";

/**
 * Short kind tag shown ahead of a suggested community's member count
 * ("Interest · 32.7k members"). Master-data communities carry no reference
 * name on the explore payload, so the tag is just the community's kind —
 * member-created communities read as "Member-led", as they do in Explore.
 */
const TYPE_TAGS: Record<CachedSidebarCommunity["type"], string> = {
  city: "City",
  sector: "Industry",
  interest: "Interest",
  experience_level: "Experience",
  job_title: "Job Title",
  general: "General",
  user: "Member-led",
};

export function communityTag(type: string): string {
  return TYPE_TAGS[type as CachedSidebarCommunity["type"]] ?? "Community";
}

/**
 * 812 → "812", 32_700 → "32.7k", 1_200_000 → "1.2M" (drops a trailing ".0").
 * Same shape as the Following rows' member line, so the two lists read alike.
 */
export function formatMemberCount(count: number): string {
  if (count >= 1_000_000) return `${+(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${+(count / 1_000).toFixed(1)}k`;
  return String(count);
}

/** "32.7k members" — singular for a community whose only member is its owner. */
export function memberCountLabel(count: number): string {
  return `${formatMemberCount(count)} ${count === 1 ? "member" : "members"}`;
}
