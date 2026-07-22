/**
 * POST /api/admin/purge-supabase-storage
 *
 * One-time cleanup: lists every object across all Supabase Storage buckets
 * and deletes them. Run this AFTER the Supabase → R2 migration is complete
 * and you have verified all DB URLs point to R2.
 *
 * Safe to run multiple times — already-empty buckets are simply skipped.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export interface PurgeResult {
  bucket: string;
  deleted: number;
  failed: number;
  errors: string[];
}

/** List every object key in a bucket, paginating through all pages. */
async function listAllKeys(
  db: ReturnType<typeof createServiceClient>,
  bucket: string
): Promise<string[]> {
  const keys: string[] = [];
  const PAGE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await db.storage
      .from(bucket)
      .list("", { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    // Recurse into "folders" (items with no metadata are virtual prefixes)
    for (const item of data) {
      if (item.id === null) {
        // Virtual folder — recurse
        const sub = await listFolderKeys(db, bucket, item.name);
        keys.push(...sub);
      } else {
        keys.push(item.name);
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return keys;
}

async function listFolderKeys(
  db: ReturnType<typeof createServiceClient>,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const keys: string[] = [];
  const PAGE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await db.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const item of data) {
      const fullPath = `${prefix}/${item.name}`;
      if (item.id === null) {
        const sub = await listFolderKeys(db, bucket, fullPath);
        keys.push(...sub);
      } else {
        keys.push(fullPath);
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return keys;
}

export async function POST() {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const db = createServiceClient();

  // List all buckets
  const { data: buckets, error: bucketsErr } = await db.storage.listBuckets();
  if (bucketsErr) {
    return NextResponse.json({ error: `Failed to list buckets: ${bucketsErr.message}` }, { status: 500 });
  }
  if (!buckets || buckets.length === 0) {
    return NextResponse.json({ results: [], totalDeleted: 0, totalFailed: 0 });
  }

  const results: PurgeResult[] = [];

  for (const bucket of buckets) {
    const result: PurgeResult = { bucket: bucket.name, deleted: 0, failed: 0, errors: [] };

    let keys: string[];
    try {
      keys = await listAllKeys(db, bucket.name);
    } catch (err) {
      result.errors.push(`List failed: ${String(err)}`);
      result.failed = -1; // signals listing itself failed
      results.push(result);
      continue;
    }

    if (keys.length === 0) {
      results.push(result);
      continue;
    }

    // Supabase Storage remove() accepts up to 1000 paths per call
    const BATCH = 1000;
    for (let i = 0; i < keys.length; i += BATCH) {
      const batch = keys.slice(i, i + BATCH);
      const { error: delErr } = await db.storage.from(bucket.name).remove(batch);
      if (delErr) {
        result.failed += batch.length;
        result.errors.push(delErr.message);
      } else {
        result.deleted += batch.length;
      }
    }

    results.push(result);
  }

  const totalDeleted = results.reduce((s, r) => s + r.deleted, 0);
  const totalFailed  = results.reduce((s, r) => s + Math.max(r.failed, 0), 0);

  return NextResponse.json({ results, totalDeleted, totalFailed });
}
