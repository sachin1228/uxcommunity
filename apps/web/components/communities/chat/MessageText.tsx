"use client";

import { useId, useMemo, useState, useRef, useEffect, useLayoutEffect } from "react";
import TruncateMarkup from "react-truncate-markup";
import type { MessageMention } from "@/lib/communities/cache";
import { extractFirstUrl } from "@/lib/communities/linkPreview";
import { splitContentByMentions } from "@/lib/communities/mentions";
import { emojiClusterPattern } from "./chatUtils";
import { AnimatedEmoji } from "./AnimatedEmoji";
import { LinkPreview } from "./LinkPreview";

// Module-level instance: the loop below resets `lastIndex` before it runs and
// exec() clears it again on the final miss, so reuse is safe here.
const EMOJI_CLUSTER = emojiClusterPattern();

/**
 * Splits a plain text chunk into alternating text/emoji nodes so emoji
 * glyphs can be rendered at a larger size than the surrounding text,
 * matching WhatsApp's mixed-content style.
 */
function renderTextWithEmoji(text: string, key: string | number): React.ReactNode {
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

  // If no emoji was found just return the string (avoids wrapping in an extra element).
  if (segments.length === 1 && typeof segments[0] === "string") return segments[0];
  // Must be a real inline element, not a Fragment: react-truncate-markup clones
  // every element while measuring and injects `style`, which Fragments reject.
  return <span key={key}>{segments}</span>;
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
 *  On the sender's own blue bubble the mention stays white like the rest of
 *  the message: a light-blue name on blue was hard to read. */
function MentionChip({ text, isMe }: { text: string; isMe: boolean }) {
  return (
    <span
      className="inline-block max-w-full break-normal font-semibold"
      style={{ color: isMe ? "var(--color-accent-foreground, white)" : "var(--ds-blue-900)" }}
    >
      {text}</span>
  );
}

/** Number of lines shown before a long message collapses behind "Read more". */
const COLLAPSED_LINES = 10;

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** `leading-6` on the message body; ten of these are the collapsed box. */
const LINE_HEIGHT_PX = 24;

/**
 * The collapsed box's CSS clamp. It is what the first paint shows: the same
 * ten-line box the truncated markup will occupy, so the bubble cannot start at
 * the full message's height and collapse after mount.
 *
 * A max-height on a plain block is used instead of `-webkit-line-clamp`
 * because `scrollHeight` on a clamped element is not a reliable "full content"
 * measurement across browsers — and that measurement is what decides whether
 * this message gets a "Read more" at all.
 */
const COLLAPSED_CLAMP_STYLE: React.CSSProperties = {
  maxHeight: COLLAPSED_LINES * LINE_HEIGHT_PX,
  overflow: "hidden",
};

interface CollapsedBodyState {
  /** The clamped text hides content and needs the JS truncator. */
  truncated: boolean;
  /** The clamped box's height, held while the truncator searches candidates. */
  holdHeight: number | null;
}

const INITIAL_COLLAPSED_BODY: CollapsedBodyState = {
  truncated: false,
  holdHeight: null,
};

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
  /** Bumped when the column gets narrower/wider; wrapping changes with it. */
  const [layoutRevision, setLayoutRevision] = useState(0);

  // Font swaps can change wrapping without changing the column width.
  useEffect(() => {
    const remeasure = () => setFontRevision((revision) => revision + 1);
    document.fonts.addEventListener("loadingdone", remeasure);
    return () => document.fonts.removeEventListener("loadingdone", remeasure);
  }, []);

  // ── Stable collapsed body ────────────────────────────────────────────────
  // react-truncate-markup renders the WHOLE message first and then slices it
  // until the ellipsis fits, so the bubble used to paint at the full message's
  // height and visibly shrink (one re-render per candidate slice) once the chat
  // committed. The first paint is now the CSS-clamped ten-line box; the
  // truncator only mounts when that box actually overflows, and its search runs
  // inside a wrapper held at the measured ten-line height. Short messages — the
  // common case — never run the truncator at all.
  const measureKey = `${content}\u0000${fontRevision}\u0000${layoutRevision}`;
  const measuredKeyRef = useRef<string | null>(null);
  const [collapsedBody, setCollapsedBody] = useState<CollapsedBodyState>(
    INITIAL_COLLAPSED_BODY,
  );
  const resetKeyRef = useRef(measureKey);

  // A new content/width/font key invalidates the previous measurement. This
  // runs before the measuring effect below, so the re-render it schedules
  // mounts the clamped (untruncated) copy the measurement needs; a layout
  // effect flushes before paint, so the stale copy is never shown.
  useIsomorphicLayoutEffect(() => {
    if (resetKeyRef.current === measureKey) return;
    resetKeyRef.current = measureKey;
    measuredKeyRef.current = null;
    if (collapsedBody.truncated || collapsedBody.holdHeight !== null) {
      setCollapsedBody(INITIAL_COLLAPSED_BODY);
    }
  }, [measureKey, collapsedBody.truncated, collapsedBody.holdHeight]);

  useIsomorphicLayoutEffect(() => {
    if (!collapsed) return;
    // The truncator's unclamped tree is what is mounted while a truncation is
    // active; measuring it would always report "overflows". The reset above
    // replaces it with the clamped copy and re-runs this effect.
    if (collapsedBody.truncated) return;
    if (measuredKeyRef.current === measureKey) return;
    const element = textRef.current;
    if (!element) return;
    measuredKeyRef.current = measureKey;
    const overflows = element.scrollHeight > element.clientHeight + 1;
    const next: CollapsedBodyState = {
      truncated: overflows,
      holdHeight: overflows ? element.clientHeight : null,
    };
    // Most messages fit; re-using the state object bails out of a re-render
    // that would otherwise run for every short message on a page.
    setCollapsedBody((previous) =>
      previous.truncated === next.truncated &&
      previous.holdHeight === next.holdHeight
        ? previous
        : next,
    );
  }, [collapsed, measureKey, collapsedBody.truncated]);

  // A chat column can resize (window, sidebar, scrollbar) without the text
  // changing; the ten-line boundary moves with it, so re-measure. The clamp
  // itself never changes the column width, so this cannot feed back.
  useEffect(() => {
    if (!collapsed) return undefined;
    const element = textRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;

    let lastWidth = element.getBoundingClientRect().width;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? element.getBoundingClientRect().width;
      if (Math.abs(width - lastWidth) < 1) return;
      lastWidth = width;
      setLayoutRevision((revision) => revision + 1);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [collapsed, collapsedBody.truncated]);

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

  /**
   * The text node. `clamped` is true only for the stable first paint and while
   * the tree is measuring; the truncator must see the unclamped element or its
   * own height check always reports "fits".
   */
  const renderText = (clamped: boolean) => (
    <div
      id={textId}
      data-collapsed={collapsed || undefined}
      ref={textRef}
      tabIndex={-1}
      style={clamped ? COLLAPSED_CLAMP_STYLE : undefined}
      className={`chat-message-text font-body text-sm font-normal leading-6 whitespace-pre-wrap break-words select-text cursor-text outline-none ${
        isMe ? "text-accent-foreground" : "text-foreground"
      }`}
    >
      <span style={{ display: "inline" }}>{parts}</span>
    </div>
  );

  const truncateMarkup = (
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
      {renderText(false)}
    </TruncateMarkup>
  );

  return (
    <>
      {/* Once expanded a message stays fully open — there is no collapse back. */}
      {collapsed ? (
        collapsedBody.truncated ? (
          // The final truncation is built to fit the same COLLAPSED_LINES
          // box, so its height is held for the bubble's whole collapsed life:
          // a later parent render re-runs the library's search from the full
          // text, and without the hold that search would flash the bubble
          // taller for a frame.
          <div
            style={
              collapsedBody.holdHeight !== null
                ? { height: collapsedBody.holdHeight, overflow: "hidden" }
                : undefined
            }
          >
            {truncateMarkup}
          </div>
        ) : (
          renderText(true)
        )
      ) : (
        renderText(false)
      )}
      {previewUrl && <LinkPreview url={previewUrl} isMe={isMe} />}
    </>
  );
}
