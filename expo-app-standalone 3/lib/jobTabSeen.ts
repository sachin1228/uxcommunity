import AsyncStorage from '@react-native-async-storage/async-storage';
import type { JobKind, JobPost } from './jobs';

/**
 * The jobs board's per-tab "N new" watermarks — the mobile counterpart of the
 * web board's localStorage cut-off. One value per (member, browse kind): the
 * newest posting instant that member has seen. Values come from the postings'
 * own server timestamps, never the device clock, so the count and the list
 * can never disagree.
 */

type Seen = Partial<Record<JobKind, number>>;

const storageKey = (userId: string) => `@jobs/seen/${userId}`;

export async function readJobTabSeen(userId: string): Promise<Seen> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as Seen) : {};
  } catch {
    return {};
  }
}

/** The newest posting instant in a list, or 0 for an empty one. */
export function newestInstant(jobs: JobPost[]): number {
  return jobs.reduce((max, job) => Math.max(max, Date.parse(job.created_at)), 0);
}

/** Advance one kind's cut-off; only ever forward, and never from an empty list. */
export async function markJobTabSeen(
  userId: string,
  kind: JobKind,
  newestPosted: number,
): Promise<void> {
  if (!(newestPosted > 0)) return;
  try {
    const seen = await readJobTabSeen(userId);
    if ((seen[kind] ?? 0) >= newestPosted) return;
    seen[kind] = newestPosted;
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(seen));
  } catch {
    // Storage unavailable: the badge simply reappears next visit.
  }
}

/** How many of a browse list post-date the stored cut-off. */
export function countNewSince(jobs: JobPost[], seen: number | undefined): number {
  return jobs.filter((job) => Date.parse(job.created_at) > (seen ?? 0)).length;
}
