import type { CachedSidebarCommunity } from "@/lib/communities/cache";

/**
 * Short category tag shown above a community name in the sidebar
 * ("Interest · 32.7K members").
 *
 * Master-data communities carry their reference name (the interest, city,
 * sector, experience level or job title they were generated from), which reads
 * like the mock's category tag. The community can be renamed after it is
 * created, so the reference name is only used when it still differs from the
 * community name — otherwise the row would read "Accessibility · Accessibility".
 * Member-created communities have no reference and fall back to their kind.
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

export function communityTag(c: {
  name: string;
  type: string;
  reference_name?: string | null;
}): string {
  const reference = c.reference_name?.trim();
  if (reference && reference.toLowerCase() !== c.name.trim().toLowerCase()) {
    return reference;
  }
  return TYPE_TAGS[c.type as CachedSidebarCommunity["type"]] ?? "Community";
}

/** 812 → "812", 32_700 → "32.7K", 1_200_000 → "1.2M" (drops trailing ".0"). */
export function formatMemberCount(count: number): string {
  if (count >= 1_000_000) return `${+(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${+(count / 1_000).toFixed(1)}K`;
  return String(count);
}

/** "32.7K members" — singular for a community whose only member is its owner. */
export function memberCountLabel(count: number): string {
  return `${formatMemberCount(count)} ${count === 1 ? "member" : "members"}`;
}

/** The full muted meta line: "Interest · 32.7K members". */
export function communityMetaLine(c: {
  name: string;
  type: string;
  reference_name?: string | null;
  member_count: number;
}): string {
  return `${communityTag(c)} · ${memberCountLabel(c.member_count)}`;
}
