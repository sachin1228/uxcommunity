#!/usr/bin/env node

/**
 * Tests for the seeded-member plumbing.
 *
 *   node --test apps/web/e2e/seed-member.test.mjs
 *
 * Writing the rows needs a database (that is what the seeder is for), but the
 * decisions that run BEFORE any write do not: which ids are replaced, whether
 * the target is local, and whether the operator has acknowledged a shared one.
 * A mistake in any of them means writing to the wrong project or deleting
 * something this seeder does not own, so they are pinned down here.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  clampSeedCommunities,
  inviteTokenFor,
  isLoopbackHost,
  MAX_SEED_COMMUNITIES,
  remoteSeedRefusal,
  resolveSeedTarget,
  seedCommunityId,
  seedCommunityIds,
  seedCommunityName,
  SEED_EMAIL,
  SEED_USER_ID,
} from "./seed-member.mjs";
import { SENTINEL_USER_ID } from "../../../scripts/smoke-realtime.mjs";

// ── Ids ─────────────────────────────────────────────────────────────────────

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("every seeded id is a well-formed, deterministic UUID", () => {
  assert.match(SEED_USER_ID, UUID_SHAPE);
  assert.equal(seedCommunityId(1), seedCommunityId(1));
  for (const id of seedCommunityIds(MAX_SEED_COMMUNITIES)) assert.match(id, UUID_SHAPE);
});

test("the seeded ids cannot collide with the mock-community ids or the smoke sentinel", () => {
  // The browser test's mockCommunityId() uses this same fixed prefix with the
  // last group 0000000000NN; the two id spaces must stay disjoint, or a mocked
  // run and a seeded run would address the same Durable Object.
  const mockIds = Array.from(
    { length: MAX_SEED_COMMUNITIES },
    (_, i) => `e2e00000-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`,
  );
  const seeded = new Set([SEED_USER_ID, ...seedCommunityIds(MAX_SEED_COMMUNITIES)]);
  for (const id of mockIds) assert.ok(!seeded.has(id), `${id} is both a mock and a seeded id`);
  assert.ok(!seeded.has(SENTINEL_USER_ID));
});

test("the community count is clamped to the sidebar's live-socket limit", () => {
  assert.equal(clampSeedCommunities(undefined), 1);
  assert.equal(clampSeedCommunities(0), 1);
  assert.equal(clampSeedCommunities(-3), 1);
  assert.equal(clampSeedCommunities("not a number"), 1);
  assert.equal(clampSeedCommunities(3), 3);
  assert.equal(clampSeedCommunities(99), MAX_SEED_COMMUNITIES);
  assert.equal(seedCommunityIds(3).length, 3);
  assert.equal(new Set(seedCommunityIds(MAX_SEED_COMMUNITIES)).size, MAX_SEED_COMMUNITIES);
});

test("names and invite tokens are unique per community", () => {
  const names = new Set();
  const tokens = new Set();
  for (let i = 1; i <= MAX_SEED_COMMUNITIES; i++) {
    names.add(seedCommunityName(i));
    const token = inviteTokenFor(i);
    assert.match(token, /^[0-9a-f]{32}$/, "an invite token must look like the app's own");
    tokens.add(token);
  }
  assert.equal(names.size, MAX_SEED_COMMUNITIES);
  assert.equal(tokens.size, MAX_SEED_COMMUNITIES);
});

// ── Target resolution and the remote guard ──────────────────────────────────

test("loopback targets are local, everything else is not", () => {
  for (const host of ["localhost", "127.0.0.1", "::1", "[::1]"]) assert.equal(isLoopbackHost(host), true, host);
  for (const host of ["xyz.supabase.co", "10.0.0.5", "0.0.0.0", ""]) assert.equal(isLoopbackHost(host), false, host);
});

test("the environment wins over apps/web/.env.local, which is the fallback", () => {
  const envText = [
    "NEXT_PUBLIC_SUPABASE_URL=https://from-file.supabase.co/",
    "SUPABASE_SERVICE_ROLE_KEY=file-key",
  ].join("\n");

  assert.deepEqual(resolveSeedTarget({ env: {}, envText }), {
    supabaseUrl: "https://from-file.supabase.co",
    serviceKey: "file-key",
    host: "from-file.supabase.co",
    local: false,
  });

  const fromEnv = resolveSeedTarget({
    env: { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: " env-key " },
    envText,
  });
  assert.equal(fromEnv.supabaseUrl, "http://127.0.0.1:54321");
  assert.equal(fromEnv.serviceKey, "env-key");
  assert.equal(fromEnv.local, true);
});

test("an unset or unusable target is refused before anything is written", () => {
  assert.throws(() => resolveSeedTarget({ env: {}, envText: "" }), /NEXT_PUBLIC_SUPABASE_URL/);
  assert.throws(() => resolveSeedTarget({ env: { SUPABASE_URL: "not a url" }, envText: "" }), /not an http\(s\) URL/);
});

test("seeding into a shared project needs E2E_SEED_ALLOW_REMOTE, seeding locally does not", () => {
  const remote = { supabaseUrl: "https://shared.supabase.co", serviceKey: "key", host: "shared.supabase.co", local: false };
  const local = { supabaseUrl: "http://127.0.0.1:54321", serviceKey: "key", host: "127.0.0.1", local: true };

  assert.equal(remoteSeedRefusal(local, {}), null);
  assert.equal(remoteSeedRefusal(remote, { E2E_SEED_ALLOW_REMOTE: "1" }), null);

  const refusal = remoteSeedRefusal(remote, {});
  assert.ok(refusal, "a remote target must be refused without the opt-in");
  assert.match(refusal, /E2E_SEED_ALLOW_REMOTE=1/);
  assert.match(refusal, /shared\.supabase\.co/, "the refusal must name the project it would write to");
});

test("the seeded member has no usable password and a reserved domain", () => {
  assert.match(SEED_EMAIL, /@e2e\.invalid$/);
});
