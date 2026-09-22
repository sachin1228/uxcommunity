/**
 * Trending topics — the homepage rail's "what members are posting about" card.
 *
 * A topic *is* a thread tag: the composer already lets an author attach up to
 * three topics to a thread, so the tags used in the recent window ARE the trend
 * list. That keeps one source of truth — there is no separate taxonomy table to
 * seed, translate or keep in sync with what members actually write.
 *
 * Pure helpers only (no DB, no React) so the ranking rules can be unit tested
 * without a Supabase connection. The query lives in home-sidebar-server.ts.
 */

/** How far back a thread counts towards the trend. */
export const TRENDING_WINDOW_DAYS = 7;

/**
 * Threads scanned per build. A backstop, not a page size: a runaway week must
 * not turn one cached read into an unbounded table scan. The newest threads are
 * read first, so the cap drops the *oldest* tail of the window.
 */
export const TRENDING_MAX_THREADS = 2000;

/** Topics shown in the card. */
export const TRENDING_LIMIT = 5;

/** Longest tag the thread composer accepts; anything longer is not a real tag. */
const MAX_TOPIC_LENGTH = 30;

export interface TrendingTopic {
  /** Label as the author wrote it (first spelling seen in the window). */
  topic: string;
  /** Public threads in the window carrying this tag. */
  post_count: number;
  /** Share of the window's tagged threads, to one decimal (e.g. 12.4). */
  share: number;
}

export interface TrendingThreadRow {
  tags?: readonly unknown[] | null;
}

/** Trims a raw tag into a display label, or null when it is not a usable one. */
export function normalizeTopic(raw: string): string | null {
  const topic = raw.trim().replace(/^#+/, "").replace(/\s+/g, " ");
  if (!topic || topic.length > MAX_TOPIC_LENGTH) return null;
  return topic;
}

/**
 * Ranks the tags of `rows` by how many threads used them.
 *
 * Rows are expected newest-first (the query orders them that way) so the label
 * kept for a topic is its most recent spelling — "ux research" typed last week
 * beats "UX Research" from a month ago. Grouping is case-insensitive, and the
 * same tag twice on one thread still counts as one post.
 */
export function aggregateTrendingTopics(
  rows: readonly TrendingThreadRow[],
  limit: number = TRENDING_LIMIT,
): TrendingTopic[] {
  const counts = new Map<string, { label: string; count: number }>();
  let taggedThreads = 0;

  for (const row of rows) {
    const seen = new Set<string>();
    for (const raw of row.tags ?? []) {
      if (typeof raw !== "string") continue;
      const label = normalizeTopic(raw);
      if (!label) continue;
      const key = label.toLowerCase();
      // One thread contributes at most one post to a topic, however it spelled
      // the tag twice.
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { label, count: 1 });
    }
    if (seen.size > 0) taggedThreads += 1;
  }

  if (taggedThreads === 0) return [];

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, Math.max(limit, 0))
    .map((entry) => ({
      topic: entry.label,
      post_count: entry.count,
      share: Math.round((entry.count / taggedThreads) * 1000) / 10,
    }));
}
