import test from "node:test";
import assert from "node:assert/strict";

import {
  dmProxyPathFromKey,
  extensionFromKey,
  isMigratableUrl,
  legacyKeyFromPublicUrl,
  ownerIdFromKey,
  privateCategory,
  targetKeyFor,
} from "./migrate-private-r2-plan.mjs";

const BASE = "https://media.example.test";

test("only our own public URLs under a private prefix are migratable", () => {
  assert.equal(isMigratableUrl(`${BASE}/resumes/u/a.pdf`, BASE), true);
  assert.equal(isMigratableUrl(`${BASE}/verification/u/a.webp`, BASE), true);
  assert.equal(isMigratableUrl(`${BASE}/dm/c/a.webp`, BASE), true);
  assert.equal(isMigratableUrl(`${BASE}/avatars/u/a.webp`, BASE), false);
  assert.equal(isMigratableUrl(`https://elsewhere.test/resumes/u/a.pdf`, BASE), false);
  assert.equal(isMigratableUrl(`${BASE}/resumes/u/../a.pdf`, BASE), false);
  assert.equal(isMigratableUrl(null, BASE), false);
});

test("keys are classified by their namespace", () => {
  assert.equal(privateCategory("resumes/u/a.pdf"), "resumes");
  assert.equal(privateCategory("verification/u/a.webp"), "verification");
  assert.equal(privateCategory("dm/c/a.webp"), "dm");
  assert.equal(privateCategory("chat/c/a.webp"), null);
});

test("legacy key parsing normalizes the base and strips the slash", () => {
  assert.equal(legacyKeyFromPublicUrl(`${BASE}/resumes/u/a.pdf`, `${BASE}/`), "resumes/u/a.pdf");
  assert.equal(legacyKeyFromPublicUrl(`${BASE}/resumes/u/a.pdf`, "https://other.test"), null);
});

test("owner and extension come from the legacy key", () => {
  assert.equal(ownerIdFromKey("resumes/user-id/a.pdf"), "user-id");
  assert.equal(ownerIdFromKey("dm/conversation-id/a.webp"), "conversation-id");
  assert.equal(extensionFromKey("dm/c/a.WEBP"), "webp");
  assert.equal(extensionFromKey("dm/c/no-extension", "bin"), "bin");
});

test("DM targets keep the two-segment shape the proxy route understands", () => {
  const target = targetKeyFor("dm", "conv-id", "webp", "uuid");
  assert.equal(target, "dm/conv-id/uuid.webp");
  assert.equal(dmProxyPathFromKey(target), "/api/private/dm/conv-id/uuid.webp");
});

test("resume/verification targets are namespaced and unpredictable", () => {
  assert.equal(
    targetKeyFor("resumes", "user-id", "pdf", "uuid"),
    "resumes/user-id/migrated/uuid.pdf",
  );
  assert.equal(
    targetKeyFor("verification", "user-id", "webp", "uuid"),
    "verification/user-id/migrated/uuid.webp",
  );
});
