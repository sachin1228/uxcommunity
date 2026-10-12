/**
 * Is the deployed database able to page community messages on a compound
 * `(created_at, id)` cursor?
 *
 * WHY THIS EXISTS
 *   get_community_message_page gained its two id-cursor arguments in
 *   20261013100000_community_message_compound_cursor.sql. Migrations in this
 *   project are applied by hand, so a deployment can legitimately run the new
 *   web build against the previous function for a while. A call that sends
 *   `p_before_id` / `p_after_id` to the old function fails with PostgREST's
 *   PGRST202 ("could not find the function ... in the schema cache"), which
 *   would turn every chat page load into a 500 during that window.
 *
 * WHAT IT DOES
 *   Remembers the last observed answer so the failure is paid ONCE per retry
 *   window instead of once per request:
 *     * the optimistic default is "supported" — the migrated path is the one
 *       every request takes, so a healthy deployment pays nothing for this;
 *     * after a PGRST202 the tracker answers "not supported" for
 *       `retryAfterUnsupportedMs` (60 s), and calls fall back to the
 *       timestamp-only cursor — the OLD call shape, which the new function also
 *       accepts through its defaults, so the fallback works on both;
 *     * once the window expires the compound call is attempted again, so
 *       applying the migration heals a running deployment within a minute and
 *       without a restart.
 *
 * A negative answer is deliberately NOT cached forever and a positive one is
 * never invalidated by a stale negative: "server already running, migration
 * applied moments later" is the normal flow here (same reasoning as
 * canStoreMuteUntil in showcase-flag.ts).
 *
 * The tracker holds no database handle and reads no clock of its own, so it is
 * unit-testable without a database — see ./message-cursor-support.test.ts.
 */

/** Default retry window after an observed PGRST202. */
export const COMPOUND_CURSOR_RETRY_MS = 60_000;

export interface CompoundCursorSupportOptions {
  /** How long a negative observation suppresses the compound call. */
  retryAfterUnsupportedMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

export interface CompoundCursorSupport {
  /** True while calls should send the compound cursor halves. */
  supportsCompoundCursor(): boolean;
  /** Record a positive observation (a compound call that resolved). */
  noteSupported(): void;
  /** Record a negative observation (PGRST202 from the compound call). */
  noteUnsupported(): void;
}

export function createCompoundCursorSupport(
  options: CompoundCursorSupportOptions = {},
): CompoundCursorSupport {
  const retryAfterUnsupportedMs =
    options.retryAfterUnsupportedMs ?? COMPOUND_CURSOR_RETRY_MS;
  const now = options.now ?? Date.now;

  /** Timestamp until which compound calls are suppressed; null = none. */
  let suppressUntil: number | null = null;

  return {
    supportsCompoundCursor(): boolean {
      if (suppressUntil === null) return true;
      if (now() >= suppressUntil) {
        // The window expired — try the compound call again so a migration
        // applied since the last attempt is picked up without a restart.
        suppressUntil = null;
        return true;
      }
      return false;
    },

    noteSupported(): void {
      suppressUntil = null;
    },

    noteUnsupported(): void {
      suppressUntil = now() + retryAfterUnsupportedMs;
    },
  };
}

/**
 * The shape of a PostgREST error this module cares about. Kept structural so
 * the helpers can be unit-tested with a plain object and so callers do not have
 * to import the supabase-js error type.
 */
interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Is this error "that function/those arguments do not exist on the deployed
 * database"? PostgREST answers an RPC call whose argument names are not in the
 * schema cache with PGRST202 (and a 404 status); a function whose SIGNATURE is
 * wrong but whose name exists answers 404 as well in older versions, so both
 * codes are accepted. Any other error is a real failure and must not be
 * swallowed into the fallback.
 */
export function isUnknownRpcArgumentsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as PostgrestLikeError;
  if (code === "PGRST202" || code === "404") return true;
  return typeof message === "string" && message.includes("schema cache");
}

/**
 * Process-wide tracker for the community message page.
 *
 * One instance per server process: the answer is a property of the deployed
 * database, not of a request or a user, so a single shared observation is both
 * correct and the cheapest.
 */
export const messagePageCompoundCursor = createCompoundCursorSupport();
