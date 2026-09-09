import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import {
  contentTypeForKey,
  IMMUTABLE_CACHE_CONTROL,
  rewriteAttachmentsValue,
  rewriteUrlValue,
  BACKFILL_COLUMN_GROUPS,
} from "@/lib/r2-backfill";
import { getR2PublicBase, headR2CacheControl, listR2ObjectKeys, retagR2Object } from "@/lib/r2";

/**
 * One-time legacy-media backfill (Admin → Tools).
 *
 * Actions (all idempotent, all safe to re-run):
 *  - scan    — count R2 objects missing the immutable Cache-Control metadata
 *              and DB rows still pointing at a legacy `*.r2.dev` domain.
 *  - retag   — copy-in-place `Cache-Control: public, max-age=31536000,
 *              immutable` (plus ContentType) onto bucket objects, so the CDN
 *              edge caches old media exactly like new uploads. Objects already
 *              tagged correctly are skipped via HEAD. Cursor (`startAfter` =
 *              last processed key) lets the client loop until `hasMore` is
 *              false, so any bucket size finishes across repeated clicks.
 *  - rewrite — update DB rows from `https://pub-*.r2.dev/<key>` to the current
 *              R2_PUBLIC_URL base (same object, same key, new URL).
 */

const DEFAULT_BATCH = 200;
const MAX_BATCH = 1000;
const RETAG_PAGE = 1000; // objects fetched per S3 ListObjectsV2 page
const REWRITE_PAGE = 500; // rows fetched per Supabase page

function batchSize(value: unknown): number {
  const n = typeof value === "number" ? Math.floor(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BATCH;
  return Math.min(n, MAX_BATCH);
}

export async function POST(req: NextRequest) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  let body: { action?: string; limit?: number; startAfter?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = body.action ?? "scan";
  const limit = batchSize(body.limit);
  const db = createServiceClient();
  const base = (() => {
    try {
      return getR2PublicBase();
    } catch {
      return null;
    }
  })();

  if (!base) {
    return NextResponse.json({ error: "R2_PUBLIC_URL is not configured." }, { status: 500 });
  }

  // ── scan ──────────────────────────────────────────────────────────────────
  if (action === "scan") {
    // Up to 2 pages (2000 objects) HEAD-checked per request.
    const objects: Array<{ key: string; size: number }> = [];
    let continuationToken: string | undefined;
    let isTruncated = false;
    do {
      const page = await listR2ObjectKeys(undefined, continuationToken);
      for (const object of page.objects) objects.push({ key: object.key, size: object.size });
      isTruncated = page.isTruncated;
      continuationToken = page.nextContinuationToken;
    } while (isTruncated && continuationToken && objects.length < 2000);

    let untaggedObjects = 0;
    for (let i = 0; i < objects.length; i += 50) {
      const heads = await Promise.all(
        objects.slice(i, i + 50).map(({ key }) => headR2CacheControl(key)),
      );
      untaggedObjects += heads.filter((cc) => cc !== IMMUTABLE_CACHE_CONTROL).length;
    }

    const legacyRefs: Array<{ table: string; column: string; rows: number; urls: number }> = [];
    let legacyRowsTotal = 0;
    let legacyUrlsTotal = 0;
    for (const group of BACKFILL_COLUMN_GROUPS) {
      const { data, error } = await db.from(group.table).select(`id, ${group.column}`).limit(5000);
      if (error) {
        console.error("[r2-backfill] scan lookup failed", { table: group.table, column: group.column, error });
        continue;
      }
      let rows = 0;
      let urls = 0;
      for (const row of data ?? []) {
        const outcome =
          group.kind === "attachments"
            ? rewriteAttachmentsValue(row?.[group.column], base)
            : rewriteUrlValue(row?.[group.column], base);
        if (outcome.changed) {
          rows += 1;
          urls += outcome.count;
        }
      }
      if (rows > 0) legacyRefs.push({ table: group.table, column: group.column, rows, urls });
      legacyRowsTotal += rows;
      legacyUrlsTotal += urls;
    }

    return NextResponse.json({
      action,
      objectsScanned: objects.length,
      objectsListedTruncated: isTruncated,
      untaggedObjects,
      legacyRefs,
      legacyRowsTotal,
      legacyUrlsTotal,
    });
  }

  // ── retag ─────────────────────────────────────────────────────────────────
  if (action === "retag") {
    // Keyset pagination: resume listing strictly after the last processed key,
    // so repeated calls converge over the whole bucket with no server state.
    let startAfter = typeof body.startAfter === "string" ? body.startAfter : undefined;
    let processed = 0;
    let retagged = 0;
    let alreadyTagged = 0;
    let failed = 0;
    const errors: Array<{ key: string; error: string }> = [];
    let lastKey = startAfter ?? "";
    let hasMore = false;

    // Fetch pages until the batch budget is consumed or the bucket ends.
    while (processed < limit) {
      const page = await listR2ObjectKeys(undefined, undefined, startAfter);
      if (page.objects.length === 0) {
        hasMore = false;
        break;
      }
      for (const object of page.objects) {
        if (processed >= limit) {
          hasMore = true;
          break;
        }
        lastKey = object.key;
        processed += 1;
        const contentType = contentTypeForKey(object.key);
        if (!contentType) {
          alreadyTagged += 1; // unknown extension — leave untouched
          continue;
        }
        if ((await headR2CacheControl(object.key)) === IMMUTABLE_CACHE_CONTROL) {
          alreadyTagged += 1;
          continue;
        }
        try {
          await retagR2Object(object.key, contentType, IMMUTABLE_CACHE_CONTROL);
          retagged += 1;
        } catch (error) {
          failed += 1;
          errors.push({ key: object.key, error: error instanceof Error ? error.message : "copy failed" });
        }
      }
      if (hasMore) break;
      if (page.isTruncated && page.objects.length) {
        startAfter = page.objects[page.objects.length - 1].key;
      } else {
        hasMore = false;
        break;
      }
    }

    return NextResponse.json({
      action,
      processed,
      retagged,
      alreadyTagged,
      failed,
      errors: errors.slice(0, 10),
      lastKey,
      hasMore,
      complete: !hasMore && processed < limit,
    });
  }

  // ── rewrite ───────────────────────────────────────────────────────────────
  if (action === "rewrite") {
    const perGroup = Math.max(50, Math.ceil(limit / BACKFILL_COLUMN_GROUPS.length));
    let rewrittenUrls = 0;
    let updatedRows = 0;
    let failed = 0;
    const perGroupReport: Array<{ table: string; column: string; rewritten: number }> = [];
    let allGroupsExhausted = true;

    for (const group of BACKFILL_COLUMN_GROUPS) {
      // Supabase's dynamic-table typing infers `never` for ad-hoc column
      // selects; a local row shape keeps this honest and type-safe.
      type BackfillRow = { id: string } & Record<string, unknown>;
      let rewrittenInGroup = 0;
      // Pages from offset 0; every successful rewrite removes legacy URLs, so
      // re-running from the start converges without server-side cursors.
      for (let offset = 0; offset < 20000; offset += REWRITE_PAGE) {
        const { data, error } = await db
          .from(group.table)
          .select(`id, ${group.column}`)
          .order("id")
          .range(offset, offset + REWRITE_PAGE - 1);
        if (error) {
          console.error("[r2-backfill] rewrite lookup failed", { table: group.table, column: group.column, error });
          failed += 1;
          allGroupsExhausted = false;
          break;
        }
        const rows = (data ?? []) as unknown as BackfillRow[];
        for (const row of rows) {
          const value = row[group.column];
          const outcome =
            group.kind === "attachments"
              ? rewriteAttachmentsValue(value, base)
              : rewriteUrlValue(value, base);
          if (!outcome.changed || typeof row.id !== "string") continue;
          if (rewrittenInGroup >= perGroup) {
            allGroupsExhausted = false;
            break;
          }
          const { error: updateError } = await db
            .from(group.table)
            .update({ [group.column]: outcome.value } as never)
            .eq("id", row.id);
          if (updateError) {
            failed += 1;
            console.error("[r2-backfill] row update failed", { table: group.table, id: row.id, error: updateError });
            continue;
          }
          rewrittenInGroup += outcome.count;
          updatedRows += 1;
        }
        if (rewrittenInGroup >= perGroup) break;
        if (rows.length < REWRITE_PAGE) break; // group fully scanned
      }
      rewrittenUrls += rewrittenInGroup;
      perGroupReport.push({ table: group.table, column: group.column, rewritten: rewrittenInGroup });
    }

    return NextResponse.json({
      action,
      rewrittenUrls,
      updatedRows,
      failed,
      perGroupReport,
      complete: allGroupsExhausted,
    });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
