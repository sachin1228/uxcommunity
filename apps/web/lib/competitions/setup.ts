/**
 * Competition schema provisioning guard.
 *
 * The feature ships as a migration that has to be applied to the database. On an
 * environment where it has not been applied yet, every competition query fails
 * with a PostgREST/Postgres schema error — and surfacing that raw object through
 * a server component produces an unreadable runtime error page for whoever
 * happens to open the page.
 *
 * This module turns "the tables/functions are not there" into one recognisable
 * case, so pages can explain what is missing and API routes can answer 503
 * instead of pretending a vote failed. Anything else is a real bug and is
 * re-thrown untouched.
 */

/** The migration that provisions the feature, for the operator-facing notice. */
export const COMPETITION_SETUP_MIGRATION = "supabase/migrations/20260919120000_weekly_designer_competitions.sql";

/**
 * PostgREST + Postgres codes that mean "this feature is not provisioned":
 *
 *   PGRST205  table not found in PostgREST's schema cache
 *   PGRST202  function not found in PostgREST's schema cache
 *   42P01     undefined_table
 *   42883     undefined_function
 *   42703     undefined_column (schema drift: an older version of the tables)
 */
const MISSING_SCHEMA_CODES = new Set(["PGRST205", "PGRST202", "42P01", "42883", "42703"]);

const MISSING_SCHEMA_MESSAGES = [
  "could not find the table",
  "could not find the function",
  "does not exist",
];

/** True when the error is the schema being absent, not a bug in the request. */
export function isCompetitionSchemaMissing(error: unknown): boolean {
  if (!error) return false;

  // Supabase surfaces `{ code, message, details, hint }`; a plain Error or a
  // string can also reach here from a rethrown wrapper.
  if (typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown; error?: unknown };
    if (typeof candidate.code === "string" && MISSING_SCHEMA_CODES.has(candidate.code)) return true;
    if (typeof candidate.message === "string") {
      const message = candidate.message.toLowerCase();
      if (MISSING_SCHEMA_MESSAGES.some((needle) => message.includes(needle))) return true;
    }
  }

  return false;
}

export type ProvisionedResult<T> =
  | { ok: true; data: T }
  | { ok: false; setupRequired: true };

/**
 * Runs a competition loader and reports "not provisioned" as a value instead of
 * an exception, so a page can render an explanation. Real failures still throw.
 */
export async function withCompetitionSchema<T>(
  load: () => Promise<T>,
): Promise<ProvisionedResult<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    if (isCompetitionSchemaMissing(error)) return { ok: false, setupRequired: true };
    throw error;
  }
}
