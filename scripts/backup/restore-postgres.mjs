#!/usr/bin/env node
/**
 * Restores an encrypted PostgreSQL backup and proves what it restored.
 *
 * WHAT IT DOES
 *   1. Resolves the backup (a local `.dump.age` + manifest, a named object, or
 *      the newest manifest in the bucket).
 *   2. Verifies the ciphertext SHA-256 against the manifest.
 *   3. Decrypts with the operator's age identity.
 *   4. Verifies the plaintext SHA-256 against the manifest.
 *   5. Refuses to write into the production database unless `--allow-production`.
 *   6. `pg_restore`s with `--exit-on-error`, timing the restore.
 *   7. Re-checks row counts against the manifest and runs structural checks
 *      (invalid indexes, unvalidated foreign keys, table count).
 *
 * WHY THE PRODUCTION GUARD EXISTS
 *   The most destructive possible accident during a disaster is pointing a test
 *   restore at the live database. `SUPABASE_DB_URL` is by definition the
 *   production URL in CI and on the operator's machine, so a target equal to it
 *   is refused unless the operator says so explicitly.
 *
 * WHY COUNTS ARE CHECKED BY DEFAULT
 *   A restore that exits 0 but lost a table is the exact failure this whole
 *   exercise exists to prevent. A count mismatch fails the run; use
 *   `--allow-count-drift` when restoring a live database where rows changed
 *   between the count snapshot and the dump (the runbook explains the tolerance).
 *
 * USAGE
 *   node scripts/backup/restore-postgres.mjs --latest --target-url <url>
 *   node scripts/backup/restore-postgres.mjs --object db/2026/10/30/...dump.age --target-url <url>
 *   node scripts/backup/restore-postgres.mjs --file ./x.dump.age --manifest ./manifest.json --target-url <url>
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseArgs } from "./lib/args.mjs";
import { isSameDatabase, loadStorageConfig, redactUrl } from "./lib/config.mjs";
import { log, emitSummary } from "./lib/log.mjs";
import { runOrThrow } from "./lib/exec.mjs";
import {
  databaseHealth,
  ensureDatabase,
  ensureExtensions,
  pingDatabase,
  restoreDatabase,
  tableRowCounts,
} from "./lib/postgres.mjs";
import { isManagedManifestKey } from "./lib/manifest.mjs";
import { createClient, getObjectBuffer, listAll } from "./lib/r2.mjs";

const TOTAL_STEPS = 7;
const KNOWN_OPTIONS = [
  "target-url",
  "file",
  "manifest",
  "object",
  "latest",
  "identity",
  "jobs",
  "allow-production",
  "allow-count-drift",
  "create-db",
];
const FLAGS = ["latest", "allow-production", "allow-count-drift", "create-db"];

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Resolves the age identity. A file path is used directly; an inline
 * `AGE-SECRET-KEY-...` string is written to a 0600 temp file because `age`
 * insists on reading the identity from a file.
 */
async function resolveIdentity(option, workDir) {
  const value = option || process.env.AGE_IDENTITY;
  if (!value) {
    throw new Error(
      "No age identity. Pass --identity <path> or set AGE_IDENTITY. " +
        "The private key is kept offline and is never stored in the repository or in CI.",
    );
  }
  if (value.startsWith("AGE-SECRET-KEY-")) {
    const file = path.join(workDir, "identity.txt");
    await writeFile(file, `${value}\n`, { mode: 0o600 });
    return file;
  }
  return path.resolve(value);
}

async function resolveSource(options) {
  const provided = [options.file, options.object, options.latest].filter(Boolean).length;
  if (provided > 1) throw new Error("Choose exactly one of --file, --object or --latest");

  if (options.file) {
    const dumpPath = path.resolve(options.file);
    const manifestPath = options.manifest
      ? path.resolve(options.manifest)
      : path.join(path.dirname(dumpPath), "manifest.json");
    let raw;
    try {
      raw = await readFile(manifestPath, "utf8");
    } catch {
      throw new Error(
        `No manifest at ${manifestPath}. A backup is only verifiable with its manifest; ` +
          "pass --manifest <path> or place manifest.json next to the dump.",
      );
    }
    const manifest = JSON.parse(raw);
    return { manifest, dumpPath, source: manifestPath, remote: false };
  }

  const storage = loadStorageConfig(process.env);
  const client = createClient(storage);

  let manifestKey;
  if (options.object) {
    if (!String(options.object).endsWith(".dump.age")) {
      throw new Error("--object must name a .dump.age backup");
    }
    manifestKey = String(options.object).replace(/\.dump\.age$/, ".manifest.json");
  } else if (options.latest) {
    const listed = await listAll(client, { bucket: storage.bucket, prefix: `${storage.prefix}/` });
    const candidates = listed
      .map((object) => object.key)
      .filter((key) => isManagedManifestKey(key, storage.prefix))
      .sort();
    if (candidates.length === 0) {
      throw new Error(`No backups found under s3://${storage.bucket}/${storage.prefix}/`);
    }
    manifestKey = candidates[candidates.length - 1];
  } else {
    throw new Error("Choose a backup: --latest, --object <key>, or --file <path>");
  }

  const manifest = JSON.parse(
    (await getObjectBuffer(client, { bucket: storage.bucket, key: manifestKey })).toString("utf8"),
  );
  const dumpBuffer = await getObjectBuffer(client, { bucket: storage.bucket, key: manifest.objectKey });
  const dumpPath = path.join(await mkdtemp(path.join(tmpdir(), "uxc-restore-src-")), "dump.age");
  await writeFile(dumpPath, dumpBuffer, { mode: 0o600 });

  return { manifest, dumpPath, source: `s3://${storage.bucket}/${manifestKey}`, remote: true };
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { known: KNOWN_OPTIONS, flags: FLAGS });
  const targetUrl = options["target-url"];
  if (!targetUrl) throw new Error("--target-url is required (the database to restore INTO)");

  const startedAt = Date.now();
  log.info("restore starting", { target: redactUrl(targetUrl) });

  log.step(1, TOTAL_STEPS, "resolving backup source");
  const resolved = await resolveSource(options);
  const { manifest } = resolved;
  log.info("backup selected", {
    source: resolved.source,
    createdAt: manifest.createdAt,
    sourceDatabase: manifest.source?.database,
    bytesEncrypted: manifest.dump?.bytesEncrypted,
  });

  const workDir = await mkdtemp(path.join(tmpdir(), "uxc-restore-"));
  try {
    log.step(2, TOTAL_STEPS, "verifying ciphertext checksum");
    const cipherSha = await sha256File(resolved.dumpPath);
    if (cipherSha !== manifest.dump.sha256Encrypted) {
      throw new Error(
        `ciphertext checksum mismatch: manifest says ${manifest.dump.sha256Encrypted}, file is ${cipherSha}. ` +
          "The backup is corrupt or was modified — do not restore it.",
      );
    }

    log.step(3, TOTAL_STEPS, "decrypting");
    const identityFile = await resolveIdentity(options.identity, workDir);
    const plainFile = path.join(workDir, "dump.pgc");
    await runOrThrow("age", ["--decrypt", "--identity", identityFile, "--output", plainFile, resolved.dumpPath]);

    log.step(4, TOTAL_STEPS, "verifying plaintext checksum");
    const plainSha = await sha256File(plainFile);
    if (plainSha !== manifest.dump.sha256Plain) {
      throw new Error(
        `plaintext checksum mismatch: manifest says ${manifest.dump.sha256Plain}, decrypted file is ${plainSha}`,
      );
    }

    log.step(5, TOTAL_STEPS, "checking the restore target");
    const productionUrl = process.env.SUPABASE_DB_URL;
    if (productionUrl && isSameDatabase(targetUrl, productionUrl) && !options["allow-production"]) {
      throw new Error(
        "REFUSING to restore into the production database (--target-url matches SUPABASE_DB_URL). " +
          "Restoring overwrites data. Test the restore in an isolated database, or pass " +
          "--allow-production only when this IS the incident recovery and you have confirmed the backup.",
      );
    }
    if (!(await pingDatabase(targetUrl))) {
      throw new Error(`Cannot connect to the restore target ${redactUrl(targetUrl)}`);
    }
    if (options["create-db"]) {
      const created = await ensureDatabase(targetUrl);
      log.info(created ? "created target database" : "target database already exists");
    }

    // Must happen before pg_restore: the dump excludes CREATE EXTENSION, and a
    // table whose column default calls gen_random_bytes() cannot be created
    // without it.
    const appliedExtensions = await ensureExtensions(targetUrl, manifest.extensions);
    if (appliedExtensions.length) {
      log.info("extensions ensured on target", { extensions: appliedExtensions.map((e) => `${e.name}@${e.schema}`) });
    }

    log.step(6, TOTAL_STEPS, "restoring");
    const restoreStartedAt = Date.now();
    await restoreDatabase({ dbUrl: targetUrl, file: plainFile, jobs: Number(options.jobs || 1) });
    const restoreMs = Date.now() - restoreStartedAt;
    log.info("pg_restore finished", { restoreMs });

    log.step(7, TOTAL_STEPS, "verifying restored data");
    const health = await databaseHealth(targetUrl);
    const restoredCounts = await tableRowCounts(targetUrl, Object.keys(manifest.rowCounts ?? {}));

    const countDiffs = [];
    for (const [table, expected] of Object.entries(manifest.rowCounts ?? {})) {
      const actual = restoredCounts[table];
      if (actual === undefined) {
        countDiffs.push({ table, expected, actual: "MISSING TABLE" });
      } else if (actual !== expected) {
        countDiffs.push({ table, expected, actual, delta: actual - expected });
      }
    }

    const countsOk = countDiffs.length === 0;

    log.info("restored data", {
      counts: restoredCounts,
      health,
      restoreMs,
      totalMs: Date.now() - startedAt,
    });

    if (!health.healthy) {
      throw new Error(
        `restored database is structurally unhealthy: invalidIndexes=${health.invalidIndexes}, ` +
          `unvalidatedForeignKeys=${health.unvalidatedFks}, publicTables=${health.publicTables}`,
      );
    }
    if (!countsOk && !options["allow-count-drift"]) {
      throw new Error(
        `row counts differ from the manifest: ${JSON.stringify(countDiffs)}. ` +
          "Investigate before using this database; pass --allow-count-drift only when the live " +
          "database changed between the count snapshot and the dump.",
      );
    }
    if (!countsOk) log.warn("row counts differ from the manifest (allowed by --allow-count-drift)", { countDiffs });

    emitSummary({
      ok: true,
      kind: "postgres",
      source: resolved.source,
      backupCreatedAt: manifest.createdAt,
      target: redactUrl(targetUrl),
      restoreMs,
      totalMs: Date.now() - startedAt,
      rowCounts: restoredCounts,
      countDiffs,
      health,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
    if (resolved.remote) await rm(path.dirname(resolved.dumpPath), { recursive: true, force: true });
  }
}

main().catch((error) => {
  log.error("restore failed", {
    code: error?.code ?? "EUNKNOWN",
    message: String(error?.message ?? error).slice(0, 2000),
  });
  process.exitCode = 1;
});
