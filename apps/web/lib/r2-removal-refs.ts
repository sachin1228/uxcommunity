/**
 * Media held by an undoable admin removal (see `content_removals`).
 *
 * When a platform admin removes reported content, `removeCommunityContent`
 * snapshots the row plus its discussion so the action can be undone with the
 * same ids, and deliberately KEEPS the R2 objects alive. That means a removed
 * post's images exist in the bucket with no live row pointing at them — which
 * is exactly what the orphan audit is built to delete.
 *
 * This module extracts the media URLs a snapshot still owns, so the audit can
 * count an active removal as a reference. Without it, a post restored hours or
 * days later comes back with dead image URLs, because the object was already
 * past the audit's grace window by the time it was removed.
 *
 * Pure module on purpose: no Supabase client and no `server-only`, so the
 * extraction rules are unit-testable (see r2-removal-refs.test.ts). The
 * database scan lives in lib/r2-cleanup.ts.
 */

import {
  ALL_MEDIA_LOOKUPS,
  LOOKUP_ENTITY_TYPES,
  referenceUrlsFromValue,
  type MediaReferenceLookup,
} from "@uxcommunity/shared";

/** The live table each removable content kind came from. */
const REMOVAL_CONTENT_TABLES: Record<string, string> = {
  thread: "community_threads",
  showcase: "community_showcase_posts",
  resource: "community_resources",
  event: "community_events",
};

/** Media-bearing columns per table, from the shared reference schema. */
const LOOKUPS_BY_TABLE = new Map<string, MediaReferenceLookup[]>();
for (const lookup of ALL_MEDIA_LOOKUPS) {
  const existing = LOOKUPS_BY_TABLE.get(lookup.table) ?? [];
  existing.push(lookup);
  LOOKUPS_BY_TABLE.set(lookup.table, existing);
}

export interface RemovalMediaUrl {
  url: string;
  /** The table the URL was captured from (`community_events`, `event_comments`…). */
  table: string;
  column: string;
  /** Human-readable entity type for the audit report. */
  entityType: string;
}

interface RemovalSnapshotShape {
  content?: Record<string, unknown> | null;
  children?: Record<string, unknown> | null;
}

/**
 * Every media URL an active removal snapshot still points at, deduplicated
 * across the content row and its captured discussion. Unknown tables, missing
 * columns and junk snapshots simply contribute nothing.
 */
export function removalSnapshotMediaUrls(
  snapshot: unknown,
  contentType: string,
  contentId: string,
): RemovalMediaUrl[] {
  if (!snapshot || typeof snapshot !== "object") return [];

  const { content, children } = snapshot as RemovalSnapshotShape;
  const urls: RemovalMediaUrl[] = [];
  const seen = new Set<string>();

  function collect(table: string, row: Record<string, unknown> | null | undefined) {
    if (!row) return;
    for (const lookup of LOOKUPS_BY_TABLE.get(table) ?? []) {
      for (const url of referenceUrlsFromValue(lookup, row[lookup.column])) {
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urls.push({
          url,
          table,
          column: lookup.column,
          entityType: LOOKUP_ENTITY_TYPES[`${table}.${lookup.column}`] ?? table,
        });
      }
    }
  }

  const contentTable = REMOVAL_CONTENT_TABLES[contentType];
  if (contentTable) collect(contentTable, content);

  if (children && typeof children === "object") {
    for (const [table, rows] of Object.entries(children)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        collect(table, row as Record<string, unknown>);
      }
    }
  }

  return urls;
}
