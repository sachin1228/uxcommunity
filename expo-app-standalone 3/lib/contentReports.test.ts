import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REPORT_CONTENT_LABELS,
  REPORT_CONTENT_TYPES,
  REPORT_CONTENT_TYPE_BY_KIND,
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  isAlreadyReported,
  reportReasonLabel,
} from './contentReports';

test('every card kind reports through a distinct API content type', () => {
  const kinds = ['threads', 'showcase', 'resources', 'events'] as const;
  const mapped = kinds.map((kind) => REPORT_CONTENT_TYPE_BY_KIND[kind]);

  assert.deepEqual(mapped, ['thread', 'showcase', 'resource', 'event']);
  assert.equal(new Set(mapped).size, REPORT_CONTENT_TYPES.length);
  for (const type of mapped) {
    assert.ok(REPORT_CONTENT_TYPES.includes(type));
    assert.ok(REPORT_CONTENT_LABELS[type]);
  }
});

test('the reason list matches the persisted API values', () => {
  assert.deepEqual(
    REPORT_REASONS.map((reason) => reason.value),
    [
      'spam',
      'harassment',
      'hate',
      'misinformation',
      'inappropriate',
      'intellectual_property',
      'off_topic',
      'other',
    ],
  );
  assert.equal(new Set(REPORT_REASONS.map((reason) => reason.value)).size, REPORT_REASONS.length);
});

test('reason labels resolve, with the raw id as the legacy fallback', () => {
  assert.equal(reportReasonLabel('spam'), 'Spam or scam');
  assert.equal(reportReasonLabel('intellectual_property'), 'Stolen work or plagiarism');
  assert.equal(reportReasonLabel('something_old'), 'something_old');
});

test('details keep the server’s 1000-character cap', () => {
  assert.equal(REPORT_DETAILS_MAX_LENGTH, 1000);
});

test('only a 409 counts as already reported', () => {
  assert.equal(isAlreadyReported({ status: 409 }), true);
  assert.equal(isAlreadyReported({ status: 500 }), false);
  assert.equal(isAlreadyReported(new Error('nope')), false);
  assert.equal(isAlreadyReported(null), false);
});
