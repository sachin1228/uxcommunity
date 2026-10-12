"use client";

import { ImageIcon } from "lucide-react";
import { NotoEmojiSvg } from "../chat/NotoEmojiSvg";
import { emojiToCodepoint, svgUrlForCodepoint } from "@/lib/noto-emoji";

/**
 * The small presentational pieces the community sidebar and the DM list share,
 * so their preview lines read identically: emoji drawn as Noto SVGs rather than
 * the platform font, and the photo glyph that stands in for an image-only
 * message.
 */

/** Render text with SVG emoji images for a sidebar preview. */
export function renderTextWithEmoji(text: string): React.ReactNode {
  if (!text) return text;
  const parts: React.ReactNode[] = [];
  const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
  let lastIndex = 0;
  let match;
  while ((match = emojiRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    const emoji = match[0];
    const cp = emojiToCodepoint(emoji);
    if (cp) {
      parts.push(
        <NotoEmojiSvg key={`e${match.index}`} emoji={emoji} size={13} className="align-middle" />
      );
    } else {
      parts.push(<span key={`e${match.index}`}>{emoji}</span>);
    }
    lastIndex = match.index + emoji.length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return parts;
}

/**
 * The word an image-only preview stands for, behind a real picture glyph —
 * the same icon the composer's attach button wears. It used to be spelled with
 * a camera emoji, which sits in the line the way the sender's own emoji do:
 * here the glyph is decoration, so it carries no text of its own and the
 * colour is inherited from the preview line it sits in.
 */
export function ImagePreviewWord({ word }: { word: string }) {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <ImageIcon aria-hidden="true" strokeWidth={2.5} size={13} className="shrink-0" />
      {word}
    </span>
  );
}
