import assert from "node:assert/strict";
import { test } from "node:test";
import { readMessageRequestBody } from "./message-request";

const SELF = "11111111-1111-4111-8111-111111111111";

function request(body: unknown): Request {
  return new Request("http://localhost/api/communities/c1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("captures a UUID client nonce, normalized to lower case", async () => {
  const parsed = await readMessageRequestBody(
    request({
      content: "hello",
      client_nonce: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
    }),
    SELF,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.clientNonce, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
});

test("ignores an old temp-id nonce instead of rejecting the send", async () => {
  const parsed = await readMessageRequestBody(
    request({ content: "hello", client_nonce: "temp-1737000000000-1" }),
    SELF,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.clientNonce, null);
});

test("a malformed nonce is an enhancement miss, not a bad request", async () => {
  const parsed = await readMessageRequestBody(
    request({ content: "hello", client_nonce: 42 }),
    SELF,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.clientNonce, null);
});

test("still rejects empty and over-long messages", async () => {
  const empty = await readMessageRequestBody(request({ content: "   " }), SELF);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, "empty");

  const tooLong = await readMessageRequestBody(
    request({ content: "x".repeat(2001) }),
    SELF,
  );
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.equal(tooLong.reason, "too_long");
});

test("keeps the existing reply and mention contract", async () => {
  const parsed = await readMessageRequestBody(
    request({
      content: "hi @Sam",
      reply_to_id: "22222222-2222-4222-8222-222222222222",
      mentions: [{ user_id: "33333333-3333-4333-8333-333333333333" }, { user_id: SELF }],
      client_nonce: "44444444-4444-4444-8444-444444444444",
    }),
    SELF,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.replyToId, "22222222-2222-4222-8222-222222222222");
  assert.deepEqual(parsed.value.mentionUserIds, ["33333333-3333-4333-8333-333333333333"]);
  assert.equal(parsed.value.clientNonce, "44444444-4444-4444-8444-444444444444");
});
