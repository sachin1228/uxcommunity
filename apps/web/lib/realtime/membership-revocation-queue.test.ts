import assert from "node:assert/strict";
import test from "node:test";
import {
  attemptMembershipRevocationNow,
  nextAttemptDelaySeconds,
  processRevocationRows,
  type PendingMembershipRevocation,
} from "./membership-revocation-queue";

const item: PendingMembershipRevocation = {
  id: "row-1",
  userId: "user-1",
  communityId: "community-1",
  attempts: 0,
  createdAt: "2026-11-06T00:00:00.000Z",
};

function harness(options: {
  member?: boolean;
  revokeResults?: boolean[];
  now?: number;
}) {
  const calls = {
    revoke: 0,
    completed: 0,
    rescheduled: [] as Array<{
      attempts: number;
      nextAttemptAt: string;
      lastError: string;
    }>,
  };
  const results = [...(options.revokeResults ?? [])];
  return {
    calls,
    deps: {
      now: () => options.now ?? Date.parse("2026-11-06T00:00:00.000Z"),
      isStillMember: async () => options.member ?? false,
      revoke: async () => {
        calls.revoke += 1;
        return results.shift() ?? false;
      },
      markCompleted: async () => {
        calls.completed += 1;
      },
      reschedule: async (
        _row: PendingMembershipRevocation,
        attempts: number,
        nextAttemptAt: string,
        lastError: string,
      ) => {
        calls.rescheduled.push({ attempts, nextAttemptAt, lastError });
      },
    },
  };
}

test("a failed realtime close is rescheduled with bounded backoff", async () => {
  const h = harness({ revokeResults: [false] });
  const summary = await processRevocationRows([item], h.deps);

  assert.deepEqual(summary, { scanned: 1, completed: 0, failed: 1, skipped: 0 });
  assert.equal(h.calls.revoke, 1);
  assert.equal(h.calls.completed, 0);
  assert.deepEqual(h.calls.rescheduled, [
    {
      attempts: 1,
      nextAttemptAt: "2026-11-06T00:00:15.000Z",
      lastError: "realtime revocation failed",
    },
  ]);
});

test("a later retry succeeds and completes the row", async () => {
  const h = harness({ revokeResults: [true] });
  const retry = { ...item, attempts: 1 };
  const summary = await processRevocationRows([retry], h.deps);

  assert.deepEqual(summary, { scanned: 1, completed: 1, failed: 0, skipped: 0 });
  assert.equal(h.calls.completed, 1);
  assert.equal(h.calls.rescheduled.length, 0);
});

test("a member who rejoined is completed without closing their new sockets", async () => {
  const h = harness({ member: true, revokeResults: [true] });
  const summary = await processRevocationRows([item], h.deps);

  assert.deepEqual(summary, { scanned: 1, completed: 1, failed: 0, skipped: 1 });
  assert.equal(h.calls.revoke, 0, "rejoined members must not be disconnected");
  assert.equal(h.calls.completed, 1);
});

test("one failure does not stop later rows in the batch", async () => {
  const h = harness({ revokeResults: [false, true] });
  const second = {
    id: "row-2",
    userId: "user-2",
    communityId: "community-2",
    attempts: 0,
    createdAt: "2026-11-06T00:00:00.000Z",
  };
  const summary = await processRevocationRows([item, second], h.deps);

  assert.deepEqual(summary, { scanned: 2, completed: 1, failed: 1, skipped: 0 });
  assert.equal(h.calls.revoke, 2);
  assert.equal(h.calls.completed, 1);
  assert.equal(h.calls.rescheduled.length, 1);
});

test("backoff is exponential and capped at one hour", () => {
  assert.equal(nextAttemptDelaySeconds(0), 15);
  assert.equal(nextAttemptDelaySeconds(1), 30);
  assert.equal(nextAttemptDelaySeconds(2), 60);
  assert.equal(nextAttemptDelaySeconds(3), 120);
  assert.equal(nextAttemptDelaySeconds(8), 3600);
  assert.equal(nextAttemptDelaySeconds(100), 3600);
  assert.equal(nextAttemptDelaySeconds(-1), 15);
});


test("the immediate close is close-only; the queue owns bookkeeping", async () => {
  let attempts = 0;
  const ok = await attemptMembershipRevocationNow(
    "user-1",
    "community-1",
    async (input) => {
      attempts += 1;
      assert.deepEqual(input, { userId: "user-1", communityId: "community-1" });
      return true;
    },
  );
  assert.equal(ok, true);
  assert.equal(attempts, 1);
});
