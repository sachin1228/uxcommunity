import "server-only";
import type { createServiceClient } from "@/lib/supabase/service";
import { loadJoinSlots } from "@/lib/communities/join-slots";

/**
 * What the member has used of each creation budget.
 *
 * The database is still the referee — this only reads the same numbers the
 * triggers read so the header can show them. Two mirrors matter:
 *
 *   * The UTC windows are recomputed here exactly like
 *     `public.creation_window_start`, because the budgets are calendar-based.
 *   * Posts, events and jobs count LIVE rows (deleting one frees its slot),
 *     which is what `public.count_live_creations` does once
 *     20261022190000_creation_limits_refund.sql is applied. Counting them
 *     here rather than calling that helper keeps this readable both before
 *     and after the migration.
 *
 * The limits themselves come from `public.creation_limits`, so tuning a
 * budget with SQL shows up here without a deploy.
 */

export const BUDGET_KINDS = [
  "posts_daily",
  "events_monthly",
  "jobs_monthly",
  "dms_monthly",
  "communities_total",
  "community_joins",
] as const;

export type BudgetKind = (typeof BUDGET_KINDS)[number];

export interface CreationUsage {
  kind: BudgetKind;
  used: number;
  limit: number;
}

type Db = ReturnType<typeof createServiceClient>;

/** Mirrors public.creation_window_start('day'). */
function utcDayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/** Mirrors public.creation_window_start('month'). */
function utcMonthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** A count that could not be read is missing from the panel, never shown as zero. */
async function readCount(query: PromiseLike<{ count: number | null; error: { message: string } | null }>, relation: string): Promise<number | null> {
  const { count, error } = await query;
  if (error) {
    console.error(`[creation-usage] ${relation}:`, error.message);
    return null;
  }
  return count ?? 0;
}

const headCount = { count: "exact", head: true } as const;

export async function loadCreationUsage(
  db: Db,
  userId: string
): Promise<{ limits: CreationUsage[]; pendingJoinRequests: number }> {
  // The generated types predate these three relations (the jobs feature talks
  // to RPCs, and the budget tables arrived with the creation-limits set).
  const from = (relation: string) => (db.from as any)(relation);
  const now = new Date();
  const dayStart = utcDayStart(now);
  const monthStart = utcMonthStart(now);
  const monthKey = monthStart.slice(0, 7);

  const [budgetRows, threads, showcase, resources, events, jobs, dmRow, owned, slots] =
    await Promise.all([
      from("creation_limits").select("kind, limit_count"),
      readCount(
        db.from("community_threads").select("id", headCount).eq("user_id", userId).gte("created_at", dayStart),
        "community_threads"
      ),
      readCount(
        db.from("community_showcase_posts").select("id", headCount).eq("user_id", userId).gte("created_at", dayStart),
        "community_showcase_posts"
      ),
      readCount(
        db.from("community_resources").select("id", headCount).eq("user_id", userId).gte("created_at", dayStart),
        "community_resources"
      ),
      readCount(
        db.from("community_events").select("id", headCount).eq("user_id", userId).gte("created_at", monthStart),
        "community_events"
      ),
      readCount(
        from("job_posts").select("id", headCount).eq("poster_id", userId).gte("created_at", monthStart),
        "job_posts"
      ),
      from("usage_counters")
        .select("count")
        .eq("user_id", userId)
        .eq("kind", "dms_monthly")
        .eq("period_key", monthKey)
        .maybeSingle(),
      // The sidebar's own test: live, and the owner still inside it.
      readCount(
        db
          .from("communities")
          .select("id, community_members!inner(user_id)", headCount)
          .eq("owner_id", userId)
          .eq("type", "user")
          .eq("is_active", true)
          .eq("community_members.user_id", userId),
        "owned communities"
      ),
      loadJoinSlots(db, userId),
    ]);

  if (budgetRows.error) {
    console.error("[creation-usage] creation_limits:", budgetRows.error.message);
  }
  const configured = new Map<string, number>(
    (budgetRows.data ?? []).map((row: { kind: string; limit_count: number }) => [
      row.kind,
      row.limit_count,
    ])
  );
  const limitFor = (kind: BudgetKind) => configured.get(kind) ?? null;

  const dmCount: number | null = dmRow.error ? null : ((dmRow.data?.count as number | undefined) ?? 0);

  // No guessed numbers: a budget whose row is missing from creation_limits is
  // left out, so the panel never shows what the database is not enforcing.
  const entries: Array<[BudgetKind, number | null, number | null]> = [
    [
      "posts_daily",
      threads === null || showcase === null || resources === null
        ? null
        : threads + showcase + resources,
      limitFor("posts_daily"),
    ],
    ["events_monthly", events, limitFor("events_monthly")],
    ["jobs_monthly", jobs, limitFor("jobs_monthly")],
    ["dms_monthly", dmCount, limitFor("dms_monthly")],
    ["communities_total", owned, limitFor("communities_total")],
    ["community_joins", slots.memberships, limitFor("community_joins")],
  ];

  return {
    limits: entries
      .filter(
        (entry): entry is [BudgetKind, number, number] =>
          entry[1] !== null && entry[2] !== null
      )
      .map(([kind, used, limit]) => ({ kind, used, limit })),
    pendingJoinRequests: slots.pendingRequests,
  };
}
