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
 *       accepts through its defaults, so the fallback RESOLVES on both sides of
 *       the migration;
 *     * once the window expires the compound call is attempted again, so
 *       applying the migration heals a running deployment within a minute and
 *       without a restart.
 *
 *   RESOLVING IS ALL THE FALLBACK GUARANTEES. Run against the un-migrated
 *   function it inherits that function's defect: its `after` branch filters
 *   `created_at > p_after` strictly, so messages sharing the boundary timestamp
 *   can be SKIPPED. This fallback is a stopgap that degrades a staged rollout
 *   instead of erroring — apply
 *   20261013100000_community_message_compound_cursor.sql BEFORE deploying the
 *   build that sends the id halves (see read-models.ts for the detail).
 *
 * A negative answer is deliberately NOT cached forever and a positive one is
 * never invalidated by a stale negative: "server already running, migration
 * applied moments later" is the normal flow here (same reasoning as
 * canStoreMuteUntil in showcase-flag.ts).
 *
 * WHAT COUNTS AS "UNSUPPORTED"
 *   Only a CONFIRMED missing function/signature does: PostgREST's PGRST202, or
 *   a 404/no-code error whose body names THIS function in the schema cache. A
 *   bare 404, an unrelated schema-cache error (PGRST205, "table … not in the
 *   schema cache"), a permission error, a timeout or any other database failure
 *   is NOT proof that the compound arguments are unsupported — treating one as
 *   such would silently downgrade pagination instead of surfacing a 500.
 *   (See isUnknownRpcArgumentsError.)
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

/** The RPC whose missing signature this module detects. */
export const MESSAGE_PAGE_RPC = "get_community_message_page";

/** PostgREST's documented code for "function/arguments not in the schema cache". */
const MISSING_FUNCTION_CODE = "PGRST202";

/**
 * Does a PostgREST error body name THIS function as missing from the schema
 * cache? Older PostgREST versions answer a signature mismatch with a plain 404
 * whose body still spells out the function; the message is then the only
 * signal. Requiring the function name is what keeps a bare 404 (missing route,
 * proxy error) or an unrelated schema-cache complaint from matching.
 */
function namesMissingMessagePageFunction(message: string | null | undefined): boolean {
  if (typeof message !== "string") return false;
  return (
    message.includes(MESSAGE_PAGE_RPC) &&
    (message.includes("schema cache") || message.includes("Could not find the function"))
  );
}

/**
 * Is this error "that function / those arguments do not exist on the deployed
 * database"? Only a CONFIRMED missing function/signature qualifies:
 *
 *   * `PGRST202` — the specific PostgREST error for an RPC whose argument names
 *     are not in the schema cache, which is exactly the staged-deploy case;
 *   * a `404` (or an error whose `code` was dropped) that names THIS function in
 *     its message — the shape older PostgREST returns for a signature mismatch.
 *
 * Everything else is a real failure and must not be swallowed into the
 * timestamp-only fallback: an unexplained 404 (route/proxy), a `PGRST205`
 * "table not in the schema cache", a permission error (42501), a statement
 * timeout (57014), or any other database error. Those must surface as a 500
 * (read-models.ts logs their code) instead of silently degrading pagination.
 */
export function isUnknownRpcArgumentsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as PostgrestLikeError;
  if (code === MISSING_FUNCTION_CODE) return true;
  if (code === "404") return namesMissingMessagePageFunction(message);
  // Some layers drop the code entirely; then only a message that names this
  // function (and the missing-function/schema-cache phrasing) qualifies.
  if (!code) return namesMissingMessagePageFunction(message);
  return false;
}

/**
 * Process-wide tracker for the community message page.
 *
 * One instance per server process: the answer is a property of the deployed
 * database, not of a request or a user, so a single shared observation is both
 * correct and the cheapest.
 */
export const messagePageCompoundCursor = createCompoundCursorSupport();
