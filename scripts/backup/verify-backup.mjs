#!/usr/bin/env node
/**
 * Verifies that a recent, intact backup exists.
 *
 * WHY THIS IS A SEPARATE SCRIPT
 *   "The scheduled job was green" only means the job did not throw. This asks
 *   the questions that actually matter: is there a manifest, does it describe a
 *   complete dump, is the object still there at the size it claims, and was it
 *   taken recently enough to meet the recovery target? It is the step that turns
 *   silent backup failure into a red run — a backup that stopped happening is
 *   indistinguishable from one that never existed, until the day it is needed.
 *
 * CHECKS
 *   1. A manifest exists and matches the expected schema.
 *   2. The dump object exists and its stored size equals the manifest's.
 *   3. The manifest is younger than `--max-age-hours` (default 36, i.e. one
 *      missed daily run is tolerated, two are not).
 *   4. With `--download`, the ciphertext's SHA-256 equals the manifest's.
 *
 * USAGE
 *   node scripts/backup/verify-backup.mjs --latest [--max-age-hours 36] [--download]
 *   node scripts/backup/verify-backup.mjs --manifest ./backup-out/manifest.json --local-file ./backup-out/x.dump.age
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { parseArgs } from "./lib/args.mjs";
import { loadStorageConfig } from "./lib/config.mjs";
import { log, emitSummary } from "./lib/log.mjs";
import { isManagedManifestKey, validateManifest } from "./lib/manifest.mjs";
import { createClient, getObjectBuffer, headObject, listAll } from "./lib/r2.mjs";

const KNOWN_OPTIONS = ["latest", "object", "manifest", "local-file", "max-age-hours", "download"];
const FLAGS = ["latest", "download"];

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { known: KNOWN_OPTIONS, flags: FLAGS });
  const maxAgeHours = Number(options["max-age-hours"] || 36);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("--max-age-hours must be a positive number");
  }

  // Local mode: verify a manifest and dump that exist on this machine (used by
  // the restore drill and by an operator before uploading a manual backup).
  if (options.manifest) {
    const manifestPath = path.resolve(options.manifest);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const problems = validateManifest(manifest);
    if (problems.length) throw new Error(`manifest is invalid: ${problems.join("; ")}`);

    if (options["local-file"]) {
      const filePath = path.resolve(options["local-file"]);
      const info = await stat(filePath);
      if (info.size !== manifest.dump.bytesEncrypted) {
        throw new Error(`local file size ${info.size} != manifest bytesEncrypted ${manifest.dump.bytesEncrypted}`);
      }
      const digest = await sha256File(filePath);
      if (digest !== manifest.dump.sha256Encrypted) {
        throw new Error(`local file checksum ${digest} != manifest sha256Encrypted ${manifest.dump.sha256Encrypted}`);
      }
    }

    const ageHours = (Date.now() - Date.parse(manifest.createdAt)) / 3_600_000;
    if (ageHours > maxAgeHours) {
      throw new Error(`backup is ${ageHours.toFixed(1)}h old, older than the ${maxAgeHours}h limit`);
    }

    emitSummary({ ok: true, mode: "local", manifest: manifestPath, createdAt: manifest.createdAt, ageHours });
    return;
  }

  const storage = loadStorageConfig(process.env);
  const client = createClient(storage);

  let manifestKey;
  if (options.object) {
    manifestKey = String(options.object).endsWith(".manifest.json")
      ? String(options.object)
      : String(options.object).replace(/\.dump\.age$/, ".manifest.json");
  } else if (options.latest) {
    const listed = await listAll(client, { bucket: storage.bucket, prefix: `${storage.prefix}/` });
    const candidates = listed
      .map((object) => object.key)
      .filter((key) => isManagedManifestKey(key, storage.prefix))
      .sort();
    if (candidates.length === 0) {
      throw new Error(`NO BACKUPS FOUND under s3://${storage.bucket}/${storage.prefix}/`);
    }
    manifestKey = candidates[candidates.length - 1];
  } else {
    throw new Error("Choose what to verify: --latest, --object <key>, or --manifest <path>");
  }

  const manifest = JSON.parse((await getObjectBuffer(client, { bucket: storage.bucket, key: manifestKey })).toString("utf8"));
  const problems = validateManifest(manifest);
  if (problems.length) throw new Error(`manifest ${manifestKey} is invalid: ${problems.join("; ")}`);

  const head = await headObject(client, { bucket: storage.bucket, key: manifest.objectKey });
  if (!head) throw new Error(`dump object ${manifest.objectKey} is MISSING from the bucket`);
  if (Number(head.ContentLength) !== manifest.dump.bytesEncrypted) {
    throw new Error(
      `dump object size ${head.ContentLength} != manifest bytesEncrypted ${manifest.dump.bytesEncrypted}`,
    );
  }

  const ageHours = (Date.now() - Date.parse(manifest.createdAt)) / 3_600_000;
  if (ageHours > maxAgeHours) {
    throw new Error(
      `newest backup is ${ageHours.toFixed(1)}h old, older than the ${maxAgeHours}h limit — backups have stopped`,
    );
  }

  let checksumVerified = false;
  if (options.download) {
    const buffer = await getObjectBuffer(client, { bucket: storage.bucket, key: manifest.objectKey });
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== manifest.dump.sha256Encrypted) {
      throw new Error(`downloaded dump checksum ${digest} != manifest ${manifest.dump.sha256Encrypted}`);
    }
    checksumVerified = true;
  }

  log.info("backup verified", { manifestKey, ageHours, checksumVerified });
  emitSummary({
    ok: true,
    mode: "remote",
    bucket: storage.bucket,
    manifestKey,
    objectKey: manifest.objectKey,
    createdAt: manifest.createdAt,
    ageHours,
    checksumVerified,
  });
}

main().catch((error) => {
  log.error("backup verification FAILED", {
    code: error?.code ?? "EUNKNOWN",
    message: String(error?.message ?? error).slice(0, 2000),
  });
  process.exitCode = 1;
});
