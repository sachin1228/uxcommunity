/**
 * R2 media reference tracking + cleanup helpers (web app side).
 *
 * The reference schema itself (which DB columns hold R2 media URLs) lives in
 * `@uxcommunity/shared` so the runtime cleanup, the admin orphan audit, and
 * the unit tests all agree on what counts as a reference. This module adds
 * the Supabase-backed collection and deletion helpers used by the app's
 * delete/replace paths.
 *
 *  1. Deleting an entity removes the R2 objects that belonged to it — but
 *     ONLY if nothing else references them (shared media is protected).
 *  2. The orphan audit (`/api/admin/r2-audit`) tracks exactly the same
 *     reference sources as the runtime cleanup.
 *  3. Deletions are idempotent and retry-safe: an R2 delete is a no-op for
 *     missing keys, and any object that survives a failed cleanup is picked
 *     up by the next orphan scan (after the grace period).
 */

import "server-only";

import {
  ALL_MEDIA_LOOKUPS,
  LOOKUP_ENTITY_TYPES,
  MASTER_IMAGE_LOOKUPS,
  MASTER_LOTTIE_LOOKUPS,
  SHOWCASE_ATTACHMENT_LOOKUP,
  SHOWCASE_POSTER_LOOKUP,
  THREAD_ATTACHMENT_LOOKUP,
  type MediaReferenceLookup,
} from "@uxcommunity/shared";
import { createServiceClient } from "@/lib/supabase/service";
import {
  deleteR2AssetIfUnreferenced,
  getR2KeyFromUrl,
  getReferenceUrls,
} from "@/lib/r2";

export type DbClient = ReturnType<typeof createServiceClient>;

// URL extraction + reference schema live in @uxcommunity/shared — re-exported
// here so callers of this module have one import surface.
export {
  ALL_MEDIA_LOOKUPS,
  LOOKUP_ENTITY_TYPES,
  MASTER_IMAGE_LOOKUPS,
  MASTER_LOTTIE_LOOKUPS,
  SHOWCASE_ATTACHMENT_LOOKUP,
  SHOWCASE_POSTER_LOOKUP,
  THREAD_ATTACHMENT_LOOKUP,
  attachmentPosterUrls,
  attachmentUrls,
} from "@uxcommunity/shared";

export type { MediaReferenceLookup };

export interface MediaReference {
  key: string;
  table: string;
  column: string;
  entityType: string;
  entityId: string | null;
  url: string;
}

function pushUniqueUrl(urls: string[], url: string | null | undefined): void {
  if (!url || typeof url !== "string" || !url.trim()) return;
  if (!getR2KeyFromUrl(url)) return; // not on our bucket — skip
  if (!urls.includes(url)) urls.push(url);
}

function pushLookupUrls(urls: string[], lookup: MediaReferenceLookup, value: unknown): void {
  for (const candidate of getReferenceUrls(lookup, value)) {
    if (getR2KeyFromUrl(candidate)) pushUniqueUrl(urls, candidate);
  }
}

// ── Reference collection (used by the orphan audit) ──────────────────────────

/**
 * Scans every media-referencing column in the database and returns one entry
 * per R2 object referenced. Objects referenced from multiple rows appear once
 * per row — callers deduplicate by key when counting.
 */
export async function collectAllMediaReferences(db: DbClient): Promise<MediaReference[]> {
  const references: MediaReference[] = [];

  for (const lookup of ALL_MEDIA_LOOKUPS) {
    const { data, error } = await db
      .from(lookup.table)
      .select(`id, ${lookup.column}`)
      .not(lookup.column, "is", null);

    if (error) {
      console.error("[r2-cleanup] reference query failed", { lookup, error });
      continue;
    }

    // Cast matches the repo-wide untyped supabase-js baseline (see next.config.js).
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const urls = getReferenceUrls(lookup, row?.[lookup.column]);
      for (const url of urls) {
        const key = getR2KeyFromUrl(url);
        if (!key) continue;
        references.push({
          key,
          table: lookup.table,
          column: lookup.column,
          entityType: LOOKUP_ENTITY_TYPES[`${lookup.table}.${lookup.column}`] ?? lookup.table,
          entityId: typeof row?.id === "string" ? row.id : null,
          url,
        });
      }
    }
  }

  return references;
}

// ── Media key collection for entity trees ────────────────────────────────────

/**
 * Collects every R2 URL owned by a community: its display picture, chat
 * message images, thread attachments, showcase images/videos/posters, event
 * covers, and community-scoped lottie settings.
 */
interface CommunityRow {
  image_url: string | null;
  lottie_url: string | null;
}

interface MediaRow {
  image_url: string | null;
  cover_image_url: string | null;
  lottie_url: string | null;
  attachments: unknown;
}

export async function collectCommunityMediaUrls(
  db: DbClient,
  communityId: string,
): Promise<string[]> {
  const urls: string[] = [];

  // Casts match the repo-wide untyped supabase-js baseline (see next.config.js).
  const communityResult = (await db
    .from("communities")
    .select("image_url, lottie_url")
    .eq("id", communityId)
    .maybeSingle()) as unknown as { data: CommunityRow | null };
  const [messagesResult, threadsResult, showcaseResult, eventsResult, lottieSettingsResult] = (await Promise.all([
    db.from("community_messages").select("image_url").eq("community_id", communityId).not("image_url", "is", null),
    db.from("community_threads").select("attachments").eq("community_id", communityId).not("attachments", "is", null),
    db.from("community_showcase_posts").select("image_url, attachments").eq("community_id", communityId),
    db.from("community_events").select("cover_image_url").eq("community_id", communityId).not("cover_image_url", "is", null),
    db.from("lottie_settings").select("lottie_url").eq("scope", "community").eq("scope_key", communityId).not("lottie_url", "is", null),
  ])) as unknown as Array<{ data: MediaRow[] | null }>;

  pushUniqueUrl(urls, communityResult.data?.image_url ?? null);
  pushUniqueUrl(urls, communityResult.data?.lottie_url ?? null);
  for (const message of messagesResult.data ?? []) pushUniqueUrl(urls, message?.image_url ?? null);
  for (const thread of threadsResult.data ?? []) pushLookupUrls(urls, THREAD_ATTACHMENT_LOOKUP, thread?.attachments);
  for (const post of showcaseResult.data ?? []) {
    pushUniqueUrl(urls, post?.image_url ?? null);
    pushLookupUrls(urls, SHOWCASE_ATTACHMENT_LOOKUP, post?.attachments);
    pushLookupUrls(urls, SHOWCASE_POSTER_LOOKUP, post?.attachments);
  }
  for (const event of eventsResult.data ?? []) pushUniqueUrl(urls, event?.cover_image_url ?? null);
  for (const setting of lottieSettingsResult.data ?? []) pushUniqueUrl(urls, setting?.lottie_url ?? null);

  return urls;
}

/**
 * Collects every R2 URL owned by a master-data row plus all communities
 * linked to it (type/reference_id), including the communities' child media.
 */
export async function collectMasterMediaUrls(
  db: DbClient,
  type: string,
  table: string,
  id: string,
): Promise<string[]> {
  const urls: string[] = [];

  // Casts match the repo-wide untyped supabase-js baseline (see next.config.js).
  const masterResult = (await db
    .from(table)
    .select("image_url, lottie_url")
    .eq("id", id)
    .maybeSingle()) as unknown as { data: CommunityRow | null };
  const communitiesResult = (await db
    .from("communities")
    .select("id")
    .eq("type", type)
    .eq("reference_id", id)) as unknown as { data: Array<{ id: string }> | null };

  pushUniqueUrl(urls, masterResult.data?.image_url ?? null);
  pushUniqueUrl(urls, masterResult.data?.lottie_url ?? null);

  for (const community of communitiesResult.data ?? []) {
    const communityUrls = await collectCommunityMediaUrls(db, community.id);
    for (const url of communityUrls) pushUniqueUrl(urls, url);
  }

  return urls;
}

// ── Deletion helpers ─────────────────────────────────────────────────────────

export interface R2CleanupResult {
  deleted: string[];
  skipped: string[];
  failed: Array<{ url: string; error: string }>;
}

/**
 * Deletes each URL from R2 only when no row in ANY of the reference lookups
 * still points at it. Shared media (referenced from multiple entities) is
 * skipped. Per-key failures are returned, never thrown, so callers can report
 * them and re-run the cleanup via the admin orphan scan.
 */
export async function deleteUnreferencedR2Urls(
  db: DbClient,
  urls: string[],
  lookups: MediaReferenceLookup[],
): Promise<R2CleanupResult> {
  const result: R2CleanupResult = { deleted: [], skipped: [], failed: [] };

  for (const url of urls) {
    const outcome = await deleteR2AssetIfUnreferenced(db, url, lookups);
    if (outcome.status === "deleted") result.deleted.push(url);
    else if (outcome.status === "referenced") result.skipped.push(url);
    else if (outcome.status === "skipped") result.skipped.push(url);
    else if (outcome.status === "missing") result.skipped.push(url);
    else result.failed.push({ url, error: `Unhandled outcome: ${outcome.status}` });
  }

  return result;
}

/**
 * Full community media cleanup. Call AFTER the community row (and cascaded
 * children) have been deleted, passing the URLs collected BEFORE the delete
 * (collectCommunityMediaUrls). Removes the community-scoped lottie_settings
 * rows (not covered by FK cascades), then deletes every R2 object that is no
 * longer referenced anywhere in the database.
 */
export async function cleanupCommunityMedia(
  db: DbClient,
  communityId: string,
  urls: string[],
): Promise<R2CleanupResult> {
  // lottie_settings is keyed by text (scope + scope_key), not a real FK, so
  // it survives the community cascade and would keep its R2 object alive.
  await db
    .from("lottie_settings")
    .delete()
    .eq("scope", "community")
    .eq("scope_key", communityId);

  return deleteUnreferencedR2Urls(db, urls, ALL_MEDIA_LOOKUPS);
}

/**
 * Full master-data cleanup. Call AFTER the master row has been deleted,
 * passing the URLs collected BEFORE the delete (collectMasterMediaUrls).
 * Deletes the linked communities (mirrors of the master row) and then every
 * R2 object that is no longer referenced anywhere.
 */
export async function cleanupMasterDataMedia(
  db: DbClient,
  type: string,
  table: string,
  id: string,
  urls: string[],
): Promise<R2CleanupResult> {
  await db.from("communities").delete().eq("type", type).eq("reference_id", id);

  return deleteUnreferencedR2Urls(db, urls, ALL_MEDIA_LOOKUPS);
}