import type { JobApplicant } from "./types";

/**
 * Where the board's design-mode card points: the first application in the tab
 * the poster is looking at, falling back to the whole list when that tab is
 * empty — a tab with nothing left in it is not an empty posting. A posting
 * with no applications at all has nothing to open, so the href is null and the
 * card stays off the page rather than being built from an applicant that does
 * not exist.
 */
export function designModeHref(
  jobId: string,
  visible: JobApplicant[],
  applicants: JobApplicant[]
): string | null {
  const lead = visible.length > 0 ? visible[0] : applicants[0];
  return lead ? `/applications/${jobId}/${lead.id}` : null;
}
