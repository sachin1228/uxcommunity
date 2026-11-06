import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

function request(authorization?: string): Request {
  return new Request(
    "http://localhost:3000/api/internal/membership-revocations/process",
    {
      method: "POST",
      headers: authorization ? { authorization } : undefined,
    },
  );
}

test("the membership-revocation drain refuses an unauthenticated caller", async () => {
  const previous = process.env.API_SECRET;
  process.env.API_SECRET = "test-internal-secret";
  try {
    const missing = await POST(request() as never);
    assert.equal(missing.status, 401);
    const wrong = await POST(request("Bearer wrong") as never);
    assert.equal(wrong.status, 401);
  } finally {
    if (previous === undefined) delete process.env.API_SECRET;
    else process.env.API_SECRET = previous;
  }
});

test("the drain fails loudly when its secret is unconfigured", async () => {
  const previous = process.env.API_SECRET;
  delete process.env.API_SECRET;
  try {
    const response = await POST(request("Bearer anything") as never);
    assert.equal(response.status, 500);
  } finally {
    if (previous !== undefined) process.env.API_SECRET = previous;
  }
});
