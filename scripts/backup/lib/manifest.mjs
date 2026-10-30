/**
 * The backup manifest is the record that makes a backup verifiable.
 *
 * WHY A MANIFEST AT ALL
 *   An object in a bucket is not a backup: it may be truncated, half-uploaded,
 *   encrypted to a key nobody holds, or empty. The manifest sits next to the
 *   dump and carries the SHA-256 of both the plaintext and the ciphertext, the
 *   row counts that were true when it was taken, and the source it came from.
 *   `verify-backup.mjs` re-checks those values; `restore-postgres.mjs` compares
 *   them after a restore. Without it, "the restore worked" would be an opinion.
 *
 * LAYOUT (one directory per UTC day, so listing is cheap and prefixes sort):
 *   db/2026/10/30/uxcommunity-20261030T023000Z.dump.age
 *   db/2026/10/30/uxcommunity-20261030T023000Z.dump.age.sha256
 *   db/2026/10/30/uxcommunity-20261030T023000Z.manifest.json
 *
 * The dump's plaintext never leaves the machine that produced it: encryption
 * happens before the upload, so the bucket only ever holds ciphertext.
 */

import { MANIFEST_SCHEMA_VERSION, TOOL_NAME } from "./config.mjs";

/** `2026-10-30T02:30:00.000Z` -> `db/2026/10/30` */
export function dayPrefix(prefix, date) {
  const [year, month, day] = date.toISOString().slice(0, 10).split("-");
  return `${prefix}/${year}/${month}/${day}`;
}

/** `2026-10-30T02:30:00.000Z` -> `20261030T023000Z` */
export function timestampToken(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** All three object keys for one backup, derived from one timestamp. */
export function backupKeys(prefix, date) {
  const base = `${dayPrefix(prefix, date)}/uxcommunity-${timestampToken(date)}`;
  return {
    dump: `${base}.dump.age`,
    checksum: `${base}.dump.age.sha256`,
    manifest: `${base}.manifest.json`,
  };
}

/**
 * Where one media object lives inside the backup bucket.
 * `r2/<source bucket>/<key>` — the bucket name is part of the path so two
 * buckets with identical keys can never collide in the mirror.
 */
export function backupKeyFor(sourceBucket, key) {
  return `r2/${sourceBucket}/${key}`;
}

/**
 * True when the key is one this tool owns. Retention must never be able to
 * delete a media object or a hand-uploaded file, so deletion is restricted to
 * keys that parse as a manifest this tool wrote.
 */
export function isManagedManifestKey(key, prefix) {
  if (typeof key !== "string") return false;
  if (!key.startsWith(`${prefix}/`)) return false;
  return /\/uxcommunity-\d{8}T\d{6}Z\.manifest\.json$/.test(key);
}

export function buildDatabaseManifest({
  createdAt,
  keys,
  database,
  serverVersion,
  excludedSchemas,
  dump,
  encryption,
  extensions,
  rowCounts,
  retention,
  durationMs,
}) {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kind: "postgres",
    tool: { name: TOOL_NAME, version: MANIFEST_SCHEMA_VERSION },
    createdAt: createdAt.toISOString(),
    source: {
      host: database.host,
      port: database.port,
      database: database.database,
      serverVersion,
      // Supabase-managed schemas deliberately absent from the dump; everything
      // else (public, and anything the app adds later) is included.
      excludedSchemas,
    },
    objectKey: keys.dump,
    checksumKey: keys.checksum,
    dump: {
      format: "custom",
      mode: "exclude-schemas",
      bytesPlain: dump.bytesPlain,
      bytesEncrypted: dump.bytesEncrypted,
      sha256Plain: dump.sha256Plain,
      sha256Encrypted: dump.sha256Encrypted,
    },
    encryption: { method: "age", recipient: encryption.recipient },
    // Recreated by the restore script before pg_restore, because pg_dump omits
    // CREATE EXTENSION when dumping a filtered schema list.
    extensions: Array.isArray(extensions) ? extensions : [],
    rowCounts,
    retention: { days: retention.days, keepMinimum: retention.keepMinimum },
    durationMs,
  };
}

/**
 * Validates a manifest read back from storage. Returns a list of problems
 * rather than throwing, so `verify-backup.mjs` can report all of them at once.
 */
export function validateManifest(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== "object") return ["manifest is not an object"];
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    problems.push(`unsupported schemaVersion ${JSON.stringify(manifest.schemaVersion)}`);
  }
  if (manifest.kind !== "postgres") problems.push(`unexpected kind ${JSON.stringify(manifest.kind)}`);
  if (!manifest.createdAt || Number.isNaN(Date.parse(manifest.createdAt))) {
    problems.push("createdAt is missing or not a timestamp");
  }
  if (typeof manifest.objectKey !== "string" || !manifest.objectKey.endsWith(".dump.age")) {
    problems.push("objectKey is missing or does not name an encrypted dump");
  }
  const dump = manifest.dump ?? {};
  for (const field of ["sha256Plain", "sha256Encrypted"]) {
    if (typeof dump[field] !== "string" || !/^[a-f0-9]{64}$/.test(dump[field])) {
      problems.push(`${field} is not a SHA-256 hex digest`);
    }
  }
  if (!Number.isFinite(dump.bytesEncrypted) || dump.bytesEncrypted <= 0) {
    problems.push("bytesEncrypted is missing or not positive");
  }
  if (!Number.isFinite(dump.bytesPlain) || dump.bytesPlain <= 0) {
    problems.push("bytesPlain is missing or not positive");
  }
  if (manifest.encryption?.method !== "age") problems.push("encryption.method is not age");
  if (manifest.extensions !== undefined) {
    if (!Array.isArray(manifest.extensions)) problems.push("extensions is not an array");
    else {
      for (const extension of manifest.extensions) {
        if (!extension?.name || !extension?.schema) {
          problems.push(`extension entry is missing name or schema: ${JSON.stringify(extension)}`);
        }
      }
    }
  }
  return problems;
}

/**
 * Chooses which backups to delete.
 *
 * RULES, IN ORDER OF PRECEDENCE
 *   1. The newest `keepMinimum` backups always survive — a retention bug must
 *      not be able to empty the bucket.
 *   2. Of the rest, anything older than `retentionDays` is deleted.
 *   3. The newest backup overall is never deleted, whatever the configuration.
 *
 * Only manifests are considered: deleting a dump without its manifest (or the
 * reverse) would leave an unverifiable orphan, so the caller deletes all three
 * keys of every selected backup together.
 *
 * @param {{key: string, createdAt: string}[]} manifests
 * @param {{now?: Date, retentionDays: number, keepMinimum: number}} options
 * @returns {{keep: string[], remove: string[]}}
 */
export function selectExpiredManifests(manifests, { now = new Date(), retentionDays, keepMinimum }) {
  const sorted = [...manifests]
    .map((entry) => ({ ...entry, time: Date.parse(entry.createdAt) }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => b.time - a.time);

  if (sorted.length === 0) return { keep: [], remove: [] };

  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const keep = [];
  const remove = [];

  sorted.forEach((entry, index) => {
    const isNewest = index === 0;
    const isProtectedMinimum = index < keepMinimum;
    if (isNewest || isProtectedMinimum || entry.time >= cutoff) keep.push(entry.key);
    else remove.push(entry.key);
  });

  return { keep, remove };
}
