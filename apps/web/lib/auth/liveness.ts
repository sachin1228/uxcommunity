/**
 * Pure liveness decision for a session's account row.
 *
 * Deleted rows and blocked rows are both inactive. Kept separate from the
 * Supabase read so the rule is unit-tested without a database.
 */
export interface ActiveUserRow {
  is_blocked: boolean;
}

export function isActiveUserRow(
  row: ActiveUserRow | null | undefined,
): row is ActiveUserRow {
  return Boolean(row) && row!.is_blocked !== true;
}
