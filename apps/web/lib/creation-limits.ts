/**
 * Creation limits — the app side of the database budgets.
 *
 * The budgets themselves live in `public.creation_limits` and are enforced
 * by triggers (see supabase/migrations/20261013120000_creation_limits.sql).
 * When a limit is hit the database raises a P0001 whose message is
 * `limit:<kind>`; this module turns that machine-stable message into the
 * user-facing copy and nothing else needs to parse prose.
 */

export const CREATION_LIMIT_MESSAGES = {
  posts_daily:
    "You've reached today's limit of 3 posts. You can post again tomorrow.",
  events_monthly:
    "You can create one event per month. You can host the next one next month.",
  jobs_monthly: "You can post one job per month. Try again next month.",
  dms_monthly:
    "You can start conversations with up to 5 new people a month. Try again next month.",
  communities_total: "You can only create one community on your profile.",
  community_joins:
    "You can be in up to 7 communities at a time — leave one to join another.",
} as const;

export type CreationLimitKind = keyof typeof CREATION_LIMIT_MESSAGES;

/** The limit kind a PostgREST error stands for, or null when it is not one. */
export function creationLimitFromError(
  error: { message?: string | null } | null | undefined
): CreationLimitKind | null {
  const message = (error?.message ?? "").trim().split("\n")[0].trim();
  if (!message.startsWith("limit:")) return null;
  const kind = message.slice("limit:".length);
  return kind in CREATION_LIMIT_MESSAGES ? (kind as CreationLimitKind) : null;
}
