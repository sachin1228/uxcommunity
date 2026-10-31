import assert from "node:assert/strict";
import test from "node:test";
import { canReportTarget } from "./target-visibility";
import type { ServiceClient } from "@/lib/supabase/service";

function db(options: {
  community?: { is_private: boolean } | null;
  member?: boolean;
  error?: unknown;
}) {
  return {
    from(table: string) {
      const result =
        table === "communities"
          ? options.community ?? null
          : options.member
            ? { community_id: "community" }
            : null;
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: table === "communities" ? result : result,
                error: options.error ?? null,
              }),
            }),
            maybeSingle: async () => ({
              data: table === "communities" ? result : result,
              error: options.error ?? null,
            }),
          }),
        }),
      };
    },
  } as unknown as ServiceClient;
}

test("content outside a community stays reportable", async () => {
  assert.equal(await canReportTarget(db({}), "viewer", null), true);
});

test("public community content is reportable by a non-member", async () => {
  assert.equal(
    await canReportTarget(db({ community: { is_private: false } }), "viewer", "community"),
    true,
  );
});

test("private community content requires membership", async () => {
  assert.equal(
    await canReportTarget(db({ community: { is_private: true }, member: false }), "viewer", "community"),
    false,
  );
  assert.equal(
    await canReportTarget(db({ community: { is_private: true }, member: true }), "viewer", "community"),
    true,
  );
});

test("public-community member-only content requires membership", async () => {
  assert.equal(
    await canReportTarget(
      db({ community: { is_private: false }, member: false }),
      "viewer",
      "community",
      true,
    ),
    false,
  );
  assert.equal(
    await canReportTarget(
      db({ community: { is_private: false }, member: true }),
      "viewer",
      "community",
      true,
    ),
    true,
  );
});

test("a visibility lookup failure denies the report", async () => {
  assert.equal(
    await canReportTarget(
      db({ community: { is_private: false }, error: { message: "db down" } }),
      "viewer",
      "community",
    ),
    false,
  );
});
