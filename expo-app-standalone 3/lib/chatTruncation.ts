/**
 * Truncation state machine for a collapsed chat message.
 *
 * React Native cannot append text after its native `numberOfLines` clamp, so
 * the bubble measures an uncapped offscreen copy, picks a character cut, and
 * appends "… Read more" to the kept prefix. This module owns that decision so
 * it can be tested without a device.
 *
 * Two rules matter for correctness:
 *
 *  1. A measurement "fits" when the whole candidate — body plus the suffix —
 *     occupies at most `collapsedLines` line boxes. It must *not* look for the
 *     suffix in `lines[n].text`: the suffix is a nested `<Text>` and iOS does
 *     not reliably include nested text in the layout event's line text. That
 *     check could never pass, so the cut kept shrinking until only the suffix
 *     remained ("… Read more" with no message in the bubble).
 *  2. Truncation fails open. If the measurements never converge, show the
 *     whole message rather than an empty bubble.
 */

import { COLLAPSED_LINES } from './chat';

/** The inline affordance appended to the kept prefix (mirrors the bubble). */
export const READ_MORE_SUFFIX = '\u2060… Read more';

/** Width budget in points for "… Read more" at the body font size. */
const READ_MORE_WIDTH = 82;

/** Hard ceiling on fit attempts before failing open with the full message. */
export const MAX_TRUNCATION_ATTEMPTS = 24;

/** One visual line from `TextLayoutEvent.nativeEvent.lines`. */
export interface MeasuredLine {
  text: string;
  width: number;
}

/**
 * Collapse phases: measure the uncapped text, then re-fit the cut until the
 * suffix lands inside the clamp. `ready` with `cut: null` means the message is
 * shown in full and never needs the affordance.
 */
export type TruncationPhase =
  | { kind: 'measuring-full' }
  | { kind: 'measuring-candidate'; cut: number; attempts: number }
  | { kind: 'ready'; cut: number | null };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isWhitespace(char: string | undefined): boolean {
  return !!char && /\s/.test(char);
}

/**
 * Walks back from `from` to the last whitespace boundary. A cut that lands
 * inside a word drops that whole word instead of slicing it.
 */
export function trimToWordBoundary(plain: string, from: number): number {
  let cut = clamp(from, 0, plain.length);
  while (cut > 0 && !isWhitespace(plain[cut - 1])) cut--;
  return cut;
}

/**
 * Drops trailing whitespace from the kept prefix so the suffix trails the last
 * word. Without this, a cut at a blank line in a paragraph-heavy message
 * leaves the newlines in the prefix and pushes "… Read more" onto a line of
 * its own — or past the clamp entirely.
 */
export function trimTrailingWhitespace(plain: string, cut: number): number {
  let end = clamp(cut, 0, plain.length);
  while (end > 0 && isWhitespace(plain[end - 1])) end--;
  return end;
}

/**
 * End of the first word — the shortest prefix the collapsed bubble may show.
 * Keeping at least one word guarantees "Read more" never appears alone.
 */
export function minimumVisibleCut(plain: string): number {
  let index = 0;
  while (index < plain.length && isWhitespace(plain[index])) index += 1;
  while (index < plain.length && !isWhitespace(plain[index])) index += 1;
  return index;
}

/**
 * Walks the first `collapsedLines` measured lines back into the source string,
 * returning the character offset just past the last kept line.
 */
export function locateCollapsedCut(
  plain: string,
  lines: ReadonlyArray<MeasuredLine | undefined>,
  collapsedLines = COLLAPSED_LINES,
): number {
  let cursor = 0;
  for (let i = 0; i < collapsedLines; i += 1) {
    const lineText = lines[i]?.text ?? '';
    if (!lineText) {
      // A blank line box consumes exactly one newline in the source.
      cursor = Math.min(plain.length, cursor + 1);
      continue;
    }
    const found = plain.indexOf(lineText, cursor);
    cursor = Math.min(
      plain.length,
      found === -1 ? cursor + lineText.length : found + lineText.length,
    );
  }
  return cursor;
}

function averageCharWidth(line: MeasuredLine | undefined): number {
  if (!line || line.text.length === 0 || line.width <= 0) return 8;
  return line.width / line.text.length;
}

function estimateSuffixChars(line: MeasuredLine | undefined): number {
  return Math.ceil(READ_MORE_WIDTH / Math.max(averageCharWidth(line), 1)) + 2;
}

/**
 * Advances the truncation state from a native layout measurement.
 *
 * `plain` is the message exactly as rendered (mentions and links included).
 */
export function nextTruncationPhase(
  phase: TruncationPhase,
  plain: string,
  lines: ReadonlyArray<MeasuredLine | undefined>,
  collapsedLines = COLLAPSED_LINES,
): TruncationPhase {
  if (!plain.trim()) return { kind: 'ready', cut: null };
  if (phase.kind === 'ready') return phase;

  const minCut = minimumVisibleCut(plain);

  if (phase.kind === 'measuring-full') {
    if (lines.length <= collapsedLines) return { kind: 'ready', cut: null };

    const anchor = locateCollapsedCut(plain, lines, collapsedLines);
    const estimate =
      anchor - estimateSuffixChars(lines[collapsedLines - 1]);
    const cut = Math.max(
      minCut,
      trimTrailingWhitespace(plain, trimToWordBoundary(plain, estimate)),
    );
    if (cut >= plain.length) return { kind: 'ready', cut: null };
    return { kind: 'measuring-candidate', cut, attempts: 1 };
  }

  // The suffix is inside the clamp, so nothing is hidden by the native limit.
  if (lines.length <= collapsedLines) {
    return { kind: 'ready', cut: phase.cut >= plain.length ? null : phase.cut };
  }

  if (phase.attempts >= MAX_TRUNCATION_ATTEMPTS) {
    // Measurements never settled — show the message rather than hide it.
    return { kind: 'ready', cut: null };
  }

  const lastLine = lines[collapsedLines - 1];
  const overflowLine = lines[collapsedLines];
  const avgChar = Math.max(averageCharWidth(lastLine), 1);
  const overflowChars = overflowLine && overflowLine.width > 0
    ? Math.max(1, Math.ceil(overflowLine.width / avgChar))
    : Math.max(1, Math.ceil(estimateSuffixChars(lastLine) / 2));

  const nextCut = Math.max(
    minCut,
    trimTrailingWhitespace(
      plain,
      trimToWordBoundary(plain, phase.cut - overflowChars - 1),
    ),
  );
  // No forward progress (or the shortest allowed prefix still overflows):
  // fail open instead of looping forever or leaving an empty body.
  if (nextCut >= phase.cut) return { kind: 'ready', cut: null };

  return {
    kind: 'measuring-candidate',
    cut: nextCut,
    attempts: phase.attempts + 1,
  };
}
