/**
 * Configuration for the backup and restore scripts.
 *
 * WHY EVERY VALUE IS EXPLICIT
 *   A backup that silently writes to the wrong bucket, or that falls back to
 *   "no encryption" because an environment variable is missing, is worse than
 *   no backup at all: it looks green while being useless. Every required value
 *   is validated up front and a missing one fails the run with the exact name
 *   that needs setting, before anything is dumped or uploaded.
 *
 * WHERE THE VALUES COME FROM
 *   Locally: export them, or run the restore drill, which generates its own
 *   throwaway configuration. In CI: GitHub Actions secrets, listed in
 *   .github/workflows/backup.yml.
 */

/** Bumped when the manifest shape or key layout changes incompatibly. */
export const MANIFEST_SCHEMA_VERSION = 1;
export const TOOL_NAME = "uxcommunity-backup";

/** Tables whose exact row counts are recorded in every database manifest. */
export const DEFAULT_COUNT_TABLES = [
  "users",
  "communities",
  "community_members",
  "community_messages",
  "dm_conversations",
  "dm_messages",
  "job_posts",
  "job_applications",
];

/**
 * Schemas that belong to Supabase, not to the application.
 *
 * WHY AN EXCLUDE LIST AND NOT `--schema=public`
 *   `pg_dump --schema=public` omits `CREATE EXTENSION`, and it emits
 *   `CREATE SCHEMA public`, which fails against any target where `public`
 *   already exists (every Supabase project). Excluding the managed schemas
 *   instead produces a dump that carries its own extension requirements and
 *   creates no schema that already exists — the difference between a restore
 *   that works and one that dies on its first statement. Verified by the
 *   restore drill.
 *
 *   `extensions` is excluded too: it already exists on every Supabase project,
 *   and recreating it would collide. The extensions themselves are recreated
 *   from the manifest before `pg_restore` runs.
 */
export const DEFAULT_EXCLUDE_SCHEMAS = [
  "_analytics",
  "_realtime",
  "auth",
  "cron",
  "extensions",
  "graphql",
  "graphql_public",
  "net",
  "pgbouncer",
  "pgsodium",
  "pgsodium_masks",
  "realtime",
  "storage",
  "supabase_functions",
  "supabase_migrations",
  "vault",
];

export const DEFAULT_BACKUP_PREFIX = "db";
export const DEFAULT_RETENTION_DAYS = 30;
export const DEFAULT_KEEP_MINIMUM = 7;

/**
 * Removes the password from a PostgreSQL URL so it can be logged. Anything that
 * is not a parseable URL is replaced entirely rather than printed — an
 * unparseable value may itself be a secret.
 */
export function redactUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.password) url.password = "";
    return url.toString();
  } catch {
    return "(unparseable connection string)";
  }
}

/** Splits a connection string into the parts a manifest records. No password. */
export function describeDatabase(value) {
  try {
    const url = new URL(value);
    return {
      host: url.hostname,
      port: url.port || "5432",
      database: url.pathname.replace(/^\//, "") || "postgres",
      user: decodeURIComponent(url.username || ""),
    };
  } catch {
    return { host: "(unparseable)", port: "", database: "", user: "" };
  }
}

/**
 * True when two connection strings point at the same database on the same
 * server. The restore script uses this to refuse to overwrite production
 * unless the operator passes an explicit override.
 */
export function isSameDatabase(a, b) {
  if (!a || !b) return false;
  const left = describeDatabase(a);
  const right = describeDatabase(b);
  const normalise = (value) => String(value || "").toLowerCase();
  return (
    normalise(left.host) === normalise(right.host) &&
    normalise(left.port) === normalise(right.port) &&
    normalise(left.database) === normalise(right.database)
  );
}

function parseList(value, fallback) {
  if (!value) return fallback;
  const items = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function parsePositiveInt(value, fallback, label, errors) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    errors.push(`${label} must be a positive integer (received ${JSON.stringify(value)})`);
    return fallback;
  }
  return parsed;
}

/**
 * Validates the bucket and credentials without throwing, so callers that are
 * assembling a combined error list can merge these problems with their own.
 *
 * The R2/S3 credentials deliberately accept `BACKUP_R2_*` first and fall back
 * to the media bucket's `R2_*`: a dedicated token scoped to the backup bucket
 * is the documented setup (see audit/BACKUP_IMPLEMENTATION.md), but a project
 * that has not created one yet still gets a working backup instead of a crash.
 */
function collectStorage(env) {
  const errors = [];

  const bucket = env.BACKUP_R2_BUCKET || "";
  if (!bucket) {
    errors.push(
      "BACKUP_R2_BUCKET is required — the bucket dedicated to backups " +
        "(it must NOT be the media bucket or the Next.js cache bucket)",
    );
  }

  const accountId = env.BACKUP_R2_ACCOUNT_ID || env.R2_ACCOUNT_ID || "";
  const accessKeyId = env.BACKUP_R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = env.BACKUP_R2_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY || "";
  if (!accessKeyId) errors.push("BACKUP_R2_ACCESS_KEY_ID (or R2_ACCESS_KEY_ID) is required");
  if (!secretAccessKey) errors.push("BACKUP_R2_SECRET_ACCESS_KEY (or R2_SECRET_ACCESS_KEY) is required");

  // A non-R2 S3 store (Backblaze B2, a second Cloudflare account, MinIO) is what
  // makes the offsite copy a genuinely separate failure domain; when its
  // endpoint is given, the account id is not needed.
  const endpoint = env.BACKUP_S3_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  if (!endpoint) errors.push("BACKUP_S3_ENDPOINT or BACKUP_R2_ACCOUNT_ID is required");

  return {
    errors,
    storage: {
      bucket,
      prefix: env.BACKUP_PREFIX || DEFAULT_BACKUP_PREFIX,
      endpoint,
      region: env.BACKUP_S3_REGION || "auto",
      credentials: { accessKeyId, secretAccessKey },
    },
  };
}

function configError(title, errors) {
  const error = new Error(`${title}:\n  - ${errors.join("\n  - ")}`);
  error.code = "EBACKUPCONFIG";
  return error;
}

/**
 * Storage configuration only: what is needed to read or write backups.
 * Used by the restore and verify scripts, which need no database URL.
 */
export function loadStorageConfig(env = process.env) {
  const { errors, storage } = collectStorage(env);
  if (errors.length) throw configError("Backup storage configuration is incomplete", errors);
  return storage;
}

/**
 * Configuration for a database backup.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{requireUpload?: boolean}} options `requireUpload: false` allows a
 *   local-only run (the restore drill), which needs no bucket at all.
 */
export function loadBackupConfig(env = process.env, { requireUpload = true } = {}) {
  const errors = [];

  const dbUrl = env.SUPABASE_DB_URL || "";
  if (!dbUrl) errors.push("SUPABASE_DB_URL is required (session-mode pooler URL, port 5432)");

  const storage = requireUpload
    ? collectStorage(env)
    : {
        errors: [],
        storage: {
          bucket: "",
          prefix: env.BACKUP_PREFIX || DEFAULT_BACKUP_PREFIX,
          endpoint: "",
          region: "auto",
          credentials: { accessKeyId: "", secretAccessKey: "" },
        },
      };
  errors.push(...storage.errors);

  const ageRecipient = env.BACKUP_AGE_RECIPIENT || "";
  if (!ageRecipient) {
    errors.push(
      "BACKUP_AGE_RECIPIENT is required — the age public key (`age1...`) that backups are " +
        "encrypted to. Generate a keypair with `age-keygen -o backup-key.txt` and keep the " +
        "private key offline; see audit/BACKUP_IMPLEMENTATION.md",
    );
  }

  const retentionDays = parsePositiveInt(
    env.BACKUP_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
    "BACKUP_RETENTION_DAYS",
    errors,
  );
  const keepMinimum = parsePositiveInt(
    env.BACKUP_KEEP_MINIMUM,
    DEFAULT_KEEP_MINIMUM,
    "BACKUP_KEEP_MINIMUM",
    errors,
  );

  if (errors.length) throw configError("Backup configuration is incomplete", errors);

  return {
    dbUrl,
    database: describeDatabase(dbUrl),
    excludeSchemas: parseList(env.BACKUP_EXCLUDE_SCHEMAS, DEFAULT_EXCLUDE_SCHEMAS),
    countTables: parseList(env.BACKUP_COUNT_TABLES, DEFAULT_COUNT_TABLES),
    ...storage.storage,
    ageRecipient,
    retentionDays,
    keepMinimum,
  };
}

/**
 * Configuration for the R2 media mirror. Separate from the database config:
 * media mirroring must be possible when the database backup is deliberately
 * skipped, and vice versa.
 */
export function loadMediaBackupConfig(env = process.env) {
  const { errors, storage } = collectStorage(env);
  if (errors.length) throw configError("Media backup configuration is incomplete", errors);

  // Source buckets default to the two the application writes to. The Next.js
  // cache bucket is deliberately absent: it is disposable by definition.
  const sourceBuckets = parseList(
    env.BACKUP_MEDIA_SOURCES,
    [env.R2_BUCKET_NAME, env.R2_PRIVATE_BUCKET_NAME].filter(Boolean),
  );
  if (sourceBuckets.length === 0) {
    errors.push("No source buckets: set R2_BUCKET_NAME / R2_PRIVATE_BUCKET_NAME or BACKUP_MEDIA_SOURCES");
  }
  if (errors.length) throw configError("Media backup configuration is incomplete", errors);

  return { ...storage, sourceBuckets };
}
