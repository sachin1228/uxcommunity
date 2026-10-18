/**
 * Thread poll helpers — the mobile counterpart of the web
 * `lib/communities/models/threads.ts` poll limits and
 * `components/communities/threads/PollResult.tsx`.
 *
 * Deliberately dependency-free so draft validation, serialization and the
 * percentage maths can be tested without React Native.
 */

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 6;
export const POLL_QUESTION_MAX_LENGTH = 200;
export const POLL_OPTION_MAX_LENGTH = 100;

/** The stored shape of a thread poll (the API's `poll` JSON column). */
export interface ThreadPoll {
  question: string;
  options: string[];
}

/** The editable shape used by the composer. */
export interface ThreadPollDraft {
  question: string;
  options: string[];
}

/** The poll state a card or detail renders after local/server reconciliation. */
export interface PollViewState {
  counts: number[];
  userVote: number | null;
  undoUsed: boolean;
}

/** A fresh draft — two empty options, the API's minimum. */
export function emptyPollDraft(): ThreadPollDraft {
  return { question: '', options: ['', ''] };
}

/**
 * The editor's draft from a stored poll (null when there is no poll). A
 * malformed stored poll still yields an editable draft: the composer pads the
 * option list to the minimum instead of rendering an empty panel.
 */
export function pollDraftFromPoll(
  poll: ThreadPoll | null | undefined,
): ThreadPollDraft | null {
  if (!poll) return null;
  const options = Array.isArray(poll.options) ? [...poll.options] : [];
  while (options.length < POLL_MIN_OPTIONS) options.push('');
  return {
    question: typeof poll.question === 'string' ? poll.question : '',
    options: options.slice(0, POLL_MAX_OPTIONS),
  };
}

/**
 * A human-readable reason the draft cannot be posted, or null when it can.
 *
 * Trailing empty option rows are allowed and dropped on serialize (the web
 * composer behaves the same way); at least two filled options are required.
 */
export function validatePollDraft(draft: ThreadPollDraft): string | null {
  const question = draft.question.trim();
  if (!question) return 'Add a question for your poll.';
  if (question.length > POLL_QUESTION_MAX_LENGTH) {
    return `Keep the question under ${POLL_QUESTION_MAX_LENGTH} characters.`;
  }

  const options = draft.options.map((option) => option.trim()).filter(Boolean);
  if (options.length < POLL_MIN_OPTIONS) {
    return `Add at least ${POLL_MIN_OPTIONS} options to your poll.`;
  }
  if (options.length > POLL_MAX_OPTIONS) {
    return `You can add up to ${POLL_MAX_OPTIONS} options.`;
  }
  if (options.some((option) => option.length > POLL_OPTION_MAX_LENGTH)) {
    return `Keep each option under ${POLL_OPTION_MAX_LENGTH} characters.`;
  }
  if (new Set(options).size !== options.length) {
    return 'Each option must be different.';
  }
  return null;
}

/**
 * Trim + serialize a validated draft into the stored poll shape. Mirrors the
 * web `serializePollDraft`; empty option rows are dropped.
 */
export function serializePollDraft(draft: ThreadPollDraft): ThreadPoll {
  return {
    question: draft.question.trim(),
    options: draft.options.map((option) => option.trim()).filter(Boolean),
  };
}

/** Vote counts aligned with the poll's options, or zeros when they are not. */
export function normalizePollCounts(
  poll: ThreadPoll | null | undefined,
  counts: number[] | null | undefined,
): number[] {
  const optionCount = poll?.options.length ?? 0;
  if (!Array.isArray(counts) || counts.length !== optionCount) {
    return Array.from({ length: optionCount }, () => 0);
  }
  return counts.map((count) => (Number.isFinite(count) && count > 0 ? count : 0));
}

/** Total votes across every option. */
export function pollTotal(counts: number[]): number {
  return counts.reduce((sum, count) => sum + count, 0);
}

/**
 * Round per-option percentages so they always sum to exactly 100
 * (largest-remainder method) — no 33% + 33% + 33% = 99% artifacts. This is the
 * web `percentageParts` maths, ported verbatim.
 */
export function percentageParts(counts: number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);
  const floors = counts.map((count) => Math.floor((count * 100) / total));
  const remainders = counts.map((count, index) => (count * 100) / total - floors[index]);
  let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);
  const byRemainder = counts
    .map((_, index) => index)
    .sort((a, b) => remainders[b] - remainders[a]);
  for (const index of byRemainder) {
    if (remainder <= 0) break;
    floors[index] += 1;
    remainder -= 1;
  }
  return floors;
}

/** A, B, C… for an option index. */
export function pollOptionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}
