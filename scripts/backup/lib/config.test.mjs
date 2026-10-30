import test from "node:test";
import assert from "node:assert/strict";

import {
  describeDatabase,
  isSameDatabase,
  loadBackupConfig,
  loadMediaBackupConfig,
  loadStorageConfig,
  redactUrl,
} from "./config.mjs";

const FULL_ENV = {
  SUPABASE_DB_URL: "postgresql://postgres:secret@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres",
  BACKUP_R2_BUCKET: "uxcommunity-backups",
  BACKUP_R2_ACCOUNT_ID: "acct",
  BACKUP_R2_ACCESS_KEY_ID: "key",
  BACKUP_R2_SECRET_ACCESS_KEY: "secret",
  BACKUP_AGE_RECIPIENT: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
  R2_BUCKET_NAME: "drafthub",
  R2_PRIVATE_BUCKET_NAME: "uxcommunity-private",
};

test("a complete environment produces a usable config", () => {
  const config = loadBackupConfig(FULL_ENV);
  assert.equal(config.bucket, "uxcommunity-backups");
  assert.equal(config.prefix, "db");
  assert.equal(config.retentionDays, 30);
  assert.equal(config.keepMinimum, 7);
  assert.ok(config.database.host.includes("pooler.supabase.com"));
  assert.equal(config.database.port, "5432");
  assert.ok(config.excludeSchemas.includes("auth"));
  assert.ok(config.excludeSchemas.includes("extensions"));
});

test("missing required values are all reported at once", () => {
  assert.throws(() => loadBackupConfig({}), (error) => {
    assert.equal(error.code, "EBACKUPCONFIG");
    assert.match(error.message, /SUPABASE_DB_URL/);
    assert.match(error.message, /BACKUP_R2_BUCKET/);
    assert.match(error.message, /BACKUP_AGE_RECIPIENT/);
    return true;
  });
});

test("a local-only run needs no bucket or credentials", () => {
  const config = loadBackupConfig(
    { SUPABASE_DB_URL: FULL_ENV.SUPABASE_DB_URL, BACKUP_AGE_RECIPIENT: FULL_ENV.BACKUP_AGE_RECIPIENT },
    { requireUpload: false },
  );
  assert.equal(config.bucket, "");
});

test("backup credentials fall back to the media token, and prefer their own", () => {
  const mediaOnly = { ...FULL_ENV, R2_ACCESS_KEY_ID: "media-key", R2_SECRET_ACCESS_KEY: "media-secret" };
  delete mediaOnly.BACKUP_R2_ACCESS_KEY_ID;
  delete mediaOnly.BACKUP_R2_SECRET_ACCESS_KEY;
  const fallback = loadBackupConfig(mediaOnly);
  assert.equal(fallback.credentials.accessKeyId, "media-key");
  assert.equal(fallback.credentials.secretAccessKey, "media-secret");

  const dedicated = loadBackupConfig({ ...FULL_ENV, BACKUP_R2_ACCESS_KEY_ID: "backup-key", R2_ACCESS_KEY_ID: "media-key" });
  assert.equal(dedicated.credentials.accessKeyId, "backup-key");
});

test("malformed numeric settings are rejected rather than silently defaulted", () => {
  assert.throws(
    () => loadBackupConfig({ ...FULL_ENV, BACKUP_RETENTION_DAYS: "thirty" }),
    /BACKUP_RETENTION_DAYS must be a positive integer/,
  );
  assert.throws(() => loadBackupConfig({ ...FULL_ENV, BACKUP_KEEP_MINIMUM: "0" }), /BACKUP_KEEP_MINIMUM/);
});

test("a non-R2 endpoint needs no account id", () => {
  const config = loadStorageConfig({
    BACKUP_R2_BUCKET: "b",
    BACKUP_R2_ACCESS_KEY_ID: "k",
    BACKUP_R2_SECRET_ACCESS_KEY: "s",
    BACKUP_S3_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  });
  assert.equal(config.endpoint, "https://s3.us-west-004.backblazeb2.com");
});

test("redaction never leaks a password", () => {
  const redacted = redactUrl(FULL_ENV.SUPABASE_DB_URL);
  assert.ok(!redacted.includes("secret"));
  assert.ok(redacted.includes("postgres@"));
  assert.equal(redactUrl("not a url"), "(unparseable connection string)");
});

test("describeDatabase records host and database but never the password", () => {
  const described = describeDatabase(FULL_ENV.SUPABASE_DB_URL);
  assert.deepEqual(described, {
    host: "aws-0-ap-southeast-2.pooler.supabase.com",
    port: "5432",
    database: "postgres",
    user: "postgres",
  });
  assert.ok(!JSON.stringify(described).includes("secret"));
});

test("the production guard compares host, port and database", () => {
  const production = "postgresql://postgres:pw@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres";
  const sameDbDifferentPassword = "postgresql://postgres:other@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres";
  const differentDb = "postgresql://postgres:pw@aws-0-ap-southeast-2.pooler.supabase.com:5432/uxc_restore";
  const sameNameDifferentHost = "postgresql://postgres:pw@127.0.0.1:5432/postgres";

  assert.equal(isSameDatabase(production, sameDbDifferentPassword), true);
  assert.equal(isSameDatabase(production, differentDb), false);
  assert.equal(isSameDatabase(production, sameNameDifferentHost), false);
  assert.equal(isSameDatabase(undefined, production), false);
});

test("media sources default to the two media buckets and never the cache bucket", () => {
  const config = loadMediaBackupConfig(FULL_ENV);
  assert.deepEqual(config.sourceBuckets, ["drafthub", "uxcommunity-private"]);
});
