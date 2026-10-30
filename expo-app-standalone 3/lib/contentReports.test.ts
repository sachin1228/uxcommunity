import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTENT_REPORT_ENDPOINT,
  INTERACTION_REPORT_ENDPOINT,
  INTERACTION_REPORT_TYPES,
  REPORT_COMMENT_TYPE_BY_KIND,
  REPORT_CONTENT_LABELS,
  REPORT_CONTENT_TYPES,
  REPORT_CONTENT_TYPE_BY_KIND,
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  isAlreadyReported,
  isInteractionReportType,
  reportEndpointFor,
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

test('comments report through the interaction queue with a distinct type per kind', () => {
  const kinds = ['threads', 'showcase', 'resources', 'events'] as const;
  const mapped = kinds.map((kind) => REPORT_COMMENT_TYPE_BY_KIND[kind]);

  assert.deepEqual(mapped, [
    'thread_comment',
    'showcase_comment',
    'resource_comment',
    'event_comment',
  ]);
  assert.equal(new Set(mapped).size, kinds.length);
  for (const type of mapped) assert.ok(INTERACTION_REPORT_TYPES.includes(type));
});

test('post and interaction reports route to their own endpoints', () => {
  for (const type of REPORT_CONTENT_TYPES) {
    assert.equal(isInteractionReportType(type), false);
    assert.equal(reportEndpointFor(type), CONTENT_REPORT_ENDPOINT);
  }
  for (const type of INTERACTION_REPORT_TYPES) {
    assert.equal(isInteractionReportType(type), true);
    assert.equal(reportEndpointFor(type), INTERACTION_REPORT_ENDPOINT);
    assert.ok(REPORT_CONTENT_LABELS[type]);
  }
  assert.notEqual(CONTENT_REPORT_ENDPOINT, INTERACTION_REPORT_ENDPOINT);
});

test('the two report queues never share a content type', () => {
  const all = [...REPORT_CONTENT_TYPES, ...INTERACTION_REPORT_TYPES];
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 10);
});
