import assert from 'node:assert/strict';
import test from 'node:test';

import { joinOutcomeFromStatus } from './communityPreviewData';

test('the join endpoint’s requested status becomes a pending request', () => {
  assert.equal(joinOutcomeFromStatus('requested'), 'requested');
});

test('a plain success (or any other body) joins immediately', () => {
  assert.equal(joinOutcomeFromStatus('joined'), 'joined');
  assert.equal(joinOutcomeFromStatus(undefined), 'joined');
  assert.equal(joinOutcomeFromStatus(null), 'joined');
  assert.equal(joinOutcomeFromStatus(''), 'joined');
});
