/**
 * Shared chat helpers — a React Native port of the web chat modules:
 *
 *   apps/web/components/communities/chat/chatUtils.ts   (fmtTime, fmtDate, MAX_MESSAGE_CHARS, pickOptimisticMatch)
 *   apps/web/lib/communities/user-color.ts              (userColorIndex, userColorVar — ported here as userNameColor)
 *   apps/web/lib/communities/message-edit.ts            (canEditMessage, MESSAGE_EDIT_WINDOW_MS)
 *   apps/web/lib/communities/mentions.ts                (MessageMention, splitContentByMentions)
 *
 * Kept dependency-free and pure so the rendering rules match the web app
 * byte-for-byte: the same message reads identically on both clients.
 */

// ─── Limits ───────────────────────────────────────────────────────────────

/** Maximum characters allowed in a chat message — the composer hard limit. */
export const MAX_MESSAGE_CHARS = 500;

/** How long after sending a message may still be edited (web parity). */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Number of lines shown before a long message collapses behind "Read more". */
export const COLLAPSED_LINES = 5;

// Locale shared with the community list timestamps so the same message never
// reads differently in the chat and in the sidebar.
const TIME_LOCALE = 'en-US';
const DATE_LOCALE = 'en-US';

// ─── Time formatting ──────────────────────────────────────────────────────

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(TIME_LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(DATE_LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Per-user name colors ─────────────────────────────────────────────────

/** How many name colors rotate through. Keep in sync with constants/colors.ts. */
export const USER_NAME_COLOR_COUNT = 7;

/**
 * FNV-1a hash — tiny, fast, and deterministic across every device.
 * Returns an unsigned 32-bit integer.
 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Stable 0–6 palette index for a user id. Same id → same index, always.
 * Falls back to 0 when no id is available (e.g. deleted users).
 */
export function userColorIndex(userId: string | null | undefined): number {
  if (!userId) return 0;
  return fnv1a(userId) % USER_NAME_COLOR_COUNT;
}

/**
 * Resolves a user's sender-name color from the active palette.
 * Falls back to the neutral muted foreground when no id is available.
 */
export function userNameColor(
  userId: string | null | undefined,
  palette: { chatNameColors: string[]; chatNameFallback: string },
): string {
  if (!userId) return palette.chatNameFallback;
  return palette.chatNameColors[userColorIndex(userId)] ?? palette.chatNameFallback;
}

// ─── Emoji detection ──────────────────────────────────────────────────────

/**
 * Matches a full emoji grapheme cluster (base + skin tone + keycap + ZWJ
 * sequences + variation selectors). Same pattern the web app uses so the
 * composer and the rendered bubble agree on what "one emoji" is.
 */
export const EMOJI_CLUSTER =
  /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\u20E3)?(?:\uFE0F)?(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\uFE0F)?)*[\uFE0F\uFE0E]?/gu;

/**
 * Returns true when the entire message text is 1–3 emoji with no other
 * content — those render as one large bubble-free glyph, WhatsApp-style.
 */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const clusters = [...trimmed.matchAll(EMOJI_CLUSTER)];
  if (clusters.length === 0 || clusters.length > 3) return false;

  // After stripping matched clusters and whitespace, nothing should be left.
  const remainder = trimmed.replace(EMOJI_CLUSTER, '').replace(/\s/g, '');
  return remainder.length === 0;
}

// ─── Message editing ──────────────────────────────────────────────────────

export function canEditMessage(createdAt: string, now = Date.now()): boolean {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return false;

  const elapsed = now - createdAtMs;
  return elapsed >= 0 && elapsed <= MESSAGE_EDIT_WINDOW_MS;
}

// ─── Links ────────────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>"'()[\]{}]+/gi;

/** First URL in a string, or null. Matches the web `extractFirstUrl` intent. */
export function extractFirstUrl(text: string): string | null {
  URL_RE.lastIndex = 0;
  const match = URL_RE.exec(text);
  if (!match) return null;
  return match[0].replace(/[.,;:!?)]+$/, '');
}

/**
 * Splits message text into plain runs and URL runs so links can be tinted and
 * made tappable inside a bubble.
 */
export type ContentRun =
  | { kind: 'text'; text: string }
  | { kind: 'url'; text: string; url: string }
  | { kind: 'mention'; text: string };

// ─── @mentions ────────────────────────────────────────────────────────────

export interface MessageMention {
  user_id: string;
  name: string;
}

/** A member shown in the @-autocomplete list (members API row shape). */
export interface MentionCandidate {
  user_id: string;
  name: string;
  avatar_url: string | null;
  designation?: string | null;
  role?: string;
}

/** Server-side cap on mentions per message — keep the composer honest. */
export const MENTION_MAX_PER_MESSAGE = 20;

const WORD_RE = /[\p{L}\p{N}_]/u;

function isWordChar(char: string | undefined): boolean {
  if (!char) return false;
  return WORD_RE.test(char);
}

/** A mention token must start at a word boundary — `foo@Sara` is not a mention. */
function mentionBoundaryBefore(text: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = text[index - 1];
  return prev !== '@' && !isWordChar(prev);
}

/** After the name, the next character must not extend the name. */
function mentionBoundaryAfter(text: string, index: number): boolean {
  if (index >= text.length) return true;
  return !isWordChar(text[index]);
}

/**
 * Detects the `@query` token currently being typed under the caret.
 *
 * Returns the token start (index of `@`) and the query typed so far, or null
 * when the caret is not directly at the end of an `@`-token. Query characters
 * are word characters plus `. _ ' -` (names like "Priya.K" or "Anne-Marie");
 * whitespace ends the token — picking a candidate inserts multi-word names.
 */
export function detectMentionTrigger(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  let c = caret;
  if (c < 0) c = 0;
  if (c > text.length) c = text.length;
  const before = text.slice(0, c);
  // The '@' must sit at a word boundary (start of text or after a non-word
  // character) — "foo@bar" is an email/username, not a mention.
  const m = /(?:^|([^@\p{L}\p{M}\p{N}_]))@([\p{L}\p{M}\p{N}._'-]*)$/u.exec(before);
  if (!m) return null;
  const start = m.index + (m[1] ? m[1].length : 0);
  return { start, query: m[2] ?? '' };
}

/**
 * Case-insensitive scan for the first occurrence of `needle` ("@Name") that
 * sits on mention boundaries. Returns the index or -1.
 */
export function findMentionOccurrence(text: string, needle: string, from = 0): number {
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
 * (only those picked from the autocomplete list), returns the mentions still
 * present verbatim. Deleting an inserted mention drops it; typing an `@Name`
 * by hand that was never picked never registers a mention.
 */
export function resolveMentionsFromText(
  content: string,
  registry: Iterable<MessageMention>,
): MessageMention[] {
  const resolved: MessageMention[] = [];
  const seen = new Set<string>();
  for (const mention of registry) {
    if (!mention?.user_id || !mention?.name || seen.has(mention.user_id)) continue;
    if (findMentionOccurrence(content, `@${mention.name.trim()}`) !== -1) {
      seen.add(mention.user_id);
      resolved.push({ ...mention, name: mention.name.trim() });
    }
  }
  return resolved;
}

/**
 * Cuts a message body into text runs and mention runs.
 *
 * Mentions are matched against the raw text (longest name wins), so exactly
 * the stored mentions become highlighted and everything else — including
 * hand-typed @words that were never picked — stays plain text.
 */
export function splitContentByMentions(
  content: string,
  mentions: ReadonlyArray<MessageMention> | null | undefined,
): ContentRun[] {
  const candidates: MessageMention[] = [];
  const seen = new Set<string>();
  for (const mention of mentions ?? []) {
    const name = mention?.name?.trim();
    if (!mention?.user_id || !name) continue;
    if (seen.has(mention.user_id)) continue;
    seen.add(mention.user_id);
    candidates.push({ ...mention, name });
  }
  candidates.sort((a, b) => b.name.length - a.name.length);
  if (candidates.length === 0) return content ? [{ kind: 'text', text: content }] : [];

  const segments: ContentRun[] = [];
  let index = 0;
  while (index < content.length) {
    if (content[index] === '@' && mentionBoundaryBefore(content, index)) {
      let matched: MessageMention | null = null;
      for (const candidate of candidates) {
        const end = index + 1 + candidate.name.length;
        if (
          end <= content.length &&
          content.slice(index + 1, end).toLowerCase() === candidate.name.toLowerCase() &&
          mentionBoundaryAfter(content, end)
        ) {
          matched = candidate;
          break;
        }
      }
      if (matched) {
        const end = index + 1 + matched.name.length;
        segments.push({ kind: 'mention', text: content.slice(index, end) });
        // Collapse duplicate spaces right after the mention; spaces before a
        // newline (or the end of the text) are dropped entirely.
        let after = end;
        while (after < content.length && content[after] === ' ') after += 1;
        if (after > end) {
          const next = content[after];
          index = next === undefined || next === '\n' || next === '\r' ? after : after - 1;
        } else {
          index = end;
        }
        continue;
      }
    }
    const start = index;
    index += 1;
    while (index < content.length) {
      if (content[index] === '@' && mentionBoundaryBefore(content, index)) break;
      index += 1;
    }
    segments.push({ kind: 'text', text: content.slice(start, index) });
  }
  return segments;
}

/**
 * Merges mention segmentation with URL detection so a bubble can tint both
 * in one pass: mentions win over URLs (a URL inside a mention name is
 * impossible, but a mention inside a URL would otherwise swallow link text).
 */
export function splitContentForRender(
  content: string,
  mentions: ReadonlyArray<MessageMention> | null | undefined,
): ContentRun[] {
  const base = splitContentByMentions(content, mentions);
  const out: ContentRun[] = [];

  for (const segment of base) {
    if (segment.kind === 'mention') {
      out.push(segment);
      continue;
    }
    let last = 0;
    URL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_RE.exec(segment.text)) !== null) {
      const url = match[0].replace(/[.,;:!?)]+$/, '');
      if (match.index > last) {
        out.push({ kind: 'text', text: segment.text.slice(last, match.index) });
      }
      out.push({ kind: 'url', text: url, url });
      last = match.index + match[0].length;
    }
    if (last < segment.text.length) {
      out.push({ kind: 'text', text: segment.text.slice(last) });
    }
  }
  return out;
}

// ─── Message reactions ────────────────────────────────────────────────────
//
// Port of apps/web/lib/communities/cache.ts `applyReactionInsert` /
// `applyReactionDelete`. The reaction API takes an explicit *desired* emoji
// (`null` clears it) rather than a toggle, so the client has to project the
// intent locally — that projection is what makes a tap feel instant on mobile.

export type ReactionIntent = string | null;

/** One emoji on a message/comment plus everyone who picked it. */
export interface Reaction {
  emoji: string;
  user_ids: string[];
}

/** The emoji the current user has on a message, or null. */
export function myReactionEmoji(
  reactions: readonly Reaction[],
  userId: string,
): ReactionIntent {
  if (!userId) return null;
  return reactions.find((reaction) => reaction.user_ids.includes(userId))?.emoji ?? null;
}

/** Adds `userId` to `emoji`, removing them from whatever they had before. */
export function applyReactionInsert(
  reactions: readonly Reaction[],
  emoji: string,
  userId: string,
): Reaction[] {
  const without = reactions
    .map((reaction) => ({
      ...reaction,
      user_ids: reaction.user_ids.filter((id) => id !== userId),
    }))
    .filter((reaction) => reaction.user_ids.length > 0);

  const existing = without.find((reaction) => reaction.emoji === emoji);
  if (existing) {
    return without.map((reaction) =>
      reaction.emoji === emoji
        ? { ...reaction, user_ids: [...reaction.user_ids, userId] }
        : reaction,
    );
  }
  return [...without, { emoji, user_ids: [userId] }];
}

/** Removes `userId` from `emoji`, dropping the pill when it empties. */
export function applyReactionDelete(
  reactions: readonly Reaction[],
  emoji: string,
  userId: string,
): Reaction[] {
  return reactions
    .map((reaction) =>
      reaction.emoji === emoji
        ? { ...reaction, user_ids: reaction.user_ids.filter((id) => id !== userId) }
        : reaction,
    )
    .filter((reaction) => reaction.user_ids.length > 0);
}

/**
 * Applies `desired` as the viewer's reaction, leaving everyone else's in place.
 * This is the state the bubble should show the instant the user taps.
 */
export function projectOwnReaction(
  reactions: readonly Reaction[],
  desired: ReactionIntent,
  userId: string,
): Reaction[] {
  const current = myReactionEmoji(reactions, userId);
  const withoutCurrent = current ? applyReactionDelete(reactions, current, userId) : [...reactions];
  return desired ? applyReactionInsert(withoutCurrent, desired, userId) : withoutCurrent;
}

/**
 * Resolves the emoji a tap should produce: tapping your own reaction removes it,
 * any other tap replaces it (WhatsApp/iMessage behaviour, same as the web app).
 */
export function nextReactionIntent(current: ReactionIntent, tapped: string): ReactionIntent {
  return current === tapped ? null : tapped;
}

// ─── Optimistic sends ─────────────────────────────────────────────────────

export interface OptimisticLike {
  id: string;
  user_id: string;
  content: string | null;
  status?: 'sending' | 'sent' | 'failed';
}

/**
 * Picks which optimistic bubble an incoming realtime echo replaces.
 *
 * Several sends can be in flight at once, so their echoes can interleave — an
 * echo must land on the bubble it belongs to, otherwise the confirmed row
 * inherits another bubble's local-only fields and one message looks like it
 * duplicated. Text is the strongest signal available, so an exact content
 * match wins, and the sender's oldest in-flight bubble is the fallback
 * (image/GIF sends carry no text).
 */
export function pickOptimisticMatch<T extends OptimisticLike>(
  messages: readonly T[],
  incoming: { user_id: string; content: string | null },
): T | null {
  const inFlight = messages.filter(
    (m) => m.id.startsWith('temp-') && m.user_id === incoming.user_id && m.status === 'sending',
  );

  return (
    inFlight.find((m) => (m.content ?? '') === (incoming.content ?? '')) ?? inFlight[0] ?? null
  );
}
