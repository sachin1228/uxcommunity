/**
 * Pure tokenizer for rendering `@mention` highlighting in community comments —
 * the React Native port of the web `lib/communities/comment-text.ts`.
 *
 * Comments, unlike chat messages, store no mention records: the only mentions
 * the app itself writes are the `@Name ` seeds the reply composer puts in front
 * of a reply (see `replyMention` in CommentsSheet). So highlighting takes two
 * passes:
 *
 *  1. names we actually know — the authors participating in this comment
 *     section — matched longest-first, which covers multi-word names
 *     ("@ux community") and leaves `foo@bar`-style text alone;
 *  2. every remaining bare `@token`, so a hand-typed mention of someone who
 *     never commented still reads as a tag.
 *
 * Rendering only: the stored body keeps the raw text either way.
 *
 * The name-character class is written without Unicode property escapes on
 * purpose — Hermes does not support them on every build RN targets.
 */

export interface CommentTextSegment {
  text: string;
  mention: boolean;
}

/** `@` plus a run of non-space characters; trailing punctuation is peeled off. */
const MENTION_TOKEN = /@[^\s@]+/g;

/** Sentence punctuation that ends a mention rather than belonging to it. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}"'”’…]+$/;

/**
 * Characters that continue a name: anything that is not whitespace, not a
 * second `@`, and not sentence punctuation. Deliberately script-agnostic so
 * Devanagari and accented names tokenize the same way Latin ones do.
 */
const NAME_CHAR = /[^\s@,;:!?()[\]{}<>/\\|"'`~+=*&^%$#]/;

/** A mention must start at a word boundary, so `mail me@x` is not a mention. */
function startsMention(text: string, at: number): boolean {
  if (text[at] !== '@') return false;
  const before = at > 0 ? text[at - 1] : undefined;
  return before !== '@' && !(typeof before === 'string' && NAME_CHAR.test(before));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Splits a plain chunk, cutting out every bare `@token` as a mention. */
function pushPlain(segments: CommentTextSegment[], chunk: string): void {
  if (!chunk) return;
  MENTION_TOKEN.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_TOKEN.exec(chunk)) !== null) {
    if (!startsMention(chunk, match.index)) continue;
    const token = match[0].replace(TRAILING_PUNCTUATION, '');
    if (match.index > last) {
      segments.push({ text: chunk.slice(last, match.index), mention: false });
    }
    segments.push({ text: token, mention: true });
    last = match.index + token.length;
  }
  if (last < chunk.length) segments.push({ text: chunk.slice(last), mention: false });
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

  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of knownNames) {
    const name = raw?.trim();
    if (!name || name.length < 2 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  names.sort((a, b) => b.length - a.length);

  const pattern = names.length
    ? new RegExp(`@(?:${names.map(escapeRegExp).join('|')})`, 'gi')
    : null;

  const segments: CommentTextSegment[] = [];
  let last = 0;
  if (pattern) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      if (!startsMention(content, match.index)) continue;
      if (match.index > last) pushPlain(segments, content.slice(last, match.index));
      segments.push({ text: match[0], mention: true });
      last = match.index + match[0].length;
    }
  }
  if (last < content.length) pushPlain(segments, content.slice(last));
  return segments;
}

/**
 * Every author name present in a comment section — the candidates the
 * highlighter matches against, so a seeded multi-word name is painted whole.
 */
export function commentParticipantNames(
  comments: readonly { users?: { name?: string | null } | null; replies?: readonly unknown[] }[],
): string[] {
  const names = new Set<string>();
  const visit = (list: readonly { users?: { name?: string | null } | null; replies?: readonly unknown[] }[]) => {
    for (const comment of list) {
      const name = comment.users?.name?.trim();
      if (name) names.add(name);
      const replies = comment.replies as
        | readonly { users?: { name?: string | null } | null; replies?: readonly unknown[] }[]
        | undefined;
      if (replies?.length) visit(replies);
    }
  };
  visit(comments);
  return [...names];
}
