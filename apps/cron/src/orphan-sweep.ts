/**
 * Scheduled R2 orphan sweep.
 *
 * Mirrors the admin audit (`/api/admin/r2-audit`) but runs unattended on a
 * Cloudflare Cron Trigger:
 *
 *   1. List every object in the media R2 bucket (with size + last-modified).
 *   2. Collect every referenced key from the database, using the SAME
 *      reference schema as the web app (`ALL_MEDIA_LOOKUPS` from
 *      @uxcommunity/shared), so the sweep can never disagree with the app.
 *   3. Orphans = objects with no database reference. Only objects older than
 *      the grace period (default 7 days) are eligible for deletion — in-flight
 *      uploads and signup-pending avatars are never touched.
 *   4. By default the sweep is a DRY RUN that logs a structured report. Set
 *      `R2_ORPHAN_SWEEP_DELETE=true` to actually delete eligible objects.
 *
 * Deletion is idempotent (R2 delete of a missing key is a no-op) and each
 * object is re-verified against the reference set computed in the same run.
 */

import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
  ALL_MEDIA_LOOKUPS,
  referenceUrlsFromValue,
  r2KeyFromUrl,
} from "@uxcommunity/shared";
import type { Env } from "./env";

export interface R2ObjectInfo {
  key: string;
  size: number;
  lastModified: string | null;
}

export interface SweepReport {
  ranAt: string;
  dryRun: boolean;
  graceDays: number;
  totalObjects: number;
  totalStorageBytes: number;
  trackedReferences: number;
  /** Objects with no database reference (any age). */
  potentialOrphans: number;
  /** Unreferenced AND older than the grace period. */
  deleteEligible: number;
  deleted: number;
  failed: number;
  failures: Array<{ key: string; error: string }>;
  orphans: Array<{ key: string; size: number; lastModified: string | null; ageDays: number | null }>;
}

function requireEnv(env: Env, name: keyof Env): string {
  const value = env[name];
  if (!value) throw new Error(`[orphan-sweep] Missing ${String(name)} secret`);
  return value;
}

function getClient(env: Env): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${requireEnv(env, "R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv(env, "R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv(env, "R2_SECRET_ACCESS_KEY"),
    },
  });
}

async function listAllObjects(env: Env): Promise<R2ObjectInfo[]> {
  const client = getClient(env);
  const bucket = requireEnv(env, "R2_BUCKET_NAME");
  const objects: R2ObjectInfo[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const entry of response.Contents ?? []) {
      if (!entry.Key) continue;
      objects.push({
        key: entry.Key,
        size: entry.Size ?? 0,
        lastModified: entry.LastModified ? new Date(entry.LastModified).toISOString() : null,
      });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

async function collectReferencedKeys(env: Env, publicBase: string): Promise<Set<string>> {
  const supabaseUrl = requireEnv(env, "SUPABASE_URL").replace(/\/+$/, "");
  const serviceRoleKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: "application/json",
  };

  const keys = new Set<string>();
  const PAGE = 1000;

  for (const lookup of ALL_MEDIA_LOOKUPS) {
    let offset = 0;
    for (;;) {
      const url =
        `${supabaseUrl}/rest/v1/${lookup.table}` +
        `?select=id,${lookup.column}` +
        `&${lookup.column}=not.is.null` +
        `&limit=${PAGE}&offset=${offset}`;
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error(
          `[orphan-sweep] reference query failed ${lookup.table}.${lookup.column}: ` +
            `${response.status} ${(await response.text().catch(() => "")).slice(0, 300)}`,
        );
      }

      const rows = (await response.json()) as Array<Record<string, unknown>>;
      if (!Array.isArray(rows) || rows.length === 0) break;

      for (const row of rows) {
        for (const urlValue of referenceUrlsFromValue(lookup, row?.[lookup.column])) {
          const key = r2KeyFromUrl(urlValue, publicBase);
          if (key) keys.add(key);
        }
      }

      if (rows.length < PAGE) break;
      offset += rows.length;
    }
  }

  return keys;
}

/**
 * Pure selection logic: which objects are confirmed orphans (no reference)
 * AND old enough to delete? Objects without a last-modified timestamp are
 * never auto-deleted — their age cannot be proven.
 */
export function selectOrphanCandidates(
  objects: R2ObjectInfo[],
  referencedKeys: Set<string>,
  graceDays: number,
): R2ObjectInfo[] {
  const cutoffMs = Date.now() - graceDays * 86_400_000;
  return objects.filter((object) => {
    if (referencedKeys.has(object.key)) return false;
    if (!object.lastModified) return false; // unknown age — never auto-delete
    const age = Date.parse(object.lastModified);
    return !Number.isNaN(age) && age <= cutoffMs;
  });
}

function ageDays(lastModified: string | null): number | null {
  if (!lastModified) return null;
  const age = Date.now() - new Date(lastModified).getTime();
  if (Number.isNaN(age) || age < 0) return null;
  return age / 86_400_000;
}

export async function runOrphanSweep(env: Env): Promise<SweepReport> {
  const dryRun = env.R2_ORPHAN_SWEEP_DELETE !== "true";
  const graceDays = Math.max(0, Number(env.R2_ORPHAN_SWEEP_GRACE_DAYS) || 7);
  const publicBase = requireEnv(env, "R2_PUBLIC_URL").replace(/\/+$/, "");

  const objects = await listAllObjects(env);
  const referencedKeys = await collectReferencedKeys(env, publicBase);
  const candidates = selectOrphanCandidates(objects, referencedKeys, graceDays);

  const deleted: string[] = [];
  const failures: Array<{ key: string; error: string }> = [];

  if (!dryRun && candidates.length > 0) {
    const client = getClient(env);
    const bucket = requireEnv(env, "R2_BUCKET_NAME");
    for (const object of candidates) {
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: object.key }),
        );
        deleted.push(object.key);
      } catch (error) {
        failures.push({
          key: object.key,
          error: error instanceof Error ? error.message : "Unknown delete error",
        });
      }
    }
  }

  const report: SweepReport = {
    ranAt: new Date().toISOString(),
    dryRun,
    graceDays,
    totalObjects: objects.length,
    totalStorageBytes: objects.reduce((sum, object) => sum + object.size, 0),
    trackedReferences: referencedKeys.size,
    potentialOrphans: objects.filter((object) => !referencedKeys.has(object.key)).length,
    deleteEligible: candidates.length,
    deleted: deleted.length,
    failed: failures.length,
    failures,
    orphans: candidates.slice(0, 100).map((object) => ({
      key: object.key,
      size: object.size,
      lastModified: object.lastModified,
      ageDays: ageDays(object.lastModified),
    })),
  };

  console.log("[orphan-sweep]", JSON.stringify(report));
  return report;
}