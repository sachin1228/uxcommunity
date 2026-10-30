import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSession,
  type SessionRegistryRow,
} from "./session-validity";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-30T12:00:00.000Z");
const EPOCH = "admin-epoch-1";

function userRow(overrides: Partial<SessionRegistryRow> = {}): SessionRegistryRow {
  return {
    id: "session-1",
    user_id: USER_ID,
    role: "user",
    session_version: 4,
    revoked_at: null,
    expires_at: "2026-11-06T12:00:00.000Z",
    users: {
      id: USER_ID,
      is_blocked: false,
      session_version: 4,
    },
    ...overrides,
  };
}

function userClaims(overrides: Partial<{ userId: string; role: "user"; sv: number }> = {}) {
  return { userId: USER_ID, role: "user" as const, sv: 4, ...overrides };
}

function options(overrides: Partial<{ allowBlocked: boolean }> = {}) {
  return { now: NOW, adminEpoch: null, ...overrides };
}

test("a live, version-matched user session is accepted", () => {
  assert.equal(evaluateSession(userRow(), userClaims(), options()).active, true);
});

test("logout revokes exactly one device without invalidating the other", () => {
  assert.equal(
    evaluateSession(userRow({ revoked_at: "2026-10-30T11:00:00.000Z" }), userClaims(), options()).active,
    false,
  );
  assert.equal(
    evaluateSession(userRow({ id: "session-2" }), userClaims(), options()).active,
    true,
  );
});

test("logout-all bumps the version so every old token is rejected", () => {
  assert.equal(evaluateSession(userRow(), userClaims({ sv: 3 }), options()).active, false);
  assert.equal(evaluateSession(userRow({ session_version: 3 }), userClaims(), options()).active, false);
});

test("password reset invalidates old sessions through the version bump", () => {
  assert.equal(evaluateSession(userRow({ session_version: 5 }), userClaims({ sv: 4 }), options()).active, false);
});

test("account deletion removes the embedded user and is rejected", () => {
  assert.equal(evaluateSession(userRow({ users: null }), userClaims(), options()).active, false);
});

test("suspension rejects even a structurally valid token", () => {
  const row = userRow({
    users: { id: USER_ID, is_blocked: true, session_version: 4 },
  });
  assert.equal(evaluateSession(row, userClaims(), options()).active, false);
});

test("blocked erasure path is allowed only when explicitly opted in", () => {
  const row = userRow({
    users: { id: USER_ID, is_blocked: true, session_version: 4 },
  });
  assert.equal(
    evaluateSession(row, userClaims(), options({ allowBlocked: true })).active,
    true,
  );
  assert.equal(
    evaluateSession(
      row,
      userClaims({ sv: 3 }),
      options({ allowBlocked: true }),
    ).active,
    false,
  );
});

test("unblocking does not resurrect a pre-suspension token", () => {
  // The row is no longer blocked, but the generation moved past the token's sv.
  const row = userRow({
    session_version: 6,
    users: { id: USER_ID, is_blocked: false, session_version: 6 },
  });
  assert.equal(evaluateSession(row, userClaims({ sv: 5 }), options()).active, false);
});

test("expired tokens are rejected even without a revocation", () => {
  assert.equal(
    evaluateSession(userRow({ expires_at: "2026-10-30T11:59:59.000Z" }), userClaims(), options()).active,
    false,
  );
});

test("malformed expiry fails closed", () => {
  assert.equal(evaluateSession(userRow({ expires_at: "not-a-date" }), userClaims(), options()).active, false);
});

test("a token for another user cannot use this registry row", () => {
  assert.equal(
    evaluateSession(userRow(), userClaims({ userId: "22222222-2222-4222-8222-222222222222" }), options()).active,
    false,
  );
});

test("a user token cannot impersonate an admin row", () => {
  const row = userRow({ role: "admin", user_id: null, users: null });
  assert.equal(evaluateSession(row, userClaims(), options()).active, false);
});

test("a valid admin token with the current epoch is accepted", () => {
  const row = userRow({ role: "admin", user_id: null, users: null, session_version: 0 });
  assert.equal(
    evaluateSession(
      row,
      { role: "admin", adm: EPOCH },
      { now: NOW, adminEpoch: EPOCH },
    ).active,
    true,
  );
});

test("rotating ADMIN_PASSWORD changes the epoch and rejects old admin tokens", () => {
  const row = userRow({ role: "admin", user_id: null, users: null, session_version: 0 });
  assert.equal(
    evaluateSession(
      row,
      { role: "admin", adm: EPOCH },
      { now: NOW, adminEpoch: "admin-epoch-2" },
    ).active,
    false,
  );
});

test("admin logout-all revokes the registry row", () => {
  const row = userRow({
    role: "admin",
    user_id: null,
    users: null,
    session_version: 0,
    revoked_at: "2026-10-30T11:30:00.000Z",
  });
  assert.equal(
    evaluateSession(row, { role: "admin", adm: EPOCH }, { now: NOW, adminEpoch: EPOCH }).active,
    false,
  );
});

test("a missing admin epoch fails closed", () => {
  const row = userRow({ role: "admin", user_id: null, users: null, session_version: 0 });
  assert.equal(
    evaluateSession(row, { role: "admin", adm: EPOCH }, { now: NOW, adminEpoch: null }).active,
    false,
  );
});

test("a deleted user row cannot validate an admin claim", () => {
  const row = userRow({ role: "admin", user_id: USER_ID, session_version: 0 });
  assert.equal(
    evaluateSession(row, { role: "admin", adm: EPOCH }, { now: NOW, adminEpoch: EPOCH }).active,
    false,
  );
});

test("an unaffected user keeps working while another session is revoked", () => {
  const other = userRow({
    id: "session-other",
    user_id: "22222222-2222-4222-8222-222222222222",
    users: {
      id: "22222222-2222-4222-8222-222222222222",
      is_blocked: false,
      session_version: 4,
    },
  });
  assert.equal(
    evaluateSession(
      other,
      { userId: "22222222-2222-4222-8222-222222222222", role: "user", sv: 4 },
      options(),
    ).active,
    true,
  );
});

test("a reset that commits during login leaves no token on the old generation", () => {
  // Login read generation 4, the reset moved the account to 5 and revoked rows.
  const resetRow = userRow({
    session_version: 5,
    users: { id: USER_ID, is_blocked: false, session_version: 5 },
  });
  assert.equal(evaluateSession(resetRow, userClaims({ sv: 4 }), options()).active, false);

  // A login that starts after the reset receives `sv: 5` and is valid.
  const freshClaims = userClaims({ sv: 5 });
  assert.equal(evaluateSession(resetRow, freshClaims, options()).active, true);
});

test("a token validated before a revocation is rejected on the next evaluation", () => {
  assert.equal(evaluateSession(userRow(), userClaims(), options()).active, true);
  assert.equal(
    evaluateSession(
      userRow({ revoked_at: "2026-10-30T12:00:01.000Z" }),
      userClaims(),
      options(),
    ).active,
    false,
  );
});
