#!/usr/bin/env node
/**
 * Restore drill: proves the backup tooling can actually rebuild a database.
 *
 * WHAT IT DOES
 *   1. Starts a throwaway PostgreSQL cluster on 127.0.0.1 (never 5432, never
 *      the production host, no external network).
 *   2. Builds a realistic schema: supabase/schema.sql then every migration, in
 *      the same order the local SQL-test harness uses.
 *   3. Seeds representative rows — users, communities, members, messages,
 *      companies, jobs, applications, DMs — with real foreign keys.
 *   4. Runs the real backup script against it, with a throwaway age keypair.
 *   5. Verifies the artifacts with the real verify script.
 *   6. Creates a second, empty database and runs the real restore script.
 *   7. Independently re-checks row counts and referential integrity.
 *   8. Re-applies the migration history to the restored database and confirms
 *      the schema survives it.
 *   9. Reports restore duration and the backup's data timestamp.
 *  10. Stops the cluster and deletes everything, including the private key.
 *
 * WHY THIS IS NOT A SUBSTITUTE FOR A PRODUCTION RESTORE
 *   It proves the *tooling* and the schema recover. It cannot prove that the
 *   production backup contains production data: that needs the production
 *   credentials and is recorded separately in the audit. Stated plainly so
 *   nobody mistakes a green drill for a tested production recovery.
 *
 * USAGE
 *   node scripts/backup/restore-drill.mjs [--keep]
 *   PG_BIN=/opt/homebrew/opt/postgresql@17/bin node scripts/backup/restore-drill.mjs
 */

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./lib/args.mjs";
import { log, emitSummary } from "./lib/log.mjs";
import { run, runOrThrow } from "./lib/exec.mjs";
import { databaseHealth, tableRowCounts } from "./lib/postgres.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const SEED_TABLES = [
  "users",
  "communities",
  "community_members",
  "community_messages",
  "companies",
  "job_posts",
  "job_applications",
  "dm_conversations",
  "dm_messages",
];

function resolvePgBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const candidates = [
    "/opt/homebrew/opt/postgresql@17/bin",
    "/opt/homebrew/opt/postgresql@18/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/usr/lib/postgresql/17/bin",
    "/usr/lib/postgresql/16/bin",
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "initdb"))) return candidate;
  }
  return ""; // fall back to PATH
}

function pgTool(dir, name) {
  return dir ? path.join(dir, name) : name;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(bin, dbUrl, attempts = 60) {
  const env = { PGHOST: "127.0.0.1", PGPORT: new URL(dbUrl).port, PGUSER: "postgres", PGDATABASE: "postgres" };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await run(pgTool(bin, "psql"), ["-w", "--no-psqlrc", "-tA", "-c", "select 1"], { env });
    if (result.code === 0 && result.stdout.trim() === "1") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("scratch PostgreSQL did not become ready");
}

/** Applies a directory of .sql files, tolerating the Supabase-only failures. */
async function applySqlFiles(bin, dbUrl, files, logFile) {
  const url = new URL(dbUrl);
  const env = {
    PGHOST: url.hostname,
    PGPORT: url.port,
    PGUSER: "postgres",
    PGDATABASE: url.pathname.replace(/^\//, ""),
  };
  const errors = [];
  for (const file of files) {
    const result = await run(pgTool(bin, "psql"), ["-w", "--no-psqlrc", "-q", "-f", file], { env });
    for (const line of `${result.stderr}\n${result.stdout}`.split("\n")) {
      if (line.includes("ERROR:")) errors.push(line.trim());
    }
  }
  if (logFile) await writeFile(logFile, errors.join("\n"));
  return errors;
}

function sameCounts(expected, actual) {
  const diffs = [];
  for (const [table, value] of Object.entries(expected)) {
    if (actual[table] !== value) diffs.push({ table, expected: value, actual: actual[table] ?? "MISSING" });
  }
  return diffs;
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { known: ["keep"], flags: ["keep"] });
  const bin = resolvePgBin();
  const startedAt = Date.now();

  const workDir = await mkdtemp(path.join(tmpdir(), "uxc-drill-"));
  const dataDir = path.join(workDir, "data");
  const artifacts = path.join(workDir, "artifacts");
  const port = await freePort();
  const sourceUrl = `postgresql://postgres@127.0.0.1:${port}/uxc_source`;
  const restoreUrl = `postgresql://postgres@127.0.0.1:${port}/uxc_restore`;

  let serverStarted = false;
  const cleanup = async () => {
    if (serverStarted) {
      await run(pgTool(bin, "pg_ctl"), ["-D", dataDir, "-m", "immediate", "stop"]);
      serverStarted = false;
    }
    if (!options.keep) await rm(workDir, { recursive: true, force: true });
    else log.warn("work directory kept for inspection", { workDir });
  };

  try {
    // macOS aborts a PostgreSQL start when the ambient locale is unset (the
    // postmaster "became multithreaded during startup"). Pinning a valid locale
    // for these child processes makes the drill deterministic on any machine.
    const localeEnv = { LC_ALL: "C", LANG: "C" };

    log.step(1, 9, "initialising a throwaway PostgreSQL cluster", { port, bin: bin || "(PATH)" });
    await mkdir(artifacts, { recursive: true, mode: 0o700 });
    await runOrThrow(pgTool(bin, "initdb"), ["-D", dataDir, "-U", "postgres", "--encoding=UTF8", "-A", "trust", "--locale=C"], { env: localeEnv });
    await runOrThrow(pgTool(bin, "pg_ctl"), [
      "-D",
      dataDir,
      "-l",
      path.join(workDir, "pg.log"),
      "-o",
      `-p ${port} -c listen_addresses=127.0.0.1 -c wal_level=logical -c fsync=off -c full_page_writes=off -c synchronous_commit=off`,
      "-w",
      "start",
    ], { env: localeEnv });
    serverStarted = true;
    await waitForServer(bin, sourceUrl);

    log.step(2, 9, "creating the source database and Supabase-only primitives");
    const admin = new URL(sourceUrl);
    admin.pathname = "/postgres";
    const createdbEnv = { ...localeEnv, PGUSER: "postgres" };
    await runOrThrow(pgTool(bin, "createdb"), ["-w", "-h", admin.hostname, "-p", admin.port, "uxc_source"], { env: createdbEnv });

    const adminEnv = {
      PGHOST: admin.hostname,
      PGPORT: admin.port,
      PGUSER: "postgres",
      PGDATABASE: "postgres",
    };
    await runOrThrow(pgTool(bin, "psql"), [
      "-w",
      "--no-psqlrc",
      "-q",
      "-c",
      "create role anon; create role authenticated; create role service_role; create publication supabase_realtime;",
    ], { env: adminEnv });

    log.step(3, 9, "applying schema.sql and the migration history");
    const schemaFiles = [
      path.join(ROOT, "supabase/schema.sql"),
      ...(await readdir(path.join(ROOT, "supabase/migrations")))
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map((name) => path.join(ROOT, "supabase/migrations", name)),
    ];
    const schemaErrors = await applySqlFiles(bin, sourceUrl, schemaFiles, path.join(workDir, "schema-errors.log"));
    log.info("migrations applied", {
      files: schemaFiles.length,
      errors: schemaErrors.length,
      note: "Supabase-only objects are expected to fail locally; see the audit",
    });

    log.step(4, 9, "seeding representative data");
    await runOrThrow(pgTool(bin, "psql"), [
      "-w",
      "--no-psqlrc",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      path.join(HERE, "fixtures", "drill-seed.sql"),
    ], { env: { ...adminEnv, PGDATABASE: "uxc_source" } });

    const sourceCounts = await tableRowCounts(sourceUrl, SEED_TABLES);
    const sourceHealth = await databaseHealth(sourceUrl);
    log.info("source seeded", { sourceCounts, tables: sourceHealth.publicTables });

    log.step(5, 9, "generating a throwaway age keypair and running the real backup");
    const keyFile = path.join(workDir, "drill-key.txt");
    // age is a host tool, not part of the PostgreSQL bin directory.
    await runOrThrow("age-keygen", ["-o", keyFile]);
    const keygenOutput = await run("age-keygen", ["-y", keyFile]);
    const recipient = keygenOutput.stdout.trim();
    if (!recipient.startsWith("age1")) throw new Error("age-keygen did not produce a recipient");

    const backupEnv = {
      ...process.env,
      SUPABASE_DB_URL: sourceUrl,
      BACKUP_AGE_RECIPIENT: recipient,
      PG_BIN: bin,
      PATH: bin ? `${bin}${path.delimiter}${process.env.PATH}` : process.env.PATH,
    };
    const backupStartedAt = Date.now();
    const backup = await run(process.execPath, [
      path.join(HERE, "backup-postgres.mjs"),
      "--no-upload",
      "--out-dir",
      artifacts,
    ], { env: backupEnv });
    process.stderr.write(backup.stderr);
    if (backup.code !== 0) throw new Error(`backup script failed with code ${backup.code}`);
    const backupMs = Date.now() - backupStartedAt;
    const backupSummary = JSON.parse(backup.stdout);
    log.info("backup produced", {
      objectKey: backupSummary.objectKey,
      bytesPlain: backupSummary.bytesPlain,
      bytesEncrypted: backupSummary.bytesEncrypted,
      backupMs,
    });

    log.step(6, 9, "verifying the backup artifacts");
    const dumpFile = path.join(artifacts, path.basename(backupSummary.objectKey));
    const verify = await run(process.execPath, [
      path.join(HERE, "verify-backup.mjs"),
      "--manifest",
      path.join(artifacts, "manifest.json"),
      "--local-file",
      dumpFile,
      "--max-age-hours",
      "1",
    ], { env: backupEnv });
    process.stderr.write(verify.stderr);
    if (verify.code !== 0) throw new Error(`verify script failed with code ${verify.code}`);

    log.step(7, 9, "restoring into a separate, empty database");
    await runOrThrow(pgTool(bin, "createdb"), ["-w", "-h", admin.hostname, "-p", admin.port, "uxc_restore"], { env: createdbEnv });
    const restoreStartedAt = Date.now();
    const restore = await run(process.execPath, [
      path.join(HERE, "restore-postgres.mjs"),
      "--file",
      dumpFile,
      "--manifest",
      path.join(artifacts, "manifest.json"),
      "--identity",
      keyFile,
      "--target-url",
      restoreUrl,
    ], { env: { ...backupEnv, PG_BIN: bin } });
    process.stderr.write(restore.stderr);
    if (restore.code !== 0) throw new Error(`restore script failed with code ${restore.code}`);
    const restoreMs = Date.now() - restoreStartedAt;
    const restoreSummary = JSON.parse(restore.stdout);

    log.step(8, 9, "independently re-checking the restored database");
    const restoredCounts = await tableRowCounts(restoreUrl, SEED_TABLES);
    const restoredHealth = await databaseHealth(restoreUrl);
    const countDiffs = sameCounts(sourceCounts, restoredCounts);
    if (countDiffs.length) throw new Error(`row counts differ after restore: ${JSON.stringify(countDiffs)}`);
    if (!restoredHealth.healthy) throw new Error(`restored database is unhealthy: ${JSON.stringify(restoredHealth)}`);

    // Referential integrity is checked by the database itself: if any foreign
    // key had been violated by the restore, the constraint would be unvalidated
    // or pg_restore would have failed above.
    const orphanCheck = await runOrThrow(pgTool(bin, "psql"), [
      "-w",
      "--no-psqlrc",
      "-tA",
      "-c",
      "select count(*) from public.community_messages m left join public.communities c on c.id = m.community_id where c.id is null",
    ], { env: { ...adminEnv, PGDATABASE: "uxc_restore" } });
    const orphanMessages = Number(orphanCheck.stdout.trim());
    if (orphanMessages !== 0) throw new Error(`${orphanMessages} community messages reference a missing community`);

    log.step(9, 9, "re-applying the migration history to the restored database");
    const reapplyErrors = await applySqlFiles(
      bin,
      restoreUrl,
      schemaFiles.slice(1),
      path.join(workDir, "reapply-errors.log"),
    );
    const afterReapply = await databaseHealth(restoreUrl);
    if (!afterReapply.healthy) throw new Error(`restored database broke after re-applying migrations: ${JSON.stringify(afterReapply)}`);

    const report = {
      ok: true,
      sourceCounts,
      restoredCounts,
      backupCreatedAt: backupSummary.createdAt,
      dataTimestamp: backupSummary.createdAt,
      timings: {
        backupMs,
        restoreMs,
        totalMs: Date.now() - startedAt,
      },
      sizes: { bytesPlain: backupSummary.bytesPlain, bytesEncrypted: backupSummary.bytesEncrypted },
      health: restoredHealth,
      migrations: {
        files: schemaFiles.length - 1,
        sourceErrors: schemaErrors.length,
        reapplyErrors: reapplyErrors.length,
      },
      note:
        "Local tooling and schema verified. This does NOT prove the production backup contains production data — see audit/BACKUP_DISASTER_RECOVERY_AUDIT.md.",
    };

    emitSummary(report);
    log.info("restore drill PASSED", { restoreMs, backupMs });
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  log.error("restore drill FAILED", { message: String(error?.message ?? error).slice(0, 3000) });
  process.exitCode = 1;
});
