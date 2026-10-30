/**
 * Pure liveness decision for a session's account row.
 *
 * Deleted rows, blocked rows and accounts inside a temporary suspension are
 * all inactive. Kept separate from the Supabase read so the rule is
 * unit-tested without a database.
 */
export interface ActiveUserRow {
  is_blocked: boolean;
  /** ISO timestamp; a future value means the account is suspended. */
  suspended_until?: string | null;
}

/** True while `suspended_until` is a real instant in the future. */
export function isSuspended(
  suspendedUntil: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!suspendedUntil) return false;
  const until = Date.parse(suspendedUntil);
  return Number.isFinite(until) && until > now;
}

export function isActiveUserRow(
  row: ActiveUserRow | null | undefined,
  now = Date.now(),
): row is ActiveUserRow {
  return (
    Boolean(row) &&
    row!.is_blocked !== true &&
    !isSuspended(row!.suspended_until, now)
  );
}
