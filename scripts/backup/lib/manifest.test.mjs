import test from "node:test";
import assert from "node:assert/strict";

import {
  backupKeyFor,
  backupKeys,
  dayPrefix,
  isManagedManifestKey,
  selectExpiredManifests,
  timestampToken,
  validateManifest,
} from "./manifest.mjs";

const SHA = "a".repeat(64);

function validManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "postgres",
    tool: { name: "uxcommunity-backup", version: 1 },
    createdAt: "2026-10-30T02:30:00.000Z",
    source: { host: "db.example", port: "5432", database: "postgres", serverVersion: 170006 },
    objectKey: "db/2026/10/30/uxcommunity-20261030T023000Z.dump.age",
    checksumKey: "db/2026/10/30/uxcommunity-20261030T023000Z.dump.age.sha256",
    dump: {
      format: "custom",
      mode: "exclude-schemas",
      bytesPlain: 1000,
      bytesEncrypted: 1200,
      sha256Plain: SHA,
      sha256Encrypted: SHA,
    },
    encryption: { method: "age", recipient: "age1example" },
    extensions: [{ name: "pgcrypto", schema: "public", version: "1.3" }],
    rowCounts: { users: 2 },
    retention: { days: 30, keepMinimum: 7 },
    ...overrides,
  };
}

test("key naming is date-partitioned and timestamp-sortable", () => {
  const date = new Date("2026-10-30T02:30:00.000Z");
  assert.equal(dayPrefix("db", date), "db/2026/10/30");
  assert.equal(timestampToken(date), "20261030T023000Z");

  const keys = backupKeys("db", date);
  assert.equal(keys.dump, "db/2026/10/30/uxcommunity-20261030T023000Z.dump.age");
  assert.equal(keys.manifest, "db/2026/10/30/uxcommunity-20261030T023000Z.manifest.json");
});

test("media objects are mirrored under their bucket name, so keys cannot collide", () => {
  assert.equal(backupKeyFor("drafthub", "companies/logos/x.png"), "r2/drafthub/companies/logos/x.png");
  assert.equal(
    backupKeyFor("uxcommunity-private", "resumes/a/b.pdf"),
    "r2/uxcommunity-private/resumes/a/b.pdf",
  );
  // Same key in two buckets must map to two different backup paths.
  assert.notEqual(backupKeyFor("a", "x"), backupKeyFor("b", "x"));
});

test("managed-key filter refuses to adopt objects this tool did not write", () => {
  const { manifest } = backupKeys("db", new Date("2026-10-30T02:30:00.000Z"));
  assert.equal(isManagedManifestKey(manifest, "db"), true);

  // Media objects and hand-uploaded files must never become deletable by the
  // retention pass.
  assert.equal(isManagedManifestKey("r2/drafthub/companies/logos/x.png", "db"), false);
  assert.equal(isManagedManifestKey("db/2026/10/30/random.json", "db"), false);
  assert.equal(isManagedManifestKey("backups/2026/10/30/x.manifest.json", "db"), false);
  assert.equal(isManagedManifestKey(undefined, "db"), false);
});

test("a well-formed manifest validates", () => {
  assert.deepEqual(validateManifest(validManifest()), []);
});

test("a manifest that cannot be trusted is rejected", () => {
  const missingChecksum = validManifest();
  delete missingChecksum.dump.sha256Plain;
  assert.match(validateManifest(missingChecksum).join(" "), /sha256Plain/);

  assert.match(validateManifest(validManifest({ kind: "r2-media" })).join(" "), /unexpected kind/);

  const zeroBytes = validManifest();
  zeroBytes.dump.bytesEncrypted = 0;
  assert.match(validateManifest(zeroBytes).join(" "), /bytesEncrypted/);

  const unencrypted = validManifest();
  unencrypted.encryption = { method: "none" };
  assert.match(validateManifest(unencrypted).join(" "), /encryption.method/);

  assert.match(validateManifest(null).join(" "), /not an object/);
});

test("retention keeps the newest backups, drops the expired, never empties the store", () => {
  const now = new Date("2026-10-30T00:00:00.000Z");
  const manifests = Array.from({ length: 10 }, (_, index) => {
    const date = new Date(now.getTime() - index * 24 * 60 * 60 * 1000);
    return { key: `db/${index}.manifest.json`, createdAt: date.toISOString() };
  });

  const { keep, remove } = selectExpiredManifests(manifests, {
    now,
    retentionDays: 5,
    keepMinimum: 3,
  });

  assert.deepEqual(keep.slice(0, 3), manifests.slice(0, 3).map((m) => m.key));
  assert.ok(remove.every((key) => !keep.includes(key)));
  // Days 5..9 are older than the cutoff; day 5 is exactly at it, so only 6..9.
  assert.equal(remove.length, 4);
  assert.ok(keep.length + remove.length === manifests.length);
});

test("retention protects the minimum even when everything is older than the window", () => {
  const now = new Date("2027-01-01T00:00:00.000Z");
  const manifests = [
    { key: "a", createdAt: "2026-01-01T00:00:00.000Z" },
    { key: "b", createdAt: "2025-12-01T00:00:00.000Z" },
  ];

  const { keep, remove } = selectExpiredManifests(manifests, { now, retentionDays: 1, keepMinimum: 2 });
  assert.deepEqual(keep, ["a", "b"]);
  assert.deepEqual(remove, []);
});

test("retention ignores entries with an unparseable timestamp", () => {
  const { keep, remove } = selectExpiredManifests(
    [
      { key: "good", createdAt: "2026-10-29T00:00:00.000Z" },
      { key: "broken", createdAt: "not a date" },
    ],
    { now: new Date("2026-10-30T00:00:00.000Z"), retentionDays: 30, keepMinimum: 1 },
  );
  assert.deepEqual(keep, ["good"]);
  assert.deepEqual(remove, []);
});

test("retention of an empty store is a no-op", () => {
  assert.deepEqual(selectExpiredManifests([], { retentionDays: 30, keepMinimum: 7 }), {
    keep: [],
    remove: [],
  });
});
