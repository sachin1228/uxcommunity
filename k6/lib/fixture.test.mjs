/**
 * Unit tests for the k6 fixture helpers and for the guards that keep generated
 * credentials out of git.
 *
 *   npm run test:k6-fixtures
 *
 * No network, database, or k6 binary is needed: these cover the fixture shape
 * and the "credentials never get committed" rules the load tests rely on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIXTURE_PATH,
  FIXTURE_FIELDS,
  REQUIRED_FIELDS,
  SETUP_COMMAND,
  buildFixture,
  emptyFields,
  validateFixture,
} from "./fixture.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function git(args) {
  return spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

/** Files under k6/ that would leak credentials if they were ever committed. */
function trackedK6Matches(pattern) {
  const result = git(["grep", "-n", "-I", "-E", pattern, "--", "k6/"]);

  // git grep exits 0 on matches, 1 when nothing matched, 2 on error.
  assert.notEqual(result.status, 2, `git grep failed: ${result.stderr}`);
  if (result.status !== 0) return [];

  return result.stdout.trim().split("\n").filter(Boolean);
}

function seedUser(index = 1) {
  const suffix = String(index).padStart(4, "0");
  return {
    email: `k6user_${suffix}@k6test.invalid`,
    password: "password-generated-for-this-run",
    name: `k6 Test User ${suffix}`,
    userId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    sessionToken: `header.payload-${index}.signature-${index}`,
  };
}

// ── buildFixture (what the seeder writes) ─────────────────────────────────

test("buildFixture writes every required field with a non-empty value", () => {
  const users = buildFixture([seedUser(1), seedUser(2)]);

  assert.equal(users.length, 2);
  for (const user of users) {
    assert.deepEqual(Object.keys(user), FIXTURE_FIELDS);
    for (const field of REQUIRED_FIELDS) {
      assert.equal(typeof user[field], "string");
      assert.notEqual(user[field].length, 0, `${field} must not be empty`);
    }
  }
});

test("buildFixture drops unknown fields", () => {
  const [user] = buildFixture([{ ...seedUser(1), extra: "should-not-survive" }]);

  assert.equal("extra" in user, false);
});

test("buildFixture refuses to write a fixture with no users", () => {
  assert.throws(() => buildFixture([]), /no seeded users/);
});

test("buildFixture refuses entries with an empty password or session", () => {
  assert.throws(
    () => buildFixture([{ ...seedUser(1), sessionToken: "" }]),
    (error) => error.message.includes("sessionToken") && error.message.includes(SETUP_COMMAND),
  );

  assert.throws(
    () => buildFixture([{ ...seedUser(1), password: "" }]),
    (error) => error.message.includes("password") && error.message.includes("npm run k6:seed"),
  );

  assert.throws(
    () => buildFixture([{ ...seedUser(1), userId: undefined }]),
    /userId/,
  );
});

// ── validateFixture (what the scenarios and the admin runner load) ─────────

test("validateFixture accepts a complete fixture and returns it unchanged", () => {
  const users = [seedUser(1), seedUser(2)];

  assert.equal(validateFixture(users), users);
});

test("validateFixture rejects anything that is not a non-empty array", () => {
  assert.throws(() => validateFixture(null), /must be a JSON array/);
  assert.throws(() => validateFixture({ users: [seedUser(1)] }), /must be a JSON array/);
  assert.throws(() => validateFixture([]), /contains no seeded users/);
});

test("validateFixture reports missing credentials with the setup command", () => {
  const broken = [{ ...seedUser(1), password: "", sessionToken: "" }, seedUser(2)];

  assert.throws(
    () => validateFixture(broken),
    (error) =>
      error.message.includes("entry 1") &&
      error.message.includes("password") &&
      error.message.includes("sessionToken") &&
      error.message.includes(SETUP_COMMAND),
  );
});

test("validateFixture enforces the requested VU count", () => {
  const users = [seedUser(1), seedUser(2)];

  assert.equal(validateFixture(users, { requiredUsers: 2 }).length, 2);

  assert.throws(
    () => validateFixture(users, { requiredUsers: 3 }),
    (error) => error.message.includes("3 VUs requested") && error.message.includes("K6_USER_COUNT"),
  );
});

test("emptyFields lists only the missing or blank fields", () => {
  assert.deepEqual(emptyFields(seedUser(1)), []);
  assert.deepEqual(emptyFields({ ...seedUser(1), email: "", name: "" }), ["email"]);
  assert.deepEqual(emptyFields(null), [...REQUIRED_FIELDS]);
});

// ── Guard rails: the credentials file stays untracked ─────────────────────

test("the generated fixture is gitignored and never tracked", () => {
  assert.equal(
    git(["check-ignore", "-q", FIXTURE_PATH]).status,
    0,
    `${FIXTURE_PATH} must be gitignored so seeded credentials cannot be committed`,
  );

  assert.notEqual(
    git(["ls-files", "--error-unmatch", FIXTURE_PATH]).status,
    0,
    `${FIXTURE_PATH} is tracked again — remove it and keep only generated copies`,
  );
});

test("no k6 credential material is tracked in git", () => {
  // Credential *shapes*, not specific values: this guard must not itself
  // contain the material it looks for.
  const patterns = [
    // Signed session / API JWTs: header.payload.signature. This is the shape of
    // both the seeded session tokens and a Supabase service-role key.
    "eyJ[A-Za-z0-9_-]{20,}[.][A-Za-z0-9_-]{20,}[.][A-Za-z0-9_-]{10,}",
    // A re-committed credential fixture: JSON records carrying a password or
    // sessionToken field, which is exactly what k6/data/test-users.json is.
    '"(sessionToken|password)"[[:space:]]*:',
  ];

  for (const pattern of patterns) {
    assert.deepEqual(
      trackedK6Matches(pattern),
      [],
      `tracked k6 files must not contain credential material (pattern: ${pattern})`,
    );
  }
});
