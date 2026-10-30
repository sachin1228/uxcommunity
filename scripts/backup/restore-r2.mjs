#!/usr/bin/env node
/**
 * Copies media back from the backup bucket into the live bucket.
 *
 * WHY A RESTORE SCRIPT AND NOT A DOCUMENTED `wrangler` COMMAND
 *   The recovery moment is the worst time to discover that the operator's
 *   machine has no Cloudflare token, or that the CLI version changed a flag.
 *   This uses the same credentials and the same client as the backup that
 *   created the copy, refuses to overwrite a live object unless told to, and
 *   verifies the object's size after copying.
 *
 * WHAT IT CANNOT DO
 *   It restores keys that exist in the backup. It cannot recover a key that was
 *   deleted before the first successful mirror run — see
 *   audit/DISASTER_RECOVERY_RUNBOOK.md §3.
 *
 * USAGE
 *   # what is in the backup?
 *   node scripts/backup/restore-r2.mjs --bucket uxcommunity-private --list
 *
 *   # restore one object
 *   node scripts/backup/restore-r2.mjs --bucket uxcommunity-private \
 *     --key "resumes/<user>/<file>.pdf"
 *
 *   # restore everything under a prefix (e.g. one conversation's DM images)
 *   node scripts/backup/restore-r2.mjs --bucket uxcommunity-private --prefix "dm/<conversation>/"
 *
 *   # restore an entire lost bucket
 *   node scripts/backup/restore-r2.mjs --bucket drafthub --all
 */

import { parseArgs } from "./lib/args.mjs";
import { loadMediaBackupConfig } from "./lib/config.mjs";
import { log, emitSummary } from "./lib/log.mjs";
import { backupKeyFor } from "./lib/manifest.mjs";
import { copyObject, createClient, headObject, listAll } from "./lib/r2.mjs";

const KNOWN_OPTIONS = ["bucket", "key", "prefix", "list", "all", "overwrite", "dry-run"];
const FLAGS = ["list", "all", "overwrite", "dry-run"];

async function main() {
  const options = parseArgs(process.argv.slice(2), { known: KNOWN_OPTIONS, flags: FLAGS });
  const sourceBucket = options.bucket;
  if (!sourceBucket) throw new Error("--bucket is required (the live bucket to restore INTO)");

  const config = loadMediaBackupConfig(process.env);
  if (!config.sourceBuckets.includes(sourceBucket)) {
    throw new Error(
      `Refusing to restore into ${sourceBucket}: it is not one of the configured media buckets ` +
        `(${config.sourceBuckets.join(", ")}). The backup bucket itself is never a restore target.`,
    );
  }

  const client = createClient(config);
  const backupPrefix = `r2/${sourceBucket}/`;

  if (options.list) {
    const objects = await listAll(client, { bucket: config.bucket, prefix: backupPrefix });
    for (const object of objects) {
      process.stdout.write(`${object.size}\t${object.key.slice(backupPrefix.length)}\n`);
    }
    emitSummary({ ok: true, bucket: sourceBucket, objects: objects.length });
    return;
  }

  if (!options.key && !options.prefix && !options.all) {
    throw new Error("Choose what to restore: --key <key>, --prefix <prefix>, --all, or --list");
  }

  const wanted = options.key
    ? [options.key].map((key) => ({ key, size: null }))
    : (await listAll(client, {
        bucket: config.bucket,
        // `--all` restores a whole bucket after the live one was lost.
        prefix: options.all ? backupPrefix : backupKeyFor(sourceBucket, options.prefix),
      }))
        .filter((object) => object.key !== `${backupPrefix}_manifest.json`)
        .map((object) => ({ key: object.key.slice(backupPrefix.length), size: object.size }));

  if (wanted.length === 0) {
    throw new Error(`Nothing found in the backup under ${backupKeyFor(sourceBucket, options.prefix ?? options.key)}`);
  }

  log.info("media restore starting", {
    into: sourceBucket,
    objects: wanted.length,
    dryRun: options["dry-run"] === true,
  });

  const restored = [];
  const skipped = [];
  const failed = [];

  for (const item of wanted) {
    const destinationKey = item.key;
    const backupKey = backupKeyFor(sourceBucket, destinationKey);

    const existing = await headObject(client, { bucket: sourceBucket, key: destinationKey });
    if (existing && !options.overwrite) {
      skipped.push(destinationKey);
      log.warn("destination object already exists — pass --overwrite to replace it", { key: destinationKey });
      continue;
    }
    if (options["dry-run"]) {
      restored.push(destinationKey);
      continue;
    }

    try {
      await copyObject(client, {
        sourceBucket: config.bucket,
        sourceKey: backupKey,
        destinationBucket: sourceBucket,
        destinationKey,
      });
      const head = await headObject(client, { bucket: sourceBucket, key: destinationKey });
      if (!head) throw new Error("object missing after copy");
      if (item.size !== null && Number(head.ContentLength) !== item.size) {
        throw new Error(`size mismatch after copy: ${head.ContentLength} != ${item.size}`);
      }
      restored.push(destinationKey);
    } catch (error) {
      failed.push({ key: destinationKey, error: String(error?.message ?? error).slice(0, 300) });
    }
  }

  emitSummary({
    ok: failed.length === 0,
    bucket: sourceBucket,
    dryRun: options["dry-run"] === true,
    restored: restored.length,
    skipped: skipped.length,
    failed,
  });

  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  log.error("media restore failed", { message: String(error?.message ?? error).slice(0, 2000) });
  process.exitCode = 1;
});
