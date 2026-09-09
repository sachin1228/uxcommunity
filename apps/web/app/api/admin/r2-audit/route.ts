import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteFromR2, getR2PublicBase, listR2ObjectKeys, normalizeR2DeleteKeys } from "@/lib/r2";
import { collectAllMediaReferences } from "@/lib/r2-cleanup";
import { sweepAbandonedVideoMedia } from "@/lib/video/video-server";

const DEFAULT_GRACE_DAYS = 7;

interface R2ObjectInfo {
  key: string;
  size: number;
  lastModified: string | null;
}

/** Lists every object in the bucket with size + last-modified timestamps. */
async function listAllObjects(): Promise<R2ObjectInfo[]> {
  const objects: R2ObjectInfo[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await listR2ObjectKeys(undefined, continuationToken);
    for (const object of result.objects) {
      objects.push(object);
    }
    if (result.isTruncated && result.nextContinuationToken) {
      continuationToken = result.nextContinuationToken;
    } else {
      continuationToken = undefined;
    }
  } while (continuationToken);

  return objects;
}

function ageDays(lastModified: string | null): number | null {
  if (!lastModified) return null;
  const age = Date.now() - new Date(lastModified).getTime();
  if (Number.isNaN(age) || age < 0) return null;
  return age / 86_400_000;
}

export async function GET() {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const db = createServiceClient();
  const tracked = await collectAllMediaReferences(db);
  const seen = new Map<string, (typeof tracked)[number]>();
  for (const item of tracked) {
    if (!seen.has(item.key)) seen.set(item.key, item);
  }

  const r2Objects = await listAllObjects();
  const keySet = new Set(r2Objects.map((entry) => entry.key));
  const trackedKeys = new Set(Array.from(seen.keys()));

  const orphanKeys = [...keySet].filter((key) => !trackedKeys.has(key));
  const brokenReferences = [...seen.values()].filter((entry) => !keySet.has(entry.key));
  const validCount = [...trackedKeys].filter((key) => keySet.has(key)).length;

  const { count: abandonedVideoCount } = await db
    .from("video_media")
    .select("id", { count: "exact", head: true })
    .in("status", ["uploaded", "processing", "failed"])
    .lt("created_at", new Date(Date.now() - DEFAULT_GRACE_DAYS * 86_400_000).toISOString());

  const publicBase = getR2PublicBase();
  const totalStorageBytes = r2Objects.reduce((sum, entry) => sum + entry.size, 0);
  const orphanByKey = new Map(orphanKeys.map((key) => [key, r2Objects.find((o) => o.key === key)]));

  const orphans = orphanKeys.slice(0, 200).map((key) => {
    const object = orphanByKey.get(key);
    const lastModified = object?.lastModified ?? null;
    return {
      key,
      size: object?.size ?? 0,
      lastModified,
      ageDays: ageDays(lastModified),
      status: "orphan",
      previewUrl: `${publicBase}/${key}`,
    };
  });

  return NextResponse.json({
    totalObjects: r2Objects.length,
    trackedObjects: tracked.length,
    validTrackedObjects: validCount,
    potentialOrphans: orphanKeys.length,
    brokenReferences: brokenReferences.length,
    graceDays: DEFAULT_GRACE_DAYS,
    orphans,
    brokenReferenceDetails: brokenReferences.slice(0, 200).map((entry) => ({
      key: entry.key,
      table: entry.table,
      column: entry.column,
      entityType: entry.entityType,
      entityId: entry.entityId,
      url: entry.url,
      status: "missing_r2_object",
    })),
    totalStorageBytes,
    orphanStorageBytes: orphanKeys.reduce(
      (sum, key) => sum + (orphanByKey.get(key)?.size ?? 0),
      0,
    ),
    abandonedVideoCount: abandonedVideoCount ?? 0,
    generatedAt: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  try {
    const payload = await request.json();
    if (payload?.action === "scan") {
      return GET();
    }

    if (payload?.action === "sweep-abandoned-videos") {
      // Centralized video pipeline: uploads that never reached `ready` within
      // the grace period (abandoned composers, closed tabs mid-encode, failed
      // uploads) are deleted along with their R2 objects. Tombstoned rows are
      // no longer references, so anything that survives is caught by the
      // regular orphan pass afterwards.
      const graceDays = Number(payload?.graceDays) || DEFAULT_GRACE_DAYS;
      const result = await sweepAbandonedVideoMedia(createServiceClient(), {
        olderThanMs: graceDays * 86_400_000,
      });
      return NextResponse.json({
        action: "sweep-abandoned-videos",
        graceDays,
        swept: result.swept,
        failed: result.failed,
        sweptCount: result.swept.length,
        failedCount: result.failed.length,
      });
    }

    if (payload?.action === "delete-orphans") {
      const keys = Array.isArray(payload?.keys) ? payload.keys : [];
      const normalized = normalizeR2DeleteKeys(keys);
      if (normalized.length === 0) {
        return NextResponse.json({ error: "No valid orphan object keys were provided for deletion." }, { status: 400 });
      }

      // Safety net: never delete objects that are still referenced in the DB.
      const tracked = await collectAllMediaReferences(createServiceClient());
      const trackedKeys = new Set(tracked.map((reference) => reference.key));
      const protectedKeys = normalized.filter((key) => trackedKeys.has(key));
      let deletableKeys = normalized.filter((key) => !trackedKeys.has(key));

      // Grace period: by default only delete objects older than the grace
      // window, so an in-flight upload or a DB row created moments after the
      // object cannot be deleted. `force: true` bypasses the age check (the
      // reference check above still applies).
      const force = payload?.force === true;
      if (!force && deletableKeys.length > 0) {
        const graceMs = (Number(payload?.graceDays) || DEFAULT_GRACE_DAYS) * 86_400_000;
        const objects = await listAllObjects();
        const lastModifiedByKey = new Map(objects.map((o) => [o.key, o.lastModified]));
        const now = Date.now();
        deletableKeys = deletableKeys.filter((key) => {
          const lastModified = lastModifiedByKey.get(key);
          if (!lastModified) return false; // unknown age — never delete
          const age = now - new Date(lastModified).getTime();
          return !Number.isNaN(age) && age >= graceMs;
        });
      }

      const failed = protectedKeys.map((key) => ({
        key,
        error: "Object is referenced by the database and was not deleted.",
      }));
      const deleted: string[] = [];

      for (const key of deletableKeys) {
        try {
          await deleteFromR2(key);
          deleted.push(key);
        } catch (error) {
          failed.push({ key, error: error instanceof Error ? error.message : "Unknown delete error" });
        }
      }

      return NextResponse.json({
        deleted,
        failed,
        total: normalized.length,
        deletedCount: deleted.length,
        failedCount: failed.length,
        graceSkipped: normalized.length - deleted.length - failed.length - protectedKeys.length,
        force,
      });
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
}