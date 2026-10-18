/**
 * Tests for the thread-poll helpers — the mobile port of the web composer's
 * draft rules and PollResult's percentage maths. Both clients must accept and
 * render the same poll payload, so these pin the shared contract.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  POLL_MAX_OPTIONS,
  POLL_OPTION_MAX_LENGTH,
  POLL_QUESTION_MAX_LENGTH,
  emptyPollDraft,
  normalizePollCounts,
  percentageParts,
  pollDraftFromPoll,
  pollOptionLetter,
  pollTotal,
  serializePollDraft,
  validatePollDraft,
} from './communityPoll';

test('a fresh draft has two empty options and no question', () => {
  assert.deepEqual(emptyPollDraft(), { question: '', options: ['', ''] });
});

test('a poll must ask a question', () => {
  assert.equal(validatePollDraft({ question: '  ', options: ['A', 'B'] }), 'Add a question for your poll.');
});

test('a question may not exceed the API limit', () => {
  const question = 'q'.repeat(POLL_QUESTION_MAX_LENGTH + 1);
  assert.equal(
    validatePollDraft({ question, options: ['A', 'B'] }),
    `Keep the question under ${POLL_QUESTION_MAX_LENGTH} characters.`,
  );
});

test('at least two filled options are required', () => {
  assert.equal(
    validatePollDraft({ question: 'Pick one', options: ['A', '  '] }),
    'Add at least 2 options to your poll.',
  );
});

test('trailing empty option rows are allowed and dropped on serialize', () => {
  const draft = { question: '  Pick one  ', options: ['  A ', 'B', '', '  '] };
  assert.equal(validatePollDraft(draft), null);
  assert.deepEqual(serializePollDraft(draft), { question: 'Pick one', options: ['A', 'B'] });
});

test('an option may not exceed the API limit', () => {
  const option = 'o'.repeat(POLL_OPTION_MAX_LENGTH + 1);
  assert.equal(
    validatePollDraft({ question: 'Pick one', options: [option, 'B'] }),
    `Keep each option under ${POLL_OPTION_MAX_LENGTH} characters.`,
  );
});

test('duplicate options are rejected before the API rejects the payload', () => {
  assert.equal(
    validatePollDraft({ question: 'Pick one', options: ['A', 'a', 'B'] }),
    null,
    'case-sensitive options may coexist, like the API',
  );
  assert.equal(
    validatePollDraft({ question: 'Pick one', options: ['A', 'A'] }),
    'Each option must be different.',
  );
});

test('no more than the maximum number of options can be filled', () => {
  const options = Array.from({ length: POLL_MAX_OPTIONS + 1 }, (_, index) => `Option ${index}`);
  assert.equal(
    validatePollDraft({ question: 'Pick one', options }),
    `You can add up to ${POLL_MAX_OPTIONS} options.`,
  );
});

test('a stored poll becomes an editable draft, and a missing one stays null', () => {
  assert.deepEqual(
    pollDraftFromPoll({ question: 'Pick one', options: ['A', 'B'] }),
    { question: 'Pick one', options: ['A', 'B'] },
  );
  assert.equal(pollDraftFromPoll(null), null);
  assert.equal(pollDraftFromPoll(undefined), null);
});

test('a malformed stored poll still yields a usable draft', () => {
  assert.deepEqual(
    pollDraftFromPoll({ question: 'Pick one', options: ['Only'] }),
    { question: 'Pick one', options: ['Only', ''] },
  );
  assert.deepEqual(
    pollDraftFromPoll({ question: '', options: [] }),
    { question: '', options: ['', ''] },
  );
});

test('vote counts align with the poll options and tolerate missing/negative data', () => {
  const poll = { question: 'Pick one', options: ['A', 'B', 'C'] };
  assert.deepEqual(normalizePollCounts(poll, [1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(normalizePollCounts(poll, [1, 2]), [0, 0, 0]);
  assert.deepEqual(normalizePollCounts(poll, [1, -2, Number.NaN]), [1, 0, 0]);
  assert.deepEqual(normalizePollCounts(null, [1]), []);
});

test('percentages always add up to exactly 100', () => {
  assert.deepEqual(percentageParts([1, 1, 1], 3), [34, 33, 33]);
  assert.deepEqual(percentageParts([2, 1, 1], 4), [50, 25, 25]);
  assert.deepEqual(percentageParts([0, 0, 0], 0), [0, 0, 0]);
});

test('the total is the sum of every option', () => {
  assert.equal(pollTotal([1, 2, 3]), 6);
  assert.equal(pollTotal([]), 0);
});

test('options are lettered A, B, C', () => {
  assert.equal(pollOptionLetter(0), 'A');
  assert.equal(pollOptionLetter(1), 'B');
  assert.equal(pollOptionLetter(25), 'Z');
});
