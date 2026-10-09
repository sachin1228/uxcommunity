import type { SupabaseClient } from "@supabase/supabase-js";
import { getExperienceLevelNameMap } from "@/lib/master-data-cache";
import { cleanDesignation } from "@/lib/communities/comment-authors";

/**
 * The seniority half of the role pill. Experience levels are managed in master
 * data as list headings ("Mid-Level Designers"), so the trailing "Designer(s)"
 * noun is dropped — the designation beside it supplies the noun and the pill
 * reads "Mid-Level Product Designer", not "Mid-Level Designer Product Designer".
 * Labels without that tail are cleaned but kept whole.
 */
function seniorityLabel(levelName: string): string {
  const cleaned = cleanDesignation(levelName);
  const withoutNoun = cleaned.replace(/\s+designers?$/i, "").trim();
  return withoutNoun || cleaned;
}

/**
 * The role pill beside a member's name: seniority and designation composed
 * together ("Mid-Level Product Designer"), or null when neither is set.
 *
 * The job title and the experience level are slugs (no PostgREST embed), so
 * they are resolved against the job-titles table and the cached
 * experience-levels master table. Shared by the owner's profile page and the
 * member profile page so the two can never disagree on how the pill reads.
 */
export async function resolveProfileRoleLabel(
  db: SupabaseClient,
  jobTitleSlug: string | null,
  experienceLevelSlug: string | null,
): Promise<string | null> {
  let jobTitleName: string | null = null;
  if (jobTitleSlug) {
    const { data: jobTitle } = await db
      .from("job_titles")
      .select("name")
      .eq("slug", jobTitleSlug)
      .maybeSingle();
    jobTitleName = jobTitle?.name ?? jobTitleSlug;
  }

  const experienceLevelName = experienceLevelSlug
    ? (await getExperienceLevelNameMap())[experienceLevelSlug] ?? experienceLevelSlug
    : null;

  return (
    [experienceLevelName ? seniorityLabel(experienceLevelName) : null, jobTitleName]
      .filter(Boolean)
      .join(" ") || null
  );
}
