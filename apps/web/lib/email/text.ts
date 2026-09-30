import { APP_NAME } from "@uxcommunity/shared";
import { stripEmphasis, type EmailBlock, type EmailDocument } from "./document";

/**
 * The plain-text body.
 *
 * It is not a lesser copy of the HTML — it is what a watch notification, a
 * screen reader reading the raw part, or a client with images and styles off
 * actually shows, so it carries the same heading, the same ask and the same
 * small print, minus everything that only exists to be looked at.
 */

/**
 * Wrap at the width plain text has been read at since mail was only text. Going
 * wider is what makes a paragraph come back folded the wrong way in a client
 * that hard-wraps at 78 columns.
 */
const WIDTH = 76;

/** Greedy wrap, one word at a time, never splitting a word. */
function wrap(text: string, width = WIDTH): string {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(/\s+/)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);

  return lines.join("\n");
}

/**
 * A URL is left on its own line, unwrapped: breaking it would break the one
 * thing the reader has to act on, and every client that linkifies does so per
 * line.
 */
function renderBlock(block: EmailBlock): string {
  switch (block.kind) {
    case "paragraph":
      return wrap(stripEmphasis(block.text));
    case "finePrint":
      return wrap(stripEmphasis(block.text));
    case "code":
      return `  ${block.value}`;
    case "action":
      return `${block.label}\n${block.href}`;
  }
}

export function renderEmailText(document: EmailDocument): string {
  const parts = [
    document.heading,
    ...document.blocks.map(renderBlock),
    `© ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.`,
  ];

  return `${parts.join("\n\n").trimEnd()}\n`;
}
