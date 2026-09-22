/**
 * Trending posts — the homepage rail's "what is getting attention right now"
 * card.
 *
 * Pure scoring and ranking only (no DB, no React) so the rules can be reasoned
 * about and unit tested without a database. The query lives in
 * home-sidebar-server.ts.
 *
 * ── How a post earns its place ────────────────────────────────────────────────
 *
 * A post is a candidate while it is inside the window (TRENDING_WINDOW_DAYS),
 * and it ranks by how much engagement it has collected, faded by age:
 *
 *     score = (likes + comments) × 0.5 ^ (age in hours / HALF_LIFE_HOURS)
 *
 * Likes and comments count the same, because a long comment thread means the
 * post started a discussion — that is at least as strong a signal as a tap.
 *
 * The fade is what makes the card *trend* rather than *rank all-time*: a post
 * from six days ago needs roughly four times the engagement of one from today
 * to hold its place, so the list keeps moving as the week goes on and a single
 * early hit cannot sit at the top until the window expires. The exact score is
 * never shown — the card prints the raw like and comment counts, so the numbers
 * a member reads are always the real ones.
 */

/** How far back a post can be and still count as trending. */
export const TRENDING_WINDOW_DAYS = 7;

/** Posts shown in the card. */
export const TRENDING_POST_LIMIT = 5;

/**
 * Newest posts scanned per rebuild. A backstop, not a page size: engagement
 * counts for every candidate are aggregated in the database, but the candidate
 * list itself must stay bounded.
 */
export const TRENDING_MAX_CANDIDATES = 200;

/** Hours after which a post's engagement counts for half as much. */
export const TRENDING_HALF_LIFE_HOURS = 72;

const HOUR_MS = 60 * 60 * 1000;

export interface TrendingPostCandidate {
  id: string;
  title: string;
  community_id: string;
  created_at: string;
  like_count: number;
  comment_count: number;
}

/** A ranked post, with the community it lives in resolved for the card. */
export interface TrendingPost extends TrendingPostCandidate {
  community_name: string | null;
}

/** Likes plus comments — what a post has earned inside the window. */
export function engagementOf(candidate: TrendingPostCandidate): number {
  return Math.max(0, candidate.like_count) + Math.max(0, candidate.comment_count);
}

/** Engagement, faded by age. Exported so the weighting is testable. */
export function trendingScore(candidate: TrendingPostCandidate, now: number): number {
  const createdAt = Date.parse(candidate.created_at);
  // An unparseable date is treated as brand new rather than dropped: a post
  // with engagement should never become invisible because of a bad timestamp.
  const ageHours = Number.isFinite(createdAt)
    ? Math.max(0, (now - createdAt) / HOUR_MS)
    : 0;
  return engagementOf(candidate) * 0.5 ** (ageHours / TRENDING_HALF_LIFE_HOURS);
}

/**
 * The card's list: the highest-scoring posts, newest first when scores tie.
 *
 * Posts nobody has liked or commented on are skipped — an empty "trending"
 * row is worse than a shorter list, and the card says so in its empty state.
 */
export function rankTrendingPosts(
  candidates: readonly TrendingPostCandidate[],
  options: { now?: number; limit?: number } = {},
): TrendingPostCandidate[] {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? TRENDING_POST_LIMIT;

  return candidates
    .filter((candidate) => engagementOf(candidate) > 0)
    .map((candidate) => ({ candidate, score: trendingScore(candidate, now) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(b.candidate.created_at) - Date.parse(a.candidate.created_at) ||
        a.candidate.id.localeCompare(b.candidate.id),
    )
    .slice(0, Math.max(limit, 0))
    .map((entry) => entry.candidate);
}
