#!/usr/bin/env node
/**
 * Encrypted PostgreSQL backup.
 *
 * WHAT IT DOES, IN ORDER
 *   1. Preflight: tools present, pg_dump new enough for the server, schemas exist.
 *   2. Record exact row counts for the tables that matter (into the manifest).
 *   3. `pg_dump --format=custom` the application schemas into a private temp file.
 *   4. SHA-256 the plaintext, encrypt with `age` to the operator's public key,
 *      SHA-256 the ciphertext.
 *   5. Upload ciphertext + checksum + manifest, then HEAD the object to prove it
 *      landed at the expected size.
 *   6. Apply retention, deleting only backups this tool wrote and never the
 *      newest `BACKUP_KEEP_MINIMUM`.
 *   7. Delete the local plaintext and ciphertext.
 *
 * WHY AGE AND NOT A PASSPHRASE
 *   Encryption here is public-key: the machine that takes backups only ever
 *   holds the *public* key, so a compromised CI runner or a leaked repository
 *   secret cannot decrypt a single stored backup. The private key stays with the
 *   operator, offline (see audit/DISASTER_RECOVERY_RUNBOOK.md §10).
 *
 * WHY THE DUMP IS WRITTEN TO DISK FIRST
 *   `pg_dump` needs to finish before the plaintext hash exists, and the hash is
 *   what makes a restore verifiable. The temp directory is created with mode
 *   0700 and removed even when the run fails, so a failed backup never leaves
 *   an unencrypted dump behind.
 *
 * USAGE
 *   node scripts/backup/backup-postgres.mjs [--dry-run] [--no-upload] [--out-dir DIR]
 *                                           [--retention-days N] [--keep-minimum N]
 *                                           [--exclude-schemas a,b] [--tables a,b]
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgs } from "./lib/args.mjs";
import { loadBackupConfig, redactUrl } from "./lib/config.mjs";
import { log, emitSummary } from "./lib/log.mjs";
import { runOrThrow } from "./lib/exec.mjs";
import {
  assertClientCompatible,
  assertToolchain,
  dumpDatabase,
  listExtensions,
  tableRowCounts,
} from "./lib/postgres.mjs";
import {
  backupKeys,
  buildDatabaseManifest,
  isManagedManifestKey,
  selectExpiredManifests,
  validateManifest,
} from "./lib/manifest.mjs";
import { createClient, deleteObject, getObjectBuffer, headObject, listAll, putObject } from "./lib/r2.mjs";

const TOTAL_STEPS = 7;
const KNOWN_OPTIONS = [
  "dry-run",
  "no-upload",
  "out-dir",
  "retention-days",
  "keep-minimum",
  "exclude-schemas",
  "tables",
];
const FLAGS = ["dry-run", "no-upload"];

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function ageRecipientArgument(recipient) {
  if (!/^age1[0-9a-z]{20,}$/.test(recipient.trim())) {
    throw new Error(
      "BACKUP_AGE_RECIPIENT does not look like an age public key (`age1...`). " +
        "Encrypting to a malformed recipient would produce an unrecoverable backup, so this is fatal.",
    );
  }
  return recipient.trim();
}

/**
 * Deletes backups past retention. Only manifests are listed first, and only
 * keys that `isManagedManifestKey` recognises can be deleted — a bug in this
 * function must never be able to delete media objects.
 */
async function applyRetention(client, config, now) {
  const listed = await listAll(client, { bucket: config.bucket, prefix: `${config.prefix}/` });
  const manifestKeys = listed
    .map((object) => object.key)
    .filter((key) => isManagedManifestKey(key, config.prefix));

  const manifests = [];
  for (const key of manifestKeys) {
    try {
      const body = await getObjectBuffer(client, { bucket: config.bucket, key });
      const parsed = JSON.parse(body.toString("utf8"));
      const problems = validateManifest(parsed);
      if (problems.length) {
        log.warn("skipping unreadable manifest (never deleted automatically)", { key, problems });
        continue;
      }
      manifests.push({ key, createdAt: parsed.createdAt, objectKey: parsed.objectKey, checksumKey: parsed.checksumKey });
    } catch (error) {
      log.warn("manifest could not be fetched or parsed", { key, error: String(error?.message ?? error) });
    }
  }

  const { keep, remove } = selectExpiredManifests(manifests, {
    now,
    retentionDays: config.retentionDays,
    keepMinimum: config.keepMinimum,
  });

  for (const key of remove) {
    const entry = manifests.find((manifest) => manifest.key === key);
    for (const target of [entry.objectKey, entry.checksumKey, entry.key]) {
      if (!target) continue;
      await deleteObject(client, { bucket: config.bucket, key: target });
    }
    log.info("retention: deleted expired backup", { key, createdAt: entry.createdAt });
  }

  return { manifestCount: manifests.length, kept: keep.length, removed: remove.length };
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { known: KNOWN_OPTIONS, flags: FLAGS });
  const localOnly = options["no-upload"] === true;
  const dryRun = options["dry-run"] === true;
  const startedAt = Date.now();
  const createdAt = new Date();

  const config = loadBackupConfig(process.env, { requireUpload: !localOnly });
  for (const [option, field] of [
    ["retention-days", "retentionDays"],
    ["keep-minimum", "keepMinimum"],
  ]) {
    if (!options[option]) continue;
    const parsed = Number(options[option]);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`--${option} must be a positive integer (received ${JSON.stringify(options[option])})`);
    }
    config[field] = parsed;
  }
  if (options["exclude-schemas"]) {
    config.excludeSchemas = String(options["exclude-schemas"]).split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (options.tables) config.countTables = String(options.tables).split(",").map((s) => s.trim()).filter(Boolean);

  log.info("database backup starting", {
    source: redactUrl(config.dbUrl),
    bucket: localOnly ? "(local only)" : config.bucket,
    dryRun,
  });

  log.step(1, TOTAL_STEPS, "checking tools");
  const versions = await assertToolchain();

  log.step(2, TOTAL_STEPS, "checking pg_dump compatibility with the server");
  const compatibility = await assertClientCompatible(config.dbUrl);
  log.info("version compatibility confirmed", {
    server: compatibility.serverMajor,
    client: compatibility.clientMajor,
    pgDump: versions.pg_dump,
  });

  log.step(3, TOTAL_STEPS, "recording extensions and row counts");
  const extensions = await listExtensions(config.dbUrl);
  const rowCounts = await tableRowCounts(config.dbUrl, config.countTables);
  log.info("captured database state", {
    extensions: extensions.map((extension) => `${extension.name}@${extension.schema}`),
    rowCounts,
  });

  const workDir = await mkdtemp(path.join(tmpdir(), "uxc-backup-"));
  const dumpFile = path.join(workDir, "dump.pgc");
  const encryptedFile = `${dumpFile}.age`;
  const keys = backupKeys(config.prefix, createdAt);

  let summary;
  try {
    log.step(4, TOTAL_STEPS, "dumping database");
    await dumpDatabase({ dbUrl: config.dbUrl, excludeSchemas: config.excludeSchemas, outFile: dumpFile });
    const dumpStat = await stat(dumpFile);
    if (dumpStat.size === 0) throw new Error("pg_dump produced an empty file");
    const sha256Plain = await sha256File(dumpFile);

    log.step(5, TOTAL_STEPS, "encrypting dump");
    await runOrThrow("age", [
      "--encrypt",
      "--recipient",
      ageRecipientArgument(config.ageRecipient),
      "--output",
      encryptedFile,
      dumpFile,
    ]);
    const encryptedStat = await stat(encryptedFile);
    const sha256Encrypted = await sha256File(encryptedFile);

    const manifest = buildDatabaseManifest({
      createdAt,
      keys,
      database: config.database,
      serverVersion: compatibility.serverVersionNum,
      excludedSchemas: config.excludeSchemas,
      dump: {
        bytesPlain: dumpStat.size,
        bytesEncrypted: encryptedStat.size,
        sha256Plain,
        sha256Encrypted,
      },
      encryption: { recipient: config.ageRecipient },
      extensions,
      rowCounts,
      retention: { days: config.retentionDays, keepMinimum: config.keepMinimum },
      durationMs: Date.now() - startedAt,
    });
    const manifestProblems = validateManifest(manifest);
    if (manifestProblems.length) {
      throw new Error(`Refusing to upload an invalid manifest: ${manifestProblems.join("; ")}`);
    }

    let upload = { uploaded: false };
    if (dryRun) {
      log.step(6, TOTAL_STEPS, "dry run: skipping upload and retention");
    } else if (localOnly) {
      // The drill and an operator on the road both need the artifacts to outlive
      // the temp directory, which is removed even on success.
      const outDir = path.resolve(options["out-dir"] || path.join(process.cwd(), "backup-out"));
      await mkdir(outDir, { recursive: true, mode: 0o700 });
      const dumpPath = path.join(outDir, path.basename(keys.dump));
      await copyFile(encryptedFile, dumpPath);
      await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
      await writeFile(`${dumpPath}.sha256`, `${sha256Encrypted}  ${path.basename(keys.dump)}\n`);
      log.step(6, TOTAL_STEPS, "local-only run: artifacts written", { outDir, file: path.basename(dumpPath) });
      upload = { uploaded: false, localDir: outDir, file: dumpPath, manifestPath: path.join(outDir, "manifest.json") };
    } else {
      log.step(6, TOTAL_STEPS, "uploading encrypted dump and manifest");
      const client = createClient(config);
      await putObject(client, { bucket: config.bucket, key: keys.dump, body: await readFile(encryptedFile), contentType: "application/octet-stream" });
      await putObject(client, { bucket: config.bucket, key: keys.checksum, body: Buffer.from(`${sha256Encrypted}  ${path.basename(keys.dump)}\n`), contentType: "text/plain" });
      await putObject(client, { bucket: config.bucket, key: keys.manifest, body: Buffer.from(JSON.stringify(manifest, null, 2)), contentType: "application/json" });

      // HEAD after upload: a 200 from PutObject is not proof that the object is
      // retrievable at the size we sent.
      const head = await headObject(client, { bucket: config.bucket, key: keys.dump });
      if (!head) throw new Error(`upload verification failed: ${keys.dump} is not readable after upload`);
      if (Number(head.ContentLength) !== encryptedStat.size) {
        throw new Error(
          `upload verification failed: stored size ${head.ContentLength} != local size ${encryptedStat.size}`,
        );
      }
      log.info("upload verified", { key: keys.dump, bytes: encryptedStat.size });

      log.step(7, TOTAL_STEPS, "applying retention");
      const retention = await applyRetention(client, config, createdAt);
      log.info("retention applied", retention);
      upload = { uploaded: true, bucket: config.bucket, key: keys.dump, retention };
    }

    summary = {
      ok: true,
      kind: "postgres",
      createdAt: manifest.createdAt,
      durationMs: Date.now() - startedAt,
      objectKey: keys.dump,
      bytesPlain: dumpStat.size,
      bytesEncrypted: encryptedStat.size,
      sha256Encrypted,
      rowCounts,
      upload,
    };
  } finally {
    // The plaintext dump must not survive the process, whatever happened.
    await rm(workDir, { recursive: true, force: true });
  }

  log.info("database backup complete", { durationMs: summary.durationMs });
  emitSummary(summary);
}

main().catch((error) => {
  log.error("database backup failed", {
    code: error?.code ?? "EUNKNOWN",
    message: String(error?.message ?? error).slice(0, 2000),
  });
  process.exitCode = 1;
});
