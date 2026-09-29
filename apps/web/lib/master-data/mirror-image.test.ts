import assert from "node:assert/strict";
import test from "node:test";

import { MASTER_IMAGE_LOOKUPS } from "@uxcommunity/shared";

import { syncMasterImageToCommunities } from "./mirror-image";
import type { MasterTable } from "./master-tables";
import type { DbClient } from "@/lib/r2-cleanup";

const R2_BASE = "https://example.r2.dev";
const OLD = `${R2_BASE}/master-data/1789653457881-ajmgawmi0r5.webp`;
const NEW = `${R2_BASE}/master-data/1789744095058-9uja6scx0eq.webp`;

test.beforeEach(() => {
  process.env.R2_PUBLIC_URL = R2_BASE;
});

/**
 * Minimal stand-in for the service client, covering the two chains the helper
 * uses: the `communities` update, and the reference lookups that
 * `deleteR2AssetIfUnreferenced` runs before it touches the bucket.
 *
 * `referencedUrls` are reported by every lookup table, which is how a test
 * keeps a replaced object "referenced" — no bucket, no credentials.
 */
function makeDb(
  options: {
    mirroredCount?: number | null;
    mirrorError?: { message: string } | null;
    referencedUrls?: string[];
  } = {},
) {
  const { mirroredCount = 2, mirrorError = null, referencedUrls = [] } = options;
  const writes: Array<{
    table: string;
    imageUrl: string | null;
    type: string | null;
    referenceId: string | null;
    count: string | null;
  }> = [];
  const lookups: Array<{ table: string; column: string }> = [];

  const db = {
    from(table: string) {
      let op: "update" | "select" = "select";
      let columnList = "";
      let values: { image_url: string | null } | null = null;
      let countOption: string | null = null;
      const filters: Record<string, string> = {};

      const api = {
        update(next: { image_url: string | null }, options?: { count?: string }) {
          op = "update";
          values = next;
          countOption = options?.count ?? null;
          return api;
        },
        select(columns: string) {
          op = "select";
          columnList = columns;
          return api;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return api;
        },
        then(
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          if (op === "update") {
            writes.push({
              table,
              imageUrl: values?.image_url ?? null,
              type: filters.type ?? null,
              referenceId: filters.reference_id ?? null,
              count: countOption,
            });
            return Promise.resolve({
              data: null,
              error: mirrorError,
              count: mirrorError ? null : mirroredCount,
            }).then(resolve, reject);
          }
          const column = columnList.split(",").map((part) => part.trim())[1] ?? "";
          lookups.push({ table, column });
          const data = referencedUrls.map((url, index) => ({
            id: `row-${index}`,
            [column]: url,
          }));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };

      return api;
    },
  };

  return { db: db as unknown as DbClient, writes, lookups };
}

test("mirrors a replaced picture onto every linked community", async () => {
  const { db, writes, lookups } = makeDb({ mirroredCount: 2, referencedUrls: [OLD] });

  const result = await syncMasterImageToCommunities({
    db,
    table: "cities",
    masterId: "city-1",
    imageUrl: NEW,
    previousImageUrl: OLD,
  });

  assert.equal(result.mirrored, 2);
  assert.deepEqual(writes, [{
    table: "communities",
    imageUrl: NEW,
    type: "city",
    referenceId: "city-1",
    count: "exact",
  }]);
  // Every mirror lookup was consulted before the object was written off, so a
  // shared picture is never reclaimed out from under another row.
  assert.deepEqual(
    lookups.map((lookup) => lookup.table),
    MASTER_IMAGE_LOOKUPS.map((lookup) => lookup.table),
  );
});

test("clearing the master picture clears the mirrored column too", async () => {
  // The old object is still reported by the lookups, so the cleanup is a no-op
  // bucket-wise — the assertion here is about the mirrored value, not R2.
  const { db, writes } = makeDb({ mirroredCount: 1, referencedUrls: [OLD] });

  const result = await syncMasterImageToCommunities({
    db,
    table: "design_sectors",
    masterId: "sector-1",
    imageUrl: null,
    previousImageUrl: OLD,
  });

  assert.equal(result.mirrored, 1);
  assert.equal(writes[0].imageUrl, null);
  assert.equal(writes[0].type, "sector");
  assert.equal(result.reclaimed, "referenced");
});

test("a shared picture is left in the bucket", async () => {
  const { db } = makeDb({ referencedUrls: [OLD] });

  const result = await syncMasterImageToCommunities({
    db,
    table: "design_interests",
    masterId: "interest-1",
    imageUrl: NEW,
    previousImageUrl: OLD,
  });

  assert.equal(result.reclaimed, "referenced");
});

test("an unchanged or absent picture skips the bucket entirely", async () => {
  const unchanged = makeDb();
  const first = await syncMasterImageToCommunities({
    db: unchanged.db,
    table: "job_titles",
    masterId: "job-1",
    imageUrl: NEW,
    previousImageUrl: NEW,
  });
  assert.equal(first.reclaimed, null);
  assert.equal(unchanged.lookups.length, 0);

  const created = makeDb();
  const second = await syncMasterImageToCommunities({
    db: created.db,
    table: "experience_levels",
    masterId: "level-1",
    imageUrl: NEW,
  });
  assert.equal(second.reclaimed, null);
  assert.equal(created.lookups.length, 0);
});

test("a failed mirror reports zero rows instead of failing the admin edit", async () => {
  const { db } = makeDb({ mirrorError: { message: "boom" }, referencedUrls: [OLD] });
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  let result;
  try {
    result = await syncMasterImageToCommunities({
      db,
      table: "cities",
      masterId: "city-1",
      imageUrl: NEW,
      previousImageUrl: OLD,
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(result.mirrored, 0);
  assert.equal(logged.length, 1);
  // The cleanup still ran: the master row is already updated, so a mirror
  // failure must not also strand the object it replaced.
  assert.equal(result.reclaimed, "referenced");
});

test("each master table mirrors the community type that points at it", async () => {
  const expected: Record<MasterTable, string> = {
    cities: "city",
    design_sectors: "sector",
    design_interests: "interest",
    experience_levels: "experience_level",
    job_titles: "job_title",
  };

  for (const [table, communityType] of Object.entries(expected) as Array<[MasterTable, string]>) {
    const { db, writes } = makeDb();
    await syncMasterImageToCommunities({
      db,
      table,
      masterId: "master-1",
      imageUrl: NEW,
    });
    assert.equal(writes[0].type, communityType, `${table} should mirror ${communityType}`);
  }
});
