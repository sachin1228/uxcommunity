/**
 * Pure helpers for the chat @mention feature — no DOM, no network, so the
 * tokenizer / matcher logic is unit-testable with `tsx --test`.
 *
 * Storage contract: a message's text keeps the raw `@Name` token (so copy,
 * search, moderation, sidebar previews and the mobile client see plain text),
 * while `community_messages.mentions` stores `{ user_id, name }[]` for the
 * members actually mentioned (authoritative at send time). Rendering and
 * send-time resolution both scan the text against those records.
 */

export interface MessageMention {
  user_id: string;
  name: string;
}

/** A member shown in the @-autocomplete popover (members API row shape). */
export interface MentionCandidate {
  user_id: string;
  name: string;
  avatar_url: string | null;
  designation?: string | null;
  role?: string;
}

export const MENTION_MAX_PER_MESSAGE = 20;

const WORD_RE = /[\p{L}\p{N}_]/u;

function isWordChar(char: string | undefined): boolean {
  if (!char) return false;
  return WORD_RE.test(char);
}

/** A mention token must start at a word boundary (start of text or after a
 * non-word character) — so `foo@Sara` is an email/username, not a mention. */
function mentionBoundaryBefore(text: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = text[index - 1];
  return prev !== "@" && !isWordChar(prev);
}

/** After the name, the next character must not extend the name (letters,
 * numbers, underscore). Punctuation like `,`/`.`/`!` terminates it. */
function mentionBoundaryAfter(text: string, index: number): boolean {
  if (index >= text.length) return true;
  return !isWordChar(text[index]);
}

/**
 * Detects the `@query` token currently being typed under the caret.
 *
 * Returns the token start (index of `@`) and the query text typed so far, or
 * null when the caret is not directly at the end of an `@`-token. The composer
 * shows its suggestion popover only while this returns a value.
 *
 * Query characters are word characters plus `. _ ' -` (names like "Priya.K" or
 * "Anne-Marie"); whitespace ends the token — picking a candidate from the
 * popover is what inserts multi-word names.
 */
export function detectMentionTrigger(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  if (caret < 0) caret = 0;
  if (caret > text.length) caret = text.length;
  const before = text.slice(0, caret);
  // The '@' must sit at a word boundary (start of text or after a non-word
  // character) — "foo@bar" is an email/username, not a mention.
  // \p{M} includes combining marks (Devanagari matras, virama, …) so names
  // like प्रिया — where matras are separate codepoints — stay in one token.
  const m =
    /(?:^|([^@\p{L}\p{M}\p{N}_]))@([\p{L}\p{M}\p{N}._'-]*)$/u.exec(before);
  if (!m) return null;
  const start = m.index + (m[1] ? m[1].length : 0);
  return { start, query: m[2] ?? "" };
}

/**
 * Case-insensitive scan for the first occurrence of `needle` ("@Name") that
 * sits on mention boundaries. Returns the index or -1.
 */
export function findMentionOccurrence(
  text: string,
  needle: string,
  from = 0,
): number {
  if (!needle || needle.length < 2) return -1; // "@" alone never matches
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let index = lowerText.indexOf(lowerNeedle, from);
  while (index !== -1) {
    if (
      mentionBoundaryBefore(text, index) &&
      mentionBoundaryAfter(text, index + needle.length)
    ) {
      return index;
    }
    index = lowerText.indexOf(lowerNeedle, index + 1);
  }
  return -1;
}

/**
 * Given the final message text and the mentions the composer *registered*
 * (only those picked from the autocomplete popover), returns the mentions that
 * are still present verbatim. Deleting an inserted mention drops it; typing an
 * `@Name` by hand that was never picked never registers a mention.
 */
export function resolveMentionsFromText(
  content: string,
  registry: Iterable<MessageMention>,
): MessageMention[] {
  const resolved: MessageMention[] = [];
  const seen = new Set<string>();
  for (const mention of registry) {
    if (!mention?.user_id || !mention?.name || seen.has(mention.user_id)) {
      continue;
    }
    if (findMentionOccurrence(content, `@${mention.name}`) !== -1) {
      seen.add(mention.user_id);
      resolved.push(mention);
    }
  }
  return resolved;
}

export interface MentionSegment {
  text: string;
  mention: MessageMention | null;
}

/**
 * Splits message content into plain-text segments and mention segments, so
 * renderers can turn exactly the stored mentions into highlighted chips while
 * leaving the raw text untouched for everything else. Matching is
 * case-insensitive; longer names win when names share a prefix.
 */
export function splitContentByMentions(
  content: string,
  mentions: ReadonlyArray<MessageMention>,
): MentionSegment[] {
  const candidates: MessageMention[] = [];
  const seen = new Set<string>();
  for (const mention of mentions) {
    if (!mention?.user_id || !mention?.name) continue;
    if (seen.has(mention.user_id)) continue;
    seen.add(mention.user_id);
    candidates.push(mention);
  }
  candidates.sort((a, b) => b.name.length - a.name.length);
  if (candidates.length === 0) return content ? [{ text: content, mention: null }] : [];

  const segments: MentionSegment[] = [];
  let index = 0;
  while (index < content.length) {
    if (content[index] === "@" && mentionBoundaryBefore(content, index)) {
      let matched: MessageMention | null = null;
      for (const candidate of candidates) {
        const end = index + 1 + candidate.name.length;
        if (
          end <= content.length &&
          content.slice(index + 1, end).toLowerCase() ===
            candidate.name.toLowerCase() &&
          mentionBoundaryAfter(content, end)
        ) {
          matched = candidate;
          break;
        }
      }
      if (matched) {
        const end = index + 1 + matched.name.length;
        segments.push({ text: content.slice(index, end), mention: matched });
        index = end;
        continue;
      }
    }
    // Plain-text run: consume up to the next plausible '@' anchor.
    const start = index;
    index += 1;
    while (index < content.length) {
      if (content[index] === "@" && mentionBoundaryBefore(content, index)) break;
      index += 1;
    }
    segments.push({ text: content.slice(start, index), mention: null });
  }
  return segments;
}
