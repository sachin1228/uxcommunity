import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceClient } from "@/lib/supabase/service";

/**
 * The moderation audit trail.
 *
 * Every decision the queue takes goes through `recordModerationAction`, which
 * writes exactly one append-only row: who acted, what they did, the target,
 * the report, the account affected, the previous and new state, the reason and
 * the timestamp. The table has no UPDATE/DELETE grant and a database trigger
 * rejects both, so a record cannot be edited from the app or from SQL.
 *
 * `moderator_id` is null for the shared admin login (it has no users row);
 * `moderator_sid` always names the admin session, so an action is still
 * attributable to the session that took it.
 */

export const MODERATION_AUDIT_ACTIONS = [
  "dismiss_report",
  "remove_content",
  "hide_community",
  "deactivate_job",
  "warn_user",
  "suspend_user",
  "ban_user",
  "unban_user",
  "lift_suspension",
  "grant_appeal",
  "deny_appeal",
  "delete_user",
  "review_dm_report",
  "reopen_dm_report",
  "restore_content",
  "reopen_report",
  "toggle_community",
  "delete_community",
  "toggle_job",
  "delete_job",
  "delete_event",
  "review_verification",
] as const;

export type ModerationAuditAction = (typeof MODERATION_AUDIT_ACTIONS)[number];

export interface ModerationAuditRow {
  id: string;
  moderator_id: string | null;
  /** Captured at action time, so deletion of the moderator account keeps attribution. */
  moderator_label: string | null;
  moderator_sid: string | null;
  action: ModerationAuditAction;
  target_type: string;
  target_id: string | null;
  report_id: string | null;
  subject_user_id: string | null;
  previous_state: Record<string, unknown>;
  new_state: Record<string, unknown>;
  reason: string | null;
  created_at: string;
}

export interface ModerationAuditInput {
  moderatorId: string | null;
  /** Optional display-name snapshot; resolved from the account when omitted. */
  moderatorLabel?: string | null;
  moderatorSid: string;
  action: ModerationAuditAction;
  targetType: string;
  targetId: string | null;
  reportId: string | null;
  subjectUserId: string | null;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  reason?: string | null;
}

function auditTable(db: ServiceClient) {
  return (db as unknown as SupabaseClient).from("moderation_audit_log");
}

/**
 * Append one audit row. Throws when the insert fails so the caller can surface
 * the failure instead of reporting a decision that was never recorded.
 */
export async function recordModerationAction(
  db: ServiceClient,
  input: ModerationAuditInput,
): Promise<void> {
  // Snapshot the moderator's name now. `moderator_id` is a historical id that
  // account deletion no longer rewrites, so without this a deleted moderator
  // account would make an old decision look like it was taken by the platform
  // admin. A lookup failure must not block the decision: the id and session id
  // are still recorded.
  let moderatorLabel = input.moderatorLabel ?? null;
  if (!moderatorLabel && input.moderatorId) {
    const { data, error } = await db
      .from("users")
      .select("name")
      .eq("id", input.moderatorId)
      .maybeSingle();
    if (!error) moderatorLabel = data?.name?.trim() || null;
  }
  if (!moderatorLabel && !input.moderatorId) moderatorLabel = "Platform admin";

  const { error } = await auditTable(db).insert({
    moderator_id: input.moderatorId,
    moderator_label: moderatorLabel,
    moderator_sid: input.moderatorSid,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    report_id: input.reportId,
    subject_user_id: input.subjectUserId,
    previous_state: input.previousState ?? {},
    new_state: input.newState ?? {},
    reason: input.reason ?? null,
  });

  if (error) {
    console.error("[moderation/audit] insert failed:", error);
    throw new Error("Failed to record the moderation action.");
  }
}

/** Every audited action taken against one target, newest first. */
export async function loadTargetAudit(
  db: ServiceClient,
  targetType: string,
  targetId: string,
  limit = 20,
): Promise<ModerationAuditRow[]> {
  const { data, error } = await auditTable(db)
    .select("*")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[moderation/audit] target read failed:", error);
    return [];
  }
  return (data ?? []) as unknown as ModerationAuditRow[];
}

export interface AuditFeedFilters {
  targetType?: string;
  targetId?: string;
  action?: string;
  reportId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** The admin audit page's paged feed, with the moderator's display name. */
export async function loadAuditFeed(
  db: ServiceClient,
  filters: AuditFeedFilters,
): Promise<{ rows: Array<ModerationAuditRow & { moderator_name: string | null }>; total: number }> {
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
  const page = Math.max(1, filters.page ?? 1);

  let query = auditTable(db).select("*", { count: "exact" });
  if (filters.targetType) query = query.eq("target_type", filters.targetType);
  if (filters.targetId) query = query.eq("target_id", filters.targetId);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.reportId) query = query.eq("report_id", filters.reportId);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (error) {
    console.error("[moderation/audit] feed read failed:", error);
    return { rows: [], total: 0 };
  }

  const rows = (data ?? []) as unknown as ModerationAuditRow[];
  const moderatorIds = [
    ...new Set(rows.map((row) => row.moderator_id).filter((id): id is string => Boolean(id))),
  ];

  let names = new Map<string, string>();
  if (moderatorIds.length > 0) {
    const { data: users } = await db
      .from("users")
      .select("id, name")
      .in("id", moderatorIds);
    names = new Map((users ?? []).map((user) => [user.id, user.name ?? ""]));
  }

  return {
    rows: rows.map((row) => ({
      ...row,
      moderator_name:
        row.moderator_label ??
        (row.moderator_id
          ? names.get(row.moderator_id) ?? "Former moderator"
          : "Platform admin"),
    })),
    total: count ?? 0,
  };
}
