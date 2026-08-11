import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ReactionIntentCoordinator } from "./reaction-intent-coordinator";

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for mutation");
    await delay(10);
  }
}

test("rapid odd and even toggles persist only the latest reaction intent", async () => {
  const requests: Array<string | null> = [];
  let rendered: string | null = null;
  let confirmed: string | null = null;
  const coordinator = new ReactionIntentCoordinator({
    initialValue: null,
    quietWindowMs: 20,
    onOptimisticChange: (value) => { rendered = value; },
    onConfirmed: (result) => { rendered = result.value; },
    persist: async (desired) => {
      requests.push(desired);
      confirmed = desired;
      return { value: desired, data: [] };
    },
  });

  for (let index = 0; index < 6; index += 1) coordinator.toggle("🔥");
  await delay(50);
  assert.deepEqual(requests, []);
  assert.equal(rendered, null);

  for (let index = 0; index < 5; index += 1) coordinator.toggle("🔥");
  await waitFor(() => confirmed === "🔥");
  assert.deepEqual(requests, ["🔥"]);
  assert.equal(rendered, "🔥");
  coordinator.dispose();
});

test("a removal during an in-flight add wins without flashing the add response", async () => {
  const requests: Array<string | null> = [];
  let rendered: string | null = null;
  let persisted: string | null = null;
  const coordinator = new ReactionIntentCoordinator({
    initialValue: null,
    quietWindowMs: 5,
    onOptimisticChange: (value) => { rendered = value; },
    onConfirmed: (result) => { rendered = result.value; },
    persist: async (desired) => {
      requests.push(desired);
      await delay(desired ? 100 : 10);
      persisted = desired;
      return { value: desired, data: [] };
    },
  });

  coordinator.toggle("❤️");
  await waitFor(() => requests.length === 1);
  coordinator.toggle("❤️");
  assert.equal(rendered, null);
  await waitFor(() => requests.length === 2 && persisted === null);
  assert.deepEqual(requests, ["❤️", null]);
  assert.equal(rendered, null);
  coordinator.dispose();
});

test("switching emoji while saving converges directly to the latest emoji", async () => {
  const requests: Array<string | null> = [];
  let rendered: string | null = null;
  const coordinator = new ReactionIntentCoordinator({
    initialValue: null,
    quietWindowMs: 5,
    onOptimisticChange: (value) => { rendered = value; },
    onConfirmed: (result) => { rendered = result.value; },
    persist: async (desired) => {
      requests.push(desired);
      await delay(50);
      return { value: desired, data: [] };
    },
  });

  coordinator.toggle("👍");
  await waitFor(() => requests.length === 1);
  coordinator.toggle("🔥");
  assert.equal(rendered, "🔥");
  await waitFor(() => requests.length === 2);
  await delay(75);
  assert.deepEqual(requests, ["👍", "🔥"]);
  assert.equal(rendered, "🔥");
  coordinator.dispose();
});

test("a terminal failure rolls back to the last confirmed emoji", async () => {
  let rendered: string | null = "👍";
  let reported = false;
  const coordinator = new ReactionIntentCoordinator({
    initialValue: "👍",
    quietWindowMs: 5,
    onOptimisticChange: (value) => { rendered = value; },
    onConfirmed: (result) => { rendered = result.value; },
    persist: async () => { throw new Error("offline"); },
    onError: () => { reported = true; },
  });

  coordinator.toggle("🔥");
  assert.equal(rendered, "🔥");
  await waitFor(() => reported);
  assert.equal(rendered, "👍");
  coordinator.dispose();
});
