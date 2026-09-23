/**
 * Pure tokenizer for rendering `@mention` highlighting in community comments —
 * no DOM, no network, so the split is unit-testable with `tsx --test`.
 *
 * Comments, unlike chat messages, store no mention records: the only mentions
 * the app itself writes are the `@Name ` seeds the inline reply composer puts
 * in front of a reply (see `replyMention` in CommentSection). So highlighting
 * takes two passes:
 *
 *  1. names we actually know — the authors participating in this comment
 *     section — matched longest-first by the same `splitContentByMentions`
 *     matcher the chat bubbles use, which covers multi-word names
 *     ("@Vishal Gn") and leaves `foo@bar`-style text alone;
 *  2. every remaining bare `@token`, so a hand-typed mention of someone who
 *     never commented (or a community handle like "@ux community") still reads
 *     as a tag — the same single-token rule social feeds use.
 *
 * Rendering only: the stored body keeps the raw text either way.
 */

import { splitContentByMentions, type MessageMention } from "./mentions";

export interface CommentTextSegment {
  text: string;
  mention: boolean;
}

/** Characters that continue a name token — letters, combining marks (Devanagari
 *  matras, virama, …), digits, and the punctuation names actually use. */
const NAME_CHAR = /[\p{L}\p{M}\p{N}._'-]/u;

/** `@` + a name token. Whitespace, so `@Vishal Gn` matches only `@Vishal` —
 *  the known-name pass above is what spans the full multi-word name. */
const MENTION_TOKEN = /@[\p{L}\p{M}\p{N}._'-]+/gu;

function isWordChar(char: string | undefined): boolean {
  return typeof char === "string" && NAME_CHAR.test(char);
}

/** A mention must start at a word boundary, so `mail me@x` is not a mention. */
function tokenStartsMention(text: string, at: number): boolean {
  if (text[at] !== "@") return false;
  const before = at > 0 ? text[at - 1] : undefined;
  return before !== "@" && !isWordChar(before);
}

/** Appends `chunk`, cutting out every bare `@token` as a mention segment. */
function pushPlainWithTokens(
  segments: CommentTextSegment[],
  chunk: string,
): void {
  MENTION_TOKEN.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_TOKEN.exec(chunk)) !== null) {
    if (!tokenStartsMention(chunk, match.index)) continue;
    if (match.index > last) {
      segments.push({ text: chunk.slice(last, match.index), mention: false });
    }
    segments.push({ text: match[0], mention: true });
    last = match.index + match[0].length;
  }
  if (last < chunk.length) {
    segments.push({ text: chunk.slice(last), mention: false });
  }
}

/**
 * Splits `content` into plain-text and mention segments. `knownNames` are the
 * full display names to highlight across spaces (longest wins).
 */
export function splitCommentText(
  content: string,
  knownNames: readonly string[] = [],
): CommentTextSegment[] {
  if (!content) return [];

  const names: string[] = [];
  const seen = new Set<string>();
  for (const raw of knownNames) {
    const name = raw?.trim();
    if (!name || name.length < 2 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }

  const records: MessageMention[] = names.map((name, index) => ({
    user_id: `known-${index}`,
    name,
  }));

  const base = records.length
    ? splitContentByMentions(content, records)
    : [{ text: content, mention: null }];

  const segments: CommentTextSegment[] = [];
  for (const segment of base) {
    if (segment.mention) {
      segments.push({ text: segment.text, mention: true });
      continue;
    }
    pushPlainWithTokens(segments, segment.text);
  }
  return segments;
}
