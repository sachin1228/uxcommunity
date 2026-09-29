"use client";

import { Fragment, useId, useMemo, useState, useRef, useEffect } from "react";
import TruncateMarkup from "react-truncate-markup";
import type { MessageMention } from "@/lib/communities/cache";
import { extractFirstUrl } from "@/lib/communities/linkPreview";
import { splitContentByMentions } from "@/lib/communities/mentions";
import { AnimatedEmoji } from "./AnimatedEmoji";
import { LinkPreview } from "./LinkPreview";

/**
 * Splits a plain text chunk into alternating text/emoji nodes so emoji
 * glyphs can be rendered at a larger size than the surrounding text,
 * matching WhatsApp's mixed-content style.
 */
function renderTextWithEmoji(text: string, key: string | number): React.ReactNode {
  const EMOJI_CLUSTER =
    /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\u20E3)?(?:\uFE0F)?(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\uFE0F)?)*[\uFE0F\uFE0E]?/gu;

  const segments: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  EMOJI_CLUSTER.lastIndex = 0;

  while ((m = EMOJI_CLUSTER.exec(text)) !== null) {
    if (m.index > last) segments.push(text.slice(last, m.index));
    segments.push(
      <TruncateMarkup.Atom key={`e-${m.index}`}>
        <AnimatedEmoji
          emoji={m[0]}
          size={20}
          className="inline-block align-middle mx-0.5"
        />
      </TruncateMarkup.Atom>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push(text.slice(last));

  // If no emoji was found just return the string (avoids wrapping in a Fragment).
  if (segments.length === 1 && typeof segments[0] === "string") return segments[0];
  return <Fragment key={key}>{segments}</Fragment>;
}

/**
 * Renders message text with URLs converted to clickable anchors and emoji
 * glyphs enlarged to WhatsApp-style proportions.
 * Shows a WhatsApp-style link-preview card for the first URL found.
 * Only rendered for non-deleted, non-pending messages.
 */
/** Linkifies URLs and enlarges emoji inside a single whitespace-free chunk. */
function renderRichChunk(chunk: string, isMe: boolean, keyBase: number): React.ReactNode[] {
  const URL_RE = /https?:\/\/[^\s<>"'()[\]{}]+/gi;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(chunk)) !== null) {
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    if (m.index > last) parts.push(renderTextWithEmoji(chunk.slice(last, m.index), keyBase + last));
    parts.push(
      <a
        key={keyBase + m.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`underline underline-offset-2 break-all ${
          isMe ? "text-accent-foreground opacity-90 hover:opacity-100" : "text-foreground hover:opacity-80"
        }`}
      >
        {url}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < chunk.length) parts.push(renderTextWithEmoji(chunk.slice(last), keyBase + last));
  return parts;
}

/** Highlighted `@Name` mention inside a message bubble — blue text, no chip bg.
 *  On the sender's own blue bubble a light blue keeps it readable. */
function MentionChip({ text, isMe }: { text: string; isMe: boolean }) {
  return (
    <span
      className="inline-block max-w-full break-normal font-semibold"
      style={{ color: isMe ? "var(--chat-mention-own)" : "var(--ds-blue-700)" }}
    >
      {text}</span>
  );
}

/** Number of lines shown before a long message collapses behind "Read more". */
const COLLAPSED_LINES = 5;

export function MessageContent({
  content,
  mentions,
  isMe,
  showPreview,
  animate = false,
}: {
  content: string;
  mentions: MessageMention[];
  isMe: boolean;
  showPreview: boolean;
  /** When true, each word rises into place with a staggered delay. */
  animate?: boolean;
}) {
  const previewUrl = showPreview ? extractFirstUrl(content) : null;
  const [collapsed, setCollapsed] = useState(true);
  const textId = useId();
  const textRef = useRef<HTMLDivElement>(null);
  const [fontRevision, setFontRevision] = useState(0);

  // Width changes are handled by TruncateMarkup's ResizeObserver. Font swaps
  // can change wrapping without changing that width, so remeasure those too.
  useEffect(() => {
    const remeasure = () => setFontRevision((revision) => revision + 1);
    document.fonts.addEventListener("loadingdone", remeasure);
    return () => document.fonts.removeEventListener("loadingdone", remeasure);
  }, []);

  // Mentions are matched against the raw text first (longest name wins), so
  // exactly the stored mentions become chips and everything else — including
  // hand-typed @words that were never picked — renders as plain text.
  const segments = useMemo(
    () => splitContentByMentions(content, mentions ?? []),
    [content, mentions],
  );

  let parts: React.ReactNode[];
  // Number of words in the animated wave — used to delay the "Read more"
  // button until after the last word has risen into place.
  let animateWordCount = 0;

  if (animate) {
    // Split each plain-text segment on whitespace (keeping the whitespace so
    // pre-wrap newlines survive) and wrap every word in a span that carries
    // its stagger index. Mention chips are whole tokens with a single index.
    let wordIdx = 0;
    let keyIdx = 0;
    parts = [];
    for (const segment of segments) {
      if (segment.mention) {
        const i = wordIdx++;
        const key = keyIdx++;
        parts.push(
          <span
            key={key}
            className="chat-word-in"
            style={{ "--i": i } as React.CSSProperties}
          >
            <TruncateMarkup.Atom>
              <MentionChip text={segment.text} isMe={isMe} />
            </TruncateMarkup.Atom>
          </span>,
        );
        continue;
      }
      const tokens = segment.text.split(/(\s+)/);
      for (const tok of tokens) {
        const key = keyIdx++;
        if (!tok) continue;
        if (/^\s+$/.test(tok)) {
          parts.push(tok);
          continue;
        }
        const i = wordIdx++;
        parts.push(
          <span
            key={key}
            className="chat-word-in"
            style={{ "--i": i } as React.CSSProperties}
          >
            {renderRichChunk(tok, isMe, key)}
          </span>,
        );
      }
    }
    animateWordCount = wordIdx;
  } else {
    parts = [];
    let keyIdx = 0;
    for (const segment of segments) {
      if (segment.mention) {
        parts.push(
          <TruncateMarkup.Atom key={keyIdx++}>
            <MentionChip text={segment.text} isMe={isMe} />
          </TruncateMarkup.Atom>,
        );
      } else if (segment.text) {
        parts.push(...renderRichChunk(segment.text, isMe, keyIdx));
        keyIdx += segment.text.length;
      }
    }
  }

  const text = (
    <div
      id={textId}
      data-collapsed={collapsed || undefined}
      ref={textRef}
      tabIndex={-1}
      className={`chat-message-text font-body text-sm font-normal leading-6 whitespace-pre-wrap break-words select-text cursor-text outline-none ${
        isMe ? "text-accent-foreground" : "text-foreground"
      }`}
    >
      <span style={{ display: "inline" }}>{parts}</span>
    </div>
  );

  return (
    <>
      {/* Once expanded a message stays fully open — there is no collapse back. */}
      {collapsed ? (
        <TruncateMarkup
          key={fontRevision}
          lines={COLLAPSED_LINES}
          ellipsis={
            <span className="whitespace-nowrap">
              {"\u2060… "}
              <button
                type="button"
                aria-expanded={false}
                aria-controls={textId}
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsed(false);
                  requestAnimationFrame(() => textRef.current?.focus({ preventScroll: true }));
                }}
                className={`inline align-baseline font-body text-sm font-medium transition-colors rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  animate ? "chat-read-more-in" : ""
                } ${
                  isMe
                    ? "text-accent-foreground/70 hover:text-accent-foreground"
                    : "text-foreground-muted hover:text-foreground"
                }`}
                style={animate ? ({ "--i": Math.min(animateWordCount, 24) } as React.CSSProperties) : undefined}
              >
                Read more
              </button>
            </span>
          }
        >
          {text}
        </TruncateMarkup>
      ) : text}
      {previewUrl && <LinkPreview url={previewUrl} isMe={isMe} />}
    </>
  );
}

/**
 * Returns true when the entire message text is 1–3 emoji with no other content.
 * Handles ZWJ sequences, skin-tone modifiers, variation selectors, and keycap combiners.
 */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Each "cluster" is one rendered emoji glyph, including ZWJ chains like 👨‍👩‍👧.
  const EMOJI_CLUSTER =
    /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\u20E3)?(?:\uFE0F)?(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:[\u{1F3FB}-\u{1F3FF}])?(?:\uFE0F)?)*[\uFE0F\uFE0E]?/gu;

  const clusters = [...trimmed.matchAll(EMOJI_CLUSTER)];
  if (clusters.length === 0 || clusters.length > 3) return false;

  // After stripping matched clusters and whitespace, nothing should be left.
  const remainder = trimmed.replace(EMOJI_CLUSTER, "").replace(/\s/g, "");
  return remainder.length === 0;
}
