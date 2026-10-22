/**
 * Creation limits — the app side of the database budgets.
 *
 * The budgets themselves live in `public.creation_limits` and are enforced
 * by triggers (see supabase/migrations/20261013120000_creation_limits.sql
 * and 20261022190000_creation_limits_refund.sql, which sets the current
 * numbers and makes deleting content hand the budget back). When a limit is
 * hit the database raises a P0001 whose message is `limit:<kind>`; this
 * module turns that machine-stable message into the user-facing copy and
 * nothing else needs to parse prose.
 */

export const CREATION_LIMIT_MESSAGES = {
  posts_daily:
    "You've reached today's limit of 3 posts. Delete one to post again, or come back tomorrow.",
  events_monthly:
    "You can create 5 events per month. Delete one to host another, or try again next month.",
  jobs_monthly:
    "You can post 3 jobs per month. Delete one to post another, or try again next month.",
  dms_monthly:
    "You can start conversations with up to 5 new people a month. Try again next month.",
  communities_total:
    "You can have up to 5 communities of your own — delete one to create a new one.",
  community_joins:
    "You can be in up to 10 communities at a time — leave one to join another.",
  // Route-side only: the create-community flow speaks in "creating your own"
  // terms, while the database raises the generic join-cap kind for it.
  create_at_join_cap:
    "You're in 10 communities already — leave one before creating your own.",
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
