import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatScrollIndicatorGate } from './chatScrollIndicator';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function countedGate(options: { settleMs?: number; maxDelayMs?: number } = {}) {
  let reveals = 0;
  const gate = createChatScrollIndicatorGate({
    onReveal: () => {
      reveals += 1;
    },
    settleMs: options.settleMs ?? 25,
    maxDelayMs: options.maxDelayMs ?? 1000,
  });
  return { gate, reveals: () => reveals };
}

test('the bar waits for the row batches to stop arriving', async () => {
  const { gate, reveals } = countedGate({ settleMs: 30 });

  gate.measure(900);
  await sleep(10);
  assert.equal(reveals(), 0, 'one batch is not a settled list');

  gate.measure(1400);
  await sleep(10);
  assert.equal(reveals(), 0, 'each batch restarts the clock instead of revealing');

  gate.measure(2100);
  await sleep(60);
  assert.equal(reveals(), 1);
});

test('later content growth never runs the reveal again', async () => {
  const { gate, reveals } = countedGate({ settleMs: 15 });

  gate.measure(900);
  await sleep(40);
  assert.equal(reveals(), 1);

  // Pagination, a new message, an image finishing decode.
  gate.measure(4000);
  await sleep(40);
  assert.equal(reveals(), 1);
});

test('a list that never goes quiet still gets its bar at the ceiling', async () => {
  const { gate, reveals } = countedGate({ settleMs: 100, maxDelayMs: 40 });

  const pump = setInterval(() => gate.measure(500 + Math.random() * 100), 5);
  await sleep(80);
  clearInterval(pump);

  assert.equal(reveals(), 1);
});

test('an empty list starts no clock', async () => {
  const { gate, reveals } = countedGate({ settleMs: 15 });

  gate.measure(0);
  gate.measure(Number.NaN);
  gate.measure(-1);
  await sleep(40);
  assert.equal(reveals(), 0);

  // The first real height still opens the window normally.
  gate.measure(900);
  await sleep(40);
  assert.equal(reveals(), 1);
});

test('dispose cancels a pending reveal', async () => {
  const { gate, reveals } = countedGate({ settleMs: 20 });

  gate.measure(900);
  gate.dispose();
  await sleep(50);
  assert.equal(reveals(), 0);
});
