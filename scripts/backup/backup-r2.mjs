#!/usr/bin/env node
/**
 * Mirrors the application's R2 media buckets into the backup store.
 *
 * WHY THIS EXISTS AT ALL
 *   Cloudflare R2 has no object versioning, no bucket replication and no
 *   undelete: `DeleteObject` is irreversible, and an overwritten key loses its
 *   previous bytes immediately. Cloudflare's own durability page says it
 *   "does not prevent intentional or accidental deletion of data". The only
 *   recovery path for a deleted avatar, résumé, verification sample, DM image
 *   or community photo is a copy that lives somewhere else. This script makes
 *   that copy.
 *
 * WHY IT IS ADDITIVE
 *   It copies and never deletes. A deletion in production must not propagate to
 *   the backup, because the backup's entire purpose is to survive one. Removing
 *   old copies is a deliberate, separate operator action (see the runbook),
 *   which is why this script has no `--delete` flag.
 *
 * WHY IT COMPARES SIZES
 *   Copying every object on every run would re-upload the whole library daily
 *   for no benefit. Listing both sides and copying only what is missing or has a
 *   different size keeps a daily run to a handful of requests while still
 *   repairing a partial previous run. Size is the comparison key because R2's
 *   ETag is not a content MD5 for multipart objects, so it cannot be compared
 *   across the two.
 *
 * USAGE
 *   node scripts/backup/backup-r2.mjs [--dry-run] [--concurrency 8]
 */

import { loadMediaBackupConfig } from "./lib/config.mjs";
import { log, emitSummary } from "./lib/log.mjs";
import { parseArgs } from "./lib/args.mjs";
import { copyObject, createClient, listAll, putObject } from "./lib/r2.mjs";

const KNOWN_OPTIONS = ["dry-run", "concurrency"];
const FLAGS = ["dry-run"];

/** Runs `worker` over `items` with a bounded number in flight. */
async function pool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function mirrorBucket(client, config, sourceBucket, { dryRun, concurrency }) {
  const destinationPrefix = `r2/${sourceBucket}`;

  const source = await listAll(client, { bucket: sourceBucket });
  const destination = await listAll(client, { bucket: config.bucket, prefix: `${destinationPrefix}/` });

  const destinationSizes = new Map(destination.map((object) => [object.key, object.size]));
  const sourceBytes = source.reduce((sum, object) => sum + object.size, 0);

  const toCopy = source.filter((object) => {
    const existing = destinationSizes.get(`${destinationPrefix}/${object.key}`);
    return existing === undefined || existing !== object.size;
  });

  log.info("media bucket scanned", {
    bucket: sourceBucket,
    objects: source.length,
    bytes: sourceBytes,
    upToDate: source.length - toCopy.length,
    toCopy: toCopy.length,
  });

  const copied = [];
  const failed = [];
  let copiedBytes = 0;

  if (!dryRun && toCopy.length > 0) {
    await pool(toCopy, concurrency, async (object) => {
      const destinationKey = `${destinationPrefix}/${object.key}`;
      try {
        await copyObject(client, {
          sourceBucket,
          sourceKey: object.key,
          destinationBucket: config.bucket,
          destinationKey,
        });
        copied.push(object.key);
        copiedBytes += object.size;
      } catch (error) {
        failed.push({ key: object.key, error: String(error?.message ?? error).slice(0, 300) });
      }
    });
  }

  // Verify by re-listing rather than trusting the copy responses: this also
  // catches objects a previous run reported as copied but that are not there.
  const verifiedDestination = dryRun
    ? destination
    : await listAll(client, { bucket: config.bucket, prefix: `${destinationPrefix}/` });
  const verifiedSizes = new Map(verifiedDestination.map((object) => [object.key, object.size]));
  const missing = source
    .filter((object) => verifiedSizes.get(`${destinationPrefix}/${object.key}`) !== object.size)
    .map((object) => object.key);

  const manifest = {
    schemaVersion: 1,
    kind: "r2-media",
    generatedAt: new Date().toISOString(),
    sourceBucket,
    destinationBucket: config.bucket,
    destinationPrefix,
    sourceObjects: source.length,
    sourceBytes,
    copiedObjects: copied.length,
    copiedBytes,
    failed: failed.length,
    missingAfterCopy: missing.length,
    dryRun,
  };

  if (!dryRun) {
    await putObject(client, {
      bucket: config.bucket,
      key: `${destinationPrefix}/_manifest.json`,
      body: Buffer.from(JSON.stringify({ ...manifest, failed, missing: missing.slice(0, 500) }, null, 2)),
      contentType: "application/json",
    });
  }

  return { manifest, failed, missing };
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { known: KNOWN_OPTIONS, flags: FLAGS });
  const dryRun = options["dry-run"] === true;
  const concurrency = Math.max(1, Math.min(32, Number(options.concurrency || 8)));
  const config = loadMediaBackupConfig(process.env);

  if (config.sourceBuckets.includes(config.bucket)) {
    throw new Error(
      `BACKUP_R2_BUCKET (${config.bucket}) is also a source bucket. The backup bucket must be separate ` +
        "from the media buckets, or a deletion there would delete the copy too.",
    );
  }

  log.info("media backup starting", {
    sources: config.sourceBuckets,
    destination: config.bucket,
    dryRun,
    concurrency,
  });

  const client = createClient(config);
  const results = [];

  for (const bucket of config.sourceBuckets) {
    const result = await mirrorBucket(client, config, bucket, { dryRun, concurrency });
    results.push(result);
  }

  const failed = results.flatMap((result) => result.failed);
  const missing = results.flatMap((result) => result.missing);

  if (failed.length) {
    log.error("some objects failed to copy", { count: failed.length, sample: failed.slice(0, 10) });
  }
  if (missing.length) {
    log.error("verification found objects missing from the backup", {
      count: missing.length,
      sample: missing.slice(0, 10),
    });
  }

  // In a dry run nothing is copied by definition, so "missing from the backup"
  // is expected and must not be reported as a failure.
  const ok = dryRun ? failed.length === 0 : failed.length === 0 && missing.length === 0;

  emitSummary({
    ok,
    kind: "r2-media",
    dryRun,
    buckets: results.map((result) => result.manifest),
  });

  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  log.error("media backup failed", {
    code: error?.code ?? "EUNKNOWN",
    message: String(error?.message ?? error).slice(0, 2000),
  });
  process.exitCode = 1;
});
