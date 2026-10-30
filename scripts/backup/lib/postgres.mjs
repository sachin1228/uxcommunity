/**
 * PostgreSQL access for the backup and restore scripts.
 *
 * WHY THE CONNECTION STRING IS NOT PASSED ON THE COMMAND LINE
 *   `pg_dump postgresql://user:password@host/db` puts the password in the
 *   process table (`ps`) for as long as the dump runs. Instead the URL is
 *   decomposed into libpq's own environment variables (PGHOST, PGPORT,
 *   PGUSER, PGPASSWORD, PGDATABASE), which are not visible to other users'
 *   `ps` output. The same variables work for psql, pg_dump and pg_restore.
 *
 * WHY THE CLIENT VERSION IS CHECKED FIRST
 *   pg_dump refuses to dump a server newer than itself, and its error arrives
 *   after the credentials have been used and the bucket has been contacted.
 *   Checking up front turns "version mismatch" into one actionable sentence
 *   naming the package to install.
 */

import { run, runOrThrow } from "./exec.mjs";
import { describeDatabase } from "./config.mjs";

/** Prefix for the binaries, so the restore drill can pin a specific major. */
function binary(name) {
  const dir = process.env.PG_BIN;
  return dir ? `${dir.replace(/\/$/, "")}/${name}` : name;
}

/** Decomposes a URL into libpq environment variables. Never logs the password. */
export function pgEnvFromUrl(dbUrl, base = process.env) {
  const url = new URL(dbUrl);
  const env = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: (url.pathname || "/postgres").replace(/^\//, "") || "postgres",
    PGUSER: decodeURIComponent(url.username || "postgres"),
  };
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);

  // libpq reads these too; carry them through when the caller set them.
  for (const name of ["PGSSLMODE", "PGSSLROOTCERT", "PGCONNECT_TIMEOUT", "PGOPTIONS", "PGAPPNAME"]) {
    if (base[name] !== undefined) env[name] = base[name];
  }
  if (env.PGCONNECT_TIMEOUT === undefined) env.PGCONNECT_TIMEOUT = "20";
  env.PGAPPNAME = "uxcommunity-backup";
  return env;
}

function parseMajor(versionText) {
  // "pg_dump (PostgreSQL) 17.11 (Homebrew)" / "psql (PostgreSQL) 15.4"
  const match = /(\d+)\.(\d+)/.exec(versionText);
  return match ? Number(match[1]) : null;
}

/** Confirms every binary the scripts shell out to is present. */
export async function assertToolchain() {
  // `age` is a host tool, not part of the PostgreSQL bin directory that
  // PG_BIN points at, so it is resolved from PATH like any other program.
  const required = [
    ["pg_dump", binary("pg_dump"), ["--version"]],
    ["psql", binary("psql"), ["--version"]],
    ["pg_restore", binary("pg_restore"), ["--version"]],
    ["age", "age", ["--version"]],
  ];
  const versions = {};
  const missing = [];

  for (const [name, command, args] of required) {
    const result = await run(command, args);
    if (result.code !== 0) {
      missing.push(name);
      continue;
    }
    const firstLine = (result.stdout || result.stderr || "").split("\n")[0].trim();
    versions[name] = name === "age" ? firstLine : firstLine.replace(/^.*?\)\s*/, "");
  }

  if (missing.length) {
    const error = new Error(
      `Missing required tool(s): ${missing.join(", ")}. ` +
        `Install the PostgreSQL client (matching the server's major version) and age ` +
        `(macOS: \`brew install age\`; Debian/Ubuntu: \`apt-get install age\`).`,
    );
    error.code = "ETOOLCHAIN";
    throw error;
  }

  return versions;
}

/**
 * Reads the server's version and refuses to continue when pg_dump is older.
 * A mismatch is not a warning: an old pg_dump cannot produce a usable dump at
 * all, and continuing would upload an empty or failed file.
 */
export async function assertClientCompatible(dbUrl) {
  const env = pgEnvFromUrl(dbUrl);
  const server = await runOrThrow(binary("psql"), [
    "-w",
    "--no-psqlrc",
    "-tA",
    "-c",
    "show server_version_num",
  ], { env });
  const serverVersionNum = Number(server.stdout.trim());
  const serverMajor = Math.floor(serverVersionNum / 10000);

  const dumpVersion = await runOrThrow(binary("pg_dump"), ["--version"]);
  const clientMajor = parseMajor(dumpVersion.stdout);

  if (!clientMajor) {
    throw new Error(`Could not parse pg_dump version from ${JSON.stringify(dumpVersion.stdout.trim())}`);
  }
  if (clientMajor < serverMajor) {
    const error = new Error(
      `pg_dump ${clientMajor} cannot dump a PostgreSQL ${serverMajor} server. ` +
        `Install postgresql-client-${serverMajor} (or newer) and put it first on PATH ` +
        `(or set PG_BIN to its bin directory). GitHub's ubuntu-latest ships 16, so the ` +
        `backup workflow installs ${serverMajor} from the PGDG repository.`,
    );
    error.code = "EVERSION";
    throw error;
  }

  return { serverMajor, serverVersionNum, clientMajor };
}

function assertIdentifier(name) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Refusing to build SQL with a suspicious identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

/**
 * Exact row counts for the requested tables, restricted to tables that exist.
 *
 * These are recorded in the manifest and re-checked after a restore. They are
 * exact at the moment the query runs — a write that lands between the count and
 * the dump is a documented, accepted difference (see the runbook's tolerance
 * rules); the counts exist to catch a restore that silently lost a table, not
 * to prove byte-for-byte equality with a live system.
 */
export async function tableRowCounts(dbUrl, tables) {
  const env = pgEnvFromUrl(dbUrl);
  const safeTables = tables.map(assertIdentifier);
  const arrayLiteral = `{${safeTables.join(",")}}`;

  const existing = await runOrThrow(binary("psql"), [
    "-w",
    "--no-psqlrc",
    "-tA",
    "-c",
    `select tablename from pg_tables where schemaname = 'public' and tablename = any('${arrayLiteral}'::name[]) order by tablename`,
  ], { env });

  const present = existing.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const counts = {};
  for (const table of present) {
    const result = await runOrThrow(binary("psql"), [
      "-w",
      "--no-psqlrc",
      "-tA",
      "-c",
      `select count(*) from public.${table}`,
    ], { env });
    counts[table] = Number(result.stdout.trim());
  }
  return counts;
}

/**
 * Extensions installed in the database, with the schema that owns them.
 *
 * WHY THIS IS CAPTURED SEPARATELY
 *   `pg_dump --schema=public` does NOT emit `CREATE EXTENSION` for an extension
 *   that lives in `public`. A restore into a clean database therefore fails on
 *   the first column default that calls `gen_random_bytes()` — discovered by the
 *   restore drill, not by a production incident. Recording the extensions in
 *   the manifest and recreating them before `pg_restore` makes every backup
 *   self-sufficient, including on a target that has never had them installed.
 */
export async function listExtensions(dbUrl) {
  const env = pgEnvFromUrl(dbUrl);
  const result = await runOrThrow(binary("psql"), [
    "-w",
    "--no-psqlrc",
    "-tA",
    "-F",
    "|",
    "-c",
    `select e.extname, n.nspname, e.extversion
       from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where e.extname <> 'plpgsql'
      order by 1`,
  ], { env });

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, schema, version] = line.split("|");
      return { name, schema, version };
    });
}

function assertSimpleIdentifier(kind, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value ?? ""))) {
    throw new Error(`Refusing to run ${kind} with a suspicious identifier: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Recreates the extensions a backup depends on, before its tables are restored.
 * Idempotent: an extension that already exists is left exactly where it is.
 */
export async function ensureExtensions(dbUrl, extensions) {
  if (!Array.isArray(extensions) || extensions.length === 0) return [];
  const env = pgEnvFromUrl(dbUrl);
  const applied = [];

  for (const extension of extensions) {
    const name = assertSimpleIdentifier("extension", extension.name);
    const schema = assertSimpleIdentifier("schema", extension.schema);
    await runOrThrow(binary("psql"), [
      "-w",
      "--no-psqlrc",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `create schema if not exists "${schema}"; create extension if not exists "${name}" with schema "${schema}";`,
    ], { env });
    applied.push({ name, schema });
  }
  return applied;
}

/**
 * Dumps everything except the Supabase-managed schemas, in custom format.
 *
 * `--no-owner --no-privileges` keeps the dump restorable into a project where
 * the Supabase-managed roles do not exist yet. `--no-publications` avoids
 * dragging the `supabase_realtime` publication into a restore: the app uses its
 * own realtime Worker, not Supabase Realtime, so the publication is not part of
 * the application's data contract.
 *
 * The exclude list (rather than `--schema=public`) is what makes the dump
 * self-contained; see DEFAULT_EXCLUDE_SCHEMAS in ./config.mjs for the two
 * concrete failures the include-list produces.
 */
export async function dumpDatabase({ dbUrl, excludeSchemas, outFile }) {
  const env = pgEnvFromUrl(dbUrl);
  const args = [
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-privileges",
    "--no-tablespaces",
    "--no-publications",
    `--file=${outFile}`,
  ];
  for (const schema of excludeSchemas) args.push(`--exclude-schema=${schema}`);
  await runOrThrow(binary("pg_dump"), args, { env });
}

/**
 * Restores a custom-format dump into `dbUrl`.
 *
 * `--exit-on-error` is deliberate: a restore that skipped a failed table and
 * exited 0 would be reported as a success and only discovered during an actual
 * incident. `--clean --if-exists` makes the operation repeatable against a
 * database that already has the objects.
 */
export async function restoreDatabase({ dbUrl, file, jobs = 1 }) {
  const env = pgEnvFromUrl(dbUrl);
  const args = [
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
    "--exit-on-error",
    `--jobs=${jobs}`,
    `--dbname=${env.PGDATABASE}`,
    file,
  ];
  await runOrThrow(binary("pg_restore"), args, { env });
}

/**
 * Structural checks after a restore. Any non-zero value is a failed restore,
 * not a warning: an invalid index or an unvalidated foreign key means the data
 * loaded is not the data the application expects.
 */
export async function databaseHealth(dbUrl) {
  const env = pgEnvFromUrl(dbUrl);
  const result = await runOrThrow(binary("psql"), [
    "-w",
    "--no-psqlrc",
    "-tA",
    "-F",
    "|",
    "-c",
    `select
       (select count(*) from pg_index where not indisvalid) as invalid_indexes,
       (select count(*) from pg_constraint where contype = 'f' and not convalidated) as unvalidated_fks,
       (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       pg_database_size(current_database()) as database_bytes`,
  ], { env });

  const [invalidIndexes, unvalidatedFks, publicTables, databaseBytes] = result.stdout
    .trim()
    .split("|")
    .map((value) => Number(value));

  return {
    invalidIndexes,
    unvalidatedFks,
    publicTables,
    databaseBytes,
    healthy: invalidIndexes === 0 && unvalidatedFks === 0 && publicTables > 0,
  };
}

/** True once the server answers a trivial query. */
export async function pingDatabase(dbUrl) {
  const env = pgEnvFromUrl(dbUrl);
  const result = await run(binary("psql"), ["-w", "--no-psqlrc", "-tA", "-c", "select 1"], { env });
  return result.code === 0 && result.stdout.trim() === "1";
}

/** Creates a database when it does not exist yet (restore into a scratch DB). */
export async function ensureDatabase(dbUrl, { maintenanceDatabase = "postgres" } = {}) {
  const target = describeDatabase(dbUrl);
  const url = new URL(dbUrl);
  url.pathname = `/${maintenanceDatabase}`;
  const env = pgEnvFromUrl(url.toString());

  const exists = await run(binary("psql"), [
    "-w",
    "--no-psqlrc",
    "-tA",
    "-c",
    `select 1 from pg_database where datname = '${target.database.replace(/'/g, "''")}'`,
  ], { env });

  if (exists.code === 0 && exists.stdout.trim() === "1") return false;

  await runOrThrow(binary("createdb"), ["-w", target.database], { env });
  return true;
}
