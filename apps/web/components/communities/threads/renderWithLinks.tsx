import type { ReactNode } from "react";

export const URL_REGEX = /https?:\/\/[^\s<>"]+/g;

/** Render text with URLs highlighted in blue.
 *  isNested=true → uses <span onClick> to avoid <a> inside <a> (list card wrapper). */
export function renderWithLinks(text: string, isNested = false) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const url = match[0];
    if (isNested) {
      parts.push(
        <span
          key={match.index}
          role="link"
          tabIndex={0}
          className="text-[var(--ds-blue-800)] hover:underline break-all cursor-pointer"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(url, "_blank", "noopener,noreferrer"); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); window.open(url, "_blank", "noopener,noreferrer"); } }}
        >
          {url}
        </span>
      );
    } else {
      parts.push(
        <a
          key={match.index}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--ds-blue-800)] hover:underline break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>
      );
    }
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}