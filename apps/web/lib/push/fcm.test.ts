import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFcmMessage, loadFcmServiceAccount } from "./fcm";

test("a complete service account is accepted; junk is not", () => {
  const account = loadFcmServiceAccount({
    FCM_SERVICE_ACCOUNT: JSON.stringify({
      project_id: "uxcommunity",
      client_email: "firebase@example.com",
      private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    }),
  });
  assert.equal(account?.project_id, "uxcommunity");
  assert.equal(account?.client_email, "firebase@example.com");

  assert.equal(loadFcmServiceAccount({}), null);
  assert.equal(loadFcmServiceAccount({ FCM_SERVICE_ACCOUNT: "not json" }), null);
  assert.equal(
    loadFcmServiceAccount({ FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: "x" }) }),
    null,
  );
});

test("a chat message is data-only, high priority, and collapses per community", () => {
  const payload = buildFcmMessage({
    token: "fcm-token",
    data: {
      type: "community_message",
      direct: "1",
      communityId: "c-1",
      communityName: "Designers",
      senderName: "Arun",
      message: "hello",
      imageUrl: "https://media.example/dp.webp",
      silent: "0",
      badge: "4",
    },
    collapseKey: "community-c-1",
    ttlSeconds: 3600,
  });

  assert.equal(payload.message.token, "fcm-token");
  assert.equal(payload.message.data.direct, "1");
  assert.equal(payload.message.android.priority, "high");
  assert.equal(payload.message.android.collapse_key, "community-c-1");
  assert.equal(payload.message.android.ttl, "3600s");
  // No `notification` block: the app's service draws this one.
  assert.equal("notification" in payload.message, false);
});
