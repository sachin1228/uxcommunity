/**
 * Backfill helpers for legacy media (pre-custom-domain era).
 *
 * Two one-time migrations, both idempotent and safe to re-run:
 *  1. Retag  — every R2 object gets `Cache-Control: public, max-age=31536000,
 *     immutable` metadata so Cloudflare's edge caches it for a year (objects
 *     uploaded before that header was added have no cache metadata at all).
 *  2. Rewrite — database rows still pointing at the old `pub-*.r2.dev` domain
 *     are updated to the current public base so old media rides the edge too.
 *
 * The pure logic lives here (no server-only imports, base URL passed in) so it
 * is unit-testable; the API route wires it to R2 + Supabase.
 */

import { ALL_MEDIA_LOOKUPS, type MediaReferenceLookup } from "@uxcommunity/shared";

/** The aggressive cache policy applied to every object (matches uploadToR2). */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Hostname suffix shared by all R2 public dev domains (never edge-cached). */
const LEGACY_R2_DEV_SUFFIX = ".r2.dev";

/** Returns true when the URL points at the legacy, never-cached r2.dev host. */
export function isLegacyR2DevUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith(LEGACY_R2_DEV_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * Extract the object key from a media URL that is either on the current
 * public base or on any legacy `*.r2.dev` host. Returns null otherwise.
 */
export function r2KeyFromCurrentOrLegacyUrl(url: string, currentBase: string): string | null {
  try {
    const parsed = new URL(url);
    const base = currentBase.replace(/\/+$/, "");
    if (url.startsWith(base + "/")) return url.slice(base.length + 1) || null;
    if (parsed.protocol === "https:" && parsed.hostname.toLowerCase().endsWith(LEGACY_R2_DEV_SUFFIX)) {
      const key = parsed.pathname.replace(/^\/+/, "");
      return key ? decodeURIComponent(key) : null;
    }
    return null;
  } catch {
    return null;
  }
}

function rewriteLegacyUrl(url: string, base: string): string | null {
  if (!isLegacyR2DevUrl(url)) return null;
  const key = r2KeyFromCurrentOrLegacyUrl(url, base);
  return key ? `${base}/${key}` : null;
}

export interface RewriteOutcome {
  value: unknown;
  changed: boolean;
  /** Number of legacy URLs replaced. */
  count: number;
}

/** Rewrites a plain single-URL column value (string in, string out). */
export function rewriteUrlValue(value: unknown, currentBase: string): RewriteOutcome {
  const base = currentBase.replace(/\/+$/, "");
  if (typeof value !== "string") return { value, changed: false, count: 0 };
  const next = rewriteLegacyUrl(value, base);
  return next ? { value: next, changed: true, count: 1 } : { value, changed: false, count: 0 };
}

/**
 * Rewrites a JSON attachment-array column value, replacing legacy r2.dev URLs
 * in both `url` and `poster` fields. Non-legacy values pass through untouched.
 */
export function rewriteAttachmentsValue(value: unknown, currentBase: string): RewriteOutcome {
  const base = currentBase.replace(/\/+$/, "");
  if (!Array.isArray(value)) return { value, changed: false, count: 0 };
  let count = 0;
  const next = value.map((item) => {
    if (typeof item !== "object" || item === null) return item;
    const entry = { ...(item as Record<string, unknown>) };
    let entryChanged = false;
    if (typeof entry.url === "string") {
      const nextUrl = rewriteLegacyUrl(entry.url, base);
      if (nextUrl) {
        entry.url = nextUrl;
        entryChanged = true;
        count += 1;
      }
    }
    if (typeof entry.poster === "string") {
      const nextPoster = rewriteLegacyUrl(entry.poster, base);
      if (nextPoster) {
        entry.poster = nextPoster;
        entryChanged = true;
        count += 1;
      }
    }
    return entryChanged ? entry : item;
  });
  return { value: next, changed: count > 0, count };
}

/**
 * Preferred MIME type for an object key, inferred from its extension. R2
 * CopyObject with MetadataDirective REPLACE resets unstated metadata, so the
 * backfill must re-state ContentType when re-tagging Cache-Control.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  pdf: "application/pdf",
  json: "application/json",
};

export function contentTypeForKey(key: string): string | null {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[ext] ?? null;
}

/** Column groups for the URL rewrite: one entry per table.column, with the
 *  rewrite strategy derived from how the lifecycle lookups read the column. */
export interface BackfillColumnGroup {
  table: string;
  column: string;
  kind: "url" | "attachments";
}

const ATTACHMENT_COLUMNS = new Set(["community_showcase_posts.attachments", "community_threads.attachments"]);

/** Lookups that can hold legacy URLs — the same set the lifecycle cleanup uses. */
export const BACKFILL_COLUMN_GROUPS: BackfillColumnGroup[] = Object.values(
  ALL_MEDIA_LOOKUPS.reduce<Record<string, BackfillColumnGroup>>((groups, lookup: MediaReferenceLookup) => {
    const groupKey = `${lookup.table}.${lookup.column}`;
    groups[groupKey] ??= {
      table: lookup.table,
      column: lookup.column,
      kind: ATTACHMENT_COLUMNS.has(groupKey) ? "attachments" : "url",
    };
    return groups;
  }, {}),
);
