import "server-only";
import type { createServiceClient } from "@/lib/supabase/service";

/**
 * communities.showcase_enabled ships with the showcase-toggle migration. An
 * environment that has not applied it yet has no such column, and any write that
 * mentions it fails the whole request — so probe once per server process and
 * skip the field while it is missing.
 *
 * Reads stay tolerant either way: a missing value reads as "Showcase is on"
 * (see lib/communities/areas), so nothing hides before the migration lands.
 */
let supported: boolean | null = null;

export async function canStoreShowcaseFlag(
  db: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  if (supported !== null) return supported;

  const { error } = await db.from("communities").select("showcase_enabled").limit(1);
  supported = !error;
  if (error) {
    console.warn(
      "[communities] showcase_enabled is missing — apply the showcase toggle migration for the Showcase toggle to persist.",
    );
  }
  return supported;
}

// Callers that need `showcase_enabled` in an explicit column list branch on
// canStoreShowcaseFlag() and keep each column list a single string literal:
// the query builder parses that literal into a row type, so a helper that
// returns a `string` (or a union of column lists) makes the result a
// GenericStringError. Prefer an explicit list over select("*"): several callers
// spread the row into an API response, where a wildcard would start leaking
// invite_token and other columns.

// ── community_join_requests.request_message ───────────────────────────────────

/**
 * Same pattern for community_join_requests.request_message (see the
 * join-request-message migration): the homepage preview attaches an optional
 * note to a private-community request, and admins read it in the members tab.
 * Environments without the column still take the plain request.
 */
let joinMessageSupported: boolean | null = null;

export async function canStoreJoinRequestMessage(
  db: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  if (joinMessageSupported !== null) return joinMessageSupported;

  const { error } = await db.from("community_join_requests").select("request_message").limit(1);
  joinMessageSupported = !error;
  if (error) {
    console.warn(
      "[communities] community_join_requests.request_message is missing — apply the join-request-message migration for request notes to persist.",
    );
  }
  return joinMessageSupported;
}

// ── community_members.notifications_muted_until ───────────────────────────────

/**
 * Same pattern for the timed-mute deadline: environments without the
 * community-mute migration must keep reading memberships and pushing
 * notifications — they just cannot store or honour a timed mute. Reads that
 * select the column, and the push sender's `.or()` on it, branch on this.
 *
 * Unlike the probes above this caches ONLY a positive result: the normal flow
 * is "server already running, migration applied moments later", and a cached
 * miss would leave timed mutes dead until the process restarts. A miss
 * re-probes on the next call (one tiny SELECT) and logs once.
 */
let muteUntilSupported = false;
let muteUntilWarned = false;

export async function canStoreMuteUntil(
  db: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  if (muteUntilSupported) return true;

  const { error } = await db.from("community_members").select("notifications_muted_until").limit(1);
  if (!error) {
    muteUntilSupported = true;
    return true;
  }
  if (!muteUntilWarned) {
    muteUntilWarned = true;
    console.warn(
      "[communities] community_members.notifications_muted_until is missing — apply the community-mute migration for timed mutes to persist.",
    );
  }
  return false;
}
