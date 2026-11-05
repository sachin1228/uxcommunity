/**
 * Contract for the chat viewport gate (lib/messageVisibility.ts): emoji only
 * animate for rows the list reports as visible, and scroll updates must not
 * wake subscribers when the visible set did not change.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMessageVisibilityStore } from './messageVisibility';

test('rows are invisible until the list reports them', () => {
  const store = createMessageVisibilityStore();
  assert.equal(store.isVisible('m1'), false);

  store.setVisible(new Set(['m1', 'm2']));
  assert.equal(store.isVisible('m1'), true);
  assert.equal(store.isVisible('m3'), false);
});

test('subscribers only fire when the visible set changes', () => {
  const store = createMessageVisibilityStore();
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });

  store.setVisible(new Set(['m1']));
  store.setVisible(new Set(['m1']));
  assert.equal(calls, 1);

  store.setVisible(new Set(['m2']));
  assert.equal(calls, 2);

  unsubscribe();
  store.setVisible(new Set());
  assert.equal(calls, 2);
});
