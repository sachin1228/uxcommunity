import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { logEvent } from "@/lib/observability/log";
import { revokeRealtimeCommunityMembership } from "./revoke";

type Db = SupabaseClient<Database>;

export interface PendingMembershipRevocation {
  id: string;
  userId: string;
  communityId: string;
  attempts: number;
  /** Generation marker: a later removal reopens the row with a new value. */
  createdAt: string;
}

export interface ProcessSummary {
  scanned: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface ProcessDeps {
  now: () => number;
  isStillMember: (item: PendingMembershipRevocation) => Promise<boolean>;
  revoke: (item: PendingMembershipRevocation) => Promise<boolean>;
  markCompleted: (item: PendingMembershipRevocation) => Promise<void>;
  reschedule: (
    item: PendingMembershipRevocation,
    attempts: number,
    nextAttemptAt: string,
    lastError: string,
  ) => Promise<void>;
}

/**
 * Exponential backoff with a hard ceiling. A removal is not dropped after N
 * attempts: the queue keeps checking at most hourly until the realtime Worker
 * confirms the close, or the membership check shows the member has rejoined.
 */
export function nextAttemptDelaySeconds(attempts: number): number {
  const exponent = Math.min(Math.max(Math.floor(attempts), 0), 8);
  return Math.min(3600, 15 * 2 ** exponent);
}

/**
 * Process due rows. A row whose member is back in the community is completed
 * without closing anything: the removed sockets are no longer legitimate, but
 * the new membership has fresh sockets that may have been opened after a
 * rejoin. Revoking in that case would disconnect a legitimate member.
 */
export async function processRevocationRows(
  items: readonly PendingMembershipRevocation[],
  deps: ProcessDeps,
): Promise<ProcessSummary> {
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of items) {
    if (await deps.isStillMember(item)) {
      await deps.markCompleted(item);
      completed += 1;
      skipped += 1;
      continue;
    }

    const ok = await deps.revoke(item);
    if (ok) {
      await deps.markCompleted(item);
      completed += 1;
      continue;
    }

    const attempts = item.attempts + 1;
    const nextAttemptAt = new Date(
      deps.now() + nextAttemptDelaySeconds(item.attempts) * 1000,
    ).toISOString();
    await deps.reschedule(item, attempts, nextAttemptAt, "realtime revocation failed");
    failed += 1;
  }

  return { scanned: items.length, completed, failed, skipped };
}

async function markCompleted(
  db: Db,
  item: PendingMembershipRevocation,
): Promise<void> {
  // The created_at guard makes this a no-op if a later removal reopened the
  // row after this batch was selected. That later removal keeps its own
  // pending row instead of being completed by a stale processor.
  const { error } = await db
    .from("realtime_membership_revocations")
    .update({ completed_at: new Date().toISOString(), last_error: null })
    .eq("user_id", item.userId)
    .eq("community_id", item.communityId)
    .eq("created_at", item.createdAt)
    .is("completed_at", null);
  if (error) throw new Error(`complete membership revocation failed: ${error.message}`);
}

async function reschedule(
  db: Db,
  item: PendingMembershipRevocation,
  attempts: number,
  nextAttemptAt: string,
  lastError: string,
): Promise<void> {
  const { error } = await db
    .from("realtime_membership_revocations")
    .update({
      attempts,
      next_attempt_at: nextAttemptAt,
      last_error: lastError,
    })
    .eq("user_id", item.userId)
    .eq("community_id", item.communityId)
    .eq("created_at", item.createdAt)
    .is("completed_at", null);
  if (error) throw new Error(`reschedule membership revocation failed: ${error.message}`);
}

/**
 * Best-effort immediate close after the membership row is gone.
 *
 * Deliberately does NOT touch the queue row: the row is the durable record and
 * the cron processor owns completion/backoff. Marking it here could complete a
 * later removal that reopened the same (user, community) row in the meantime.
 * A duplicate /revoke from the cron is idempotent.
 */
export async function attemptMembershipRevocationNow(
  userId: string,
  communityId: string,
  revoke: typeof revokeRealtimeCommunityMembership = revokeRealtimeCommunityMembership,
): Promise<boolean> {
  return revoke({ userId, communityId });
}

/**
 * Claim a bounded batch of due rows and process it. Called by the realtime
 * Worker's minute cron through the internal endpoint, never by a client.
 */
export async function processDueMembershipRevocations(
  db: Db,
  options: {
    limit?: number;
    now?: number;
    revoke?: (item: PendingMembershipRevocation) => Promise<boolean>;
  } = {},
): Promise<ProcessSummary> {
  const now = options.now ?? Date.now();
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 25);
  const revoke =
    options.revoke ??
    ((item: PendingMembershipRevocation) =>
      revokeRealtimeCommunityMembership({
        userId: item.userId,
        communityId: item.communityId,
      }));

  const { data, error } = await db
    .from("realtime_membership_revocations")
    .select("id, user_id, community_id, attempts, created_at")
    .is("completed_at", null)
    .lte("next_attempt_at", new Date(now).toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`list membership revocations failed: ${error.message}`);

  const items: PendingMembershipRevocation[] = (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    communityId: row.community_id,
    attempts: row.attempts,
    createdAt: row.created_at,
  }));

  const summary = await processRevocationRows(items, {
    now: () => now,
    isStillMember: async (item) => {
      const { data: member, error: memberError } = await db
        .from("community_members")
        .select("user_id")
        .eq("community_id", item.communityId)
        .eq("user_id", item.userId)
        .maybeSingle();
      if (memberError) {
        throw new Error(`membership revalidation failed: ${memberError.message}`);
      }
      return member !== null;
    },
    revoke,
    markCompleted: (item) => markCompleted(db, item),
    reschedule: (item, attempts, nextAttemptAt, lastError) =>
      reschedule(db, item, attempts, nextAttemptAt, lastError),
  });

  if (summary.scanned > 0) {
    logEvent("info", {
      event: "realtime.membership_revocation.run",
      scanned: summary.scanned,
      completed: summary.completed,
      failed: summary.failed,
      skipped: summary.skipped,
    });
  }
  return summary;
}
