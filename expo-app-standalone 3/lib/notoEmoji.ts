/**
 * Noto emoji assets and helpers — the React Native counterpart of the web
 * `lib/noto-emoji.ts` and the emoji-cluster helpers in `lib/chat.ts`.
 *
 * The assets are self-hosted by the web app (vendored Noto SVGs and Lottie
 * JSON, see apps/web/public/emoji), so the mobile app reads the same files
 * over the API origin. Nothing here is fetched until an emoji is actually on
 * screen — see components/chat/AnimatedEmoji.tsx.
 */

import { EMOJI_CLUSTER } from './chat';

/** API origin that serves /emoji/... (mirrors lib/api.ts). */
const ASSET_BASE = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

/** Variation selector-16 — present in many emoji, absent from Noto asset names. */
const VS16 = 'fe0f';

/** Remove every fe0f part from a "_"-joined codepoint key. */
export function stripVS16(codepoint: string): string {
  return codepoint.split('_').filter((part) => part !== VS16).join('_');
}

/**
 * Convert an emoji character or full sequence to the Noto asset key:
 *   "❤️‍🔥" -> "2764_200d_1f525"
 *   "👍🏽"  -> "1f44d_1f3fd"
 */
export function emojiToCodepoint(emoji: string): string | null {
  const parts: string[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (!cp) continue;
    const hex = cp.toString(16).toLowerCase();
    if (hex === VS16) continue;
    parts.push(hex);
  }
  return parts.length ? parts.join('_') : null;
}

/** Static SVG for a codepoint (Noto filenames never include fe0f). */
export function svgUrlForCodepoint(codepoint: string): string {
  return `${ASSET_BASE}/emoji/svg/emoji_u${stripVS16(codepoint)}.svg`;
}

/** Lottie JSON for a codepoint. */
export function lottieUrlForCodepoint(codepoint: string): string {
  return `${ASSET_BASE}/emoji/lottie/${stripVS16(codepoint)}.json`;
}

export interface EmojiTextRun {
  kind: 'text' | 'emoji';
  text: string;
}

/**
 * Splits text into plain-text and emoji-cluster runs, so each glyph can be
 * rendered by its own component inside a `<Text>`.
 */
export function splitTextEmojiRuns(text: string): EmojiTextRun[] {
  const runs: EmojiTextRun[] = [];
  let last = 0;
  EMOJI_CLUSTER.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = EMOJI_CLUSTER.exec(text)) !== null) {
    if (match.index > last) {
      runs.push({ kind: 'text', text: text.slice(last, match.index) });
    }
    runs.push({ kind: 'emoji', text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ kind: 'text', text: text.slice(last) });
  return runs;
}

// ─── Lottie animation data ─────────────────────────────────────────────────

const lottieCache = new Map<string, unknown>();
const lottieInflight = new Map<string, Promise<unknown | null>>();
const lottieFailed = new Set<string>();

/** Cached animation data, if this codepoint was already fetched. */
export function cachedLottie(codepoint: string): unknown | null {
  return lottieCache.get(stripVS16(codepoint)) ?? null;
}

/**
 * Fetches one emoji's Lottie JSON. Concurrent callers share a single request,
 * successful data is kept for the session, and failures are remembered so a
 * missing asset never retries on every render.
 */
export async function loadLottie(codepoint: string): Promise<unknown | null> {
  const key = stripVS16(codepoint);
  if (lottieCache.has(key)) return lottieCache.get(key) ?? null;
  if (lottieFailed.has(key)) return null;

  const pending = lottieInflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await fetch(lottieUrlForCodepoint(key));
      if (!response.ok) {
        lottieFailed.add(key);
        return null;
      }
      const json = await response.json();
      lottieCache.set(key, json);
      return json;
    } catch {
      lottieFailed.add(key);
      return null;
    } finally {
      lottieInflight.delete(key);
    }
  })();

  lottieInflight.set(key, request);
  return request;
}
