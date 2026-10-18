/**
 * Contract for collapsed chat messages (lib/chatTruncation.ts):
 *
 *  1. A long message always keeps a readable body before "… Read more" —
 *     never the bare affordance in an otherwise empty bubble.
 *  2. Fit is decided by the measured line count, not by finding "Read more"
 *     inside `line.text` (iOS omits nested `<Text>` content there).
 *  3. The suffix hugs the last kept word; blank lines in the prefix cannot
 *     push it onto its own line.
 *  4. When measurements never converge, show the full message rather than
 *     hide it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_TRUNCATION_ATTEMPTS,
  READ_MORE_SUFFIX,
  minimumVisibleCut,
  nextTruncationPhase,
  trimToWordBoundary,
  trimTrailingWhitespace,
  type MeasuredLine,
  type TruncationPhase,
} from './chatTruncation';

const COLLAPSED_LINES = 10;

/** The exact message from the report — Devanagari, bullets, blank lines. */
const REPORTED_MESSAGE = `*लाईफ मॅनेजेंटम...!*

• काही काही लोकांनाच चांगले खायला का मिळते..?
 
• काही काही लोकच जीवनात सक्सेस का होतात..?

• काही काही लोकांचच उत्पन्न का चांगले असते..?

• काही काही उपशीच का राहतात..?
.
.

या सगळ्या प्रश्नाची उत्तरे येथे मिळतात.❣️👍❣️😁😁🙃`;

/**
 * Greedy line layout with explicit newlines preserved. `omitSuffixText`
 * simulates the iOS behaviour that caused the bug: the nested "Read more"
 * `Text` still takes line boxes, but its content is missing from `line.text`.
 */
function layout(
  text: string,
  maxChars = 18,
  { omitSuffixText = false }: { omitSuffixText?: boolean } = {},
): MeasuredLine[] {
  const lines: MeasuredLine[] = [];

  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push({ text: '', width: 0 });
      continue;
    }
    for (let i = 0; i < paragraph.length; i += maxChars) {
      const text = paragraph.slice(i, i + maxChars);
      lines.push({ text, width: text.length * 8 });
    }
  }

  if (omitSuffixText) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.text.includes('Read more')) continue;
      const cut = line.text.indexOf(READ_MORE_SUFFIX);
      const text = cut === -1
        ? line.text.replace(/\u2060?…? ?Read more$/, '')
        : line.text.slice(0, cut);
      lines[i] = { text, width: text.length * 8 };
    }
  }

  return lines;
}

function candidateText(plain: string, cut: number): string {
  return plain.slice(0, cut) + READ_MORE_SUFFIX;
}

/** Runs the state machine to a settled phase, as the bubble does. */
function settle(
  plain: string,
  maxChars = 18,
  omitSuffixText = true,
): { phase: TruncationPhase; measurements: number } {
  let phase: TruncationPhase = nextTruncationPhase(
    { kind: 'measuring-full' },
    plain,
    layout(plain, maxChars),
    COLLAPSED_LINES,
  );
  let measurements = 0;

  while (phase.kind === 'measuring-candidate') {
    measurements += 1;
    phase = nextTruncationPhase(
      phase,
      plain,
      layout(candidateText(plain, phase.cut), maxChars, { omitSuffixText }),
      COLLAPSED_LINES,
    );
  }

  return { phase, measurements };
}

test('the reported Marathi message keeps its body instead of collapsing to Read more', () => {
  const { phase, measurements } = settle(REPORTED_MESSAGE);

  assert.equal(phase.kind, 'ready');
  assert.ok(phase.kind === 'ready' && phase.cut !== null);
  const cut = (phase as { cut: number }).cut;
  assert.ok(cut > 0, 'cut must keep message text in the bubble');
  assert.ok(REPORTED_MESSAGE.slice(0, cut).trim().length > 0);
  assert.doesNotMatch(REPORTED_MESSAGE.slice(0, cut), /\s$/);
  assert.ok(measurements < 6, `truncation settled in ${measurements} measurements`);

  const lines = layout(candidateText(REPORTED_MESSAGE, cut), 18, {
    omitSuffixText: true,
  });
  assert.ok(lines.length <= COLLAPSED_LINES);
});

test('fit does not depend on the suffix appearing in line.text', () => {
  // iOS reports ten line boxes but omits the nested suffix text from the last.
  const plain = 'word '.repeat(80).trim();
  const lines = layout('word '.repeat(80).trim() + READ_MORE_SUFFIX, 18, {
    omitSuffixText: true,
  });
  const settled = nextTruncationPhase(
    { kind: 'measuring-candidate', cut: 200, attempts: 1 },
    plain,
    lines.slice(0, COLLAPSED_LINES),
    COLLAPSED_LINES,
  );

  assert.deepEqual(settled, { kind: 'ready', cut: 200 });
});

test('a short message needs no affordance even without suffix text', () => {
  const plain = 'Short message with no wrapping.';
  const phase = nextTruncationPhase(
    { kind: 'measuring-full' },
    plain,
    layout(plain),
    COLLAPSED_LINES,
  );

  assert.deepEqual(phase, { kind: 'ready', cut: null });
});

test('every measured cut leaves the suffix hugging the last word', () => {
  const plain = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda\n\n\nmu nu xi omicron pi rho sigma tau upsilon phi chi psi omega';
  let phase: TruncationPhase = nextTruncationPhase(
    { kind: 'measuring-full' },
    plain,
    layout(plain, 12),
    3,
  );

  let sawCandidate = false;
  for (let i = 0; i < 8 && phase.kind === 'measuring-candidate'; i += 1) {
    sawCandidate = true;
    assert.doesNotMatch(plain.slice(0, phase.cut), /\s$/);
    phase = nextTruncationPhase(
      phase,
      plain,
      layout(candidateText(plain, phase.cut), 12),
      3,
    );
  }

  assert.ok(sawCandidate);
  assert.equal(phase.kind, 'ready');
});

test('a pathological layout fails open to the full message instead of cut 0', () => {
  const plain = 'A message that cannot be measured in any sane way. '.repeat(12).trim();
  let phase: TruncationPhase = nextTruncationPhase(
    { kind: 'measuring-full' },
    plain,
    layout(plain, 12),
    COLLAPSED_LINES,
  );
  assert.equal(phase.kind, 'measuring-candidate');

  // Keep reporting one overflowing line past the clamp forever.
  const stubborn = Array.from({ length: COLLAPSED_LINES + 1 }, (_, i) => ({
    text: `line ${i}`,
    width: 200,
  }));

  for (let i = 0; i < MAX_TRUNCATION_ATTEMPTS + 2 && phase.kind === 'measuring-candidate'; i += 1) {
    phase = nextTruncationPhase(phase, plain, stubborn, COLLAPSED_LINES);
  }

  assert.deepEqual(phase, { kind: 'ready', cut: null });
});

test('very narrow bubbles still keep the first word', () => {
  const plain = 'Supercalifragilisticexpialidocious and more words after it';
  const { phase } = settle(plain, 5);
  assert.equal(phase.kind, 'ready');
  if (phase.kind === 'ready' && phase.cut !== null) {
    assert.ok(phase.cut >= minimumVisibleCut(plain));
  }
});

test('helpers stop on word boundaries and drop whitespace', () => {
  assert.equal(trimToWordBoundary('alpha beta gamma', 12), 11);
  assert.equal(trimTrailingWhitespace('alpha beta gamma', 11), 10);
  assert.equal(trimTrailingWhitespace('alpha beta\n\n', 12), 10);
  assert.equal(minimumVisibleCut('  first word second'), 7);
  assert.equal(minimumVisibleCut('   '), 3);
});

test('empty and whitespace-only content is shown in full', () => {
  assert.deepEqual(
    nextTruncationPhase({ kind: 'measuring-full' }, '', [], COLLAPSED_LINES),
    { kind: 'ready', cut: null },
  );
  assert.deepEqual(
    nextTruncationPhase({ kind: 'measuring-full' }, ' \n\n ', [], COLLAPSED_LINES),
    { kind: 'ready', cut: null },
  );
});
