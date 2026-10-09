/**
 * The formatting a job description may carry.
 *
 * WHY
 *   A description is rarely typed here — it is pasted from a doc, an email or
 *   another job board, and the poster expects it to arrive as they wrote it:
 *   bullets, spacing, bold headings. A plain textarea keeps the line breaks and
 *   throws away everything else, so the field stores this subset instead.
 *
 * WHAT
 *   `sanitizeRichText` turns ANY html string into the subset — the only shape
 *   that ever reaches the database. Unknown tags are unwrapped, scripts and
 *   style sheets are dropped whole, every attribute except an http(s)/mailto
 *   link is discarded, and the result is stable: a value that has been through
 *   it twice is byte-identical to a value that has been through it once.
 *
 *   `parseRichText` turns that subset into the canonical block list both
 *   readers draw from — the `RichText` component for React, `serializeRichText`
 *   for a string. The tree is normalised as it is built (a list inside a
 *   paragraph is hoisted out, loose text inside a list becomes an item), so
 *   neither reader can emit html a browser would refuse.
 *
 *   Text with no markup at all — every description written before this existed
 *   — parses to one paragraph whose newlines survive, which is exactly what
 *   `whitespace-pre-line` drew. Nothing already stored changes meaning.
 *
 * SAFETY
 *   The parser recognises seven block tags and five inline tags by name and
 *   escapes every byte of text it emits itself; unrecognised markup can only
 *   ever become text or disappear. There is no innerHTML, no
 *   `dangerouslySetInnerHTML` and no regex tag-stripping to bypass, and the
 *   same code runs on the server, so a caller that never touches the editor
 *   (the API is one) is sanitised identically.
 *
 * Pure and dependency-free on purpose: the browser runs it on every keystroke
 * and paste, the server runs it before every write, and `node --test` covers
 * both through the same functions.
 */

// ── The subset ───────────────────────────────────────────────────────────────

/** Tags whose contents are never part of the text — the element goes entirely. */
const DROPPED_WITH_CONTENTS = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "svg",
  "math",
  "canvas",
  "template",
  "head",
  "title",
  "meta",
  "link",
  "base",
  "audio",
  "video",
  "source",
  "track",
  "map",
  "area",
  "select",
  "option",
  "optgroup",
  "textarea",
  "input",
  "button",
  "form",
  "dialog",
  "slot",
  "portal",
]);

/**
 * Tags that hold no children and so are never "closed" — the html void set.
 * Getting this wrong is not cosmetic: `<meta charset>` with no closing tag
 * would otherwise be treated as holding everything that follows it, and the
 * rest of a pasted document would be swallowed.
 */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Where a recognisable tag lands. Anything absent is *unwrapped* — the tag
 * disappears and its children take its place — which is what keeps an
 * uninteresting wrapper from being an error.
 */
const TAG_ALIASES: Record<string, string> = {
  // Inline
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  u: "u",
  ins: "u",
  s: "s",
  strike: "s",
  del: "s",
  a: "a",
  br: "br",
  // Blocks
  p: "p",
  div: "p",
  // Docs and Word lean on these where a paragraph was meant, and a body copy
  // line split by one is still a line.
  section: "p",
  article: "p",
  header: "p",
  footer: "p",
  address: "p",
  // A heading deeper than h3 becomes h3: the description has two levels, and
  // the clamp keeps a pasted document outline from inventing a third.
  h1: "h2",
  h2: "h2",
  h3: "h3",
  h4: "h3",
  h5: "h3",
  h6: "h3",
  ul: "ul",
  ol: "ol",
  li: "li",
  blockquote: "blockquote",
  hr: "hr",
  // A table cell reads as a line of its own rather than all cells run together.
  td: "p",
  th: "p",
  caption: "p",
  // Bold-by-default elements still mean "bold" when they arrive styled.
  figcaption: "p",
  dt: "p",
  dd: "p",
};

const BLOCK_TAGS = new Set(["p", "h2", "h3", "ul", "ol", "li", "blockquote", "hr"]);
const INLINE_TAGS = new Set(["strong", "em", "u", "s", "a", "br"]);

/** Links we let through; anything else loses the tag and keeps its text. */
const SAFE_URL = /^(?:https?:|mailto:)/i;

/** How deep a fixture may nest before the rest of it is ignored. */
const MAX_DEPTH = 40;

/** The poster-facing limit: how much *text* a description may hold. */
export const RICH_TEXT_MAX_CHARS = 8000;

/**
 * The storage ceiling. Markup is longer than the text it formats, so the column
 * has to accept more than the poster may type — see the migration that widened
 * the check. A description that is all bold and all bullets cannot reach this.
 */
export const RICH_TEXT_MAX_HTML_CHARS = 24000;

// ── The tree ─────────────────────────────────────────────────────────────────

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "u"; children: InlineNode[] }
  | { type: "s"; children: InlineNode[] }
  | { type: "a"; href: string; children: InlineNode[] }
  | { type: "br" };

/**
 * Two members rather than one with `type: "ul" | "ol"`: a union member whose
 * own discriminant is a union is not removed by narrowing, so every reader that
 * asks "is this a list?" would keep seeing the list in the branch where it is
 * not one.
 */
export type ListBlockNode =
  | { type: "ul"; items: ListItemNode[] }
  | { type: "ol"; items: ListItemNode[] };

/** An item holds inline runs and nested lists, in the order they were written. */
export type ListItemNode = { children: (InlineNode | ListBlockNode)[] };

export type BlockNode =
  | { type: "p" | "h2" | "h3" | "blockquote"; children: InlineNode[] }
  | { type: "hr" }
  | ListBlockNode;

// ── Entities ─────────────────────────────────────────────────────────────────

/** The named entities that actually turn up in a paste, plus every numeric one. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  shy: "\u00ad",
  mdash: "\u2014",
  ndash: "\u2013",
  minus: "\u2212",
  hellip: "\u2026",
  bull: "\u2022",
  middot: "\u00b7",
  deg: "\u00b0",
  times: "\u00d7",
  divide: "\u00f7",
  laquo: "\u00ab",
  raquo: "\u00bb",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  sbquo: "\u201a",
  bdquo: "\u201e",
  dagger: "\u2020",
  Dagger: "\u2021",
  permil: "\u2030",
  prime: "\u2032",
  Prime: "\u2033",
  euro: "\u20ac",
  pound: "\u00a3",
  yen: "\u00a5",
  cent: "\u00a2",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  sect: "\u00a7",
  para: "\u00b6",
  micro: "\u00b5",
  plusmn: "\u00b1",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  sup2: "\u00b2",
  sup3: "\u00b3",
  ne: "\u2260",
  le: "\u2264",
  ge: "\u2265",
  larr: "\u2190",
  rarr: "\u2192",
  harr: "\u2194",
  crarr: "\u21b5",
  check: "\u2713",
  cross: "\u2717",
  star: "\u2605",
  hearts: "\u2665",
};

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      // Surrogates and out-of-range code points would throw; a literal '&' is a
      // better answer than an exception on a paste.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00a0/g, "&nbsp;");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ── Emphasis read out of a style attribute ───────────────────────────────────

/**
 * Docs and Word express emphasis with `style` far more often than with tags:
 * Google Docs writes `<b style="font-weight:normal">` around text it is *not*
 * bolding, and Word writes `<span style='font-weight:700'>` around text it is.
 * Reading the ones we can see is the difference between a pasted heading
 * arriving bold and arriving plain.
 */
interface Emphasis {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** An explicit "normal" beats a tag that would otherwise imply emphasis. */
  plainWeight: boolean;
  plainStyle: boolean;
  plainDecoration: boolean;
}

const NO_EMPHASIS: Emphasis = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  plainWeight: false,
  plainStyle: false,
  plainDecoration: false,
};

function emphasisFromStyle(style: string | undefined): Emphasis {
  if (!style) return NO_EMPHASIS;
  const found: Emphasis = { ...NO_EMPHASIS };
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim().toLowerCase();
    if (!property || !value) continue;

    if (property === "font-weight") {
      const numeric = Number(value);
      if (/^(normal|400|500)$/.test(value)) found.plainWeight = true;
      else if (/^(bold|bolder|600|700|800|900)$/.test(value)) found.bold = true;
      else if (Number.isFinite(numeric) && numeric >= 600) found.bold = true;
    } else if (property === "font-style") {
      if (value === "normal") found.plainStyle = true;
      else if (/^(italic|oblique)$/.test(value)) found.italic = true;
    } else if (property === "text-decoration" || property === "text-decoration-line") {
      if (value.includes("none")) found.plainDecoration = true;
      if (value.includes("underline")) found.underline = true;
      if (value.includes("line-through")) found.strike = true;
    }
  }
  return found;
}

function hasEmphasis(emphasis: Emphasis): boolean {
  return emphasis.bold || emphasis.italic || emphasis.underline || emphasis.strike;
}

// ── Reading html into a raw tree ─────────────────────────────────────────────

interface RawElement {
  kind: "element";
  tag: string;
  href: string | null;
  style: string | undefined;
  children: RawNode[];
}

type RawNode = { kind: "text"; text: string } | RawElement;

interface Attributes {
  href: string | null;
  style: string | undefined;
}

/** `a href="x" style='y'` → its parts, entities decoded, names lower-cased. */
function readAttributes(source: string): Attributes {
  let href: string | null = null;
  let style: string | undefined;
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = (match[1] ?? "").toLowerCase();
    const value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    if (name === "href") href = value;
    else if (name === "style") style = value;
  }
  return { href, style };
}

/** Whether a link target may survive; a scheme smuggled over whitespace may not. */
export function isSafeHref(href: string): boolean {
  // `java\tscript:` and `jav&#x0A;ascript:` both reach us decoded, so the check
  // runs on a copy with every whitespace and control character removed — the
  // same normalisation a browser applies before it follows a link.
  const collapsed = href.replace(/[\s\u0000-\u001f\u007f]+/g, "");
  return SAFE_URL.test(collapsed);
}

/** Where the `>` that ends the tag starting at `start` sits, quotes respected. */
function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

/** Consume the rest of a balanced element whose contents are being discarded. */
function skipElement(html: string, start: number, tag: string): number {
  let depth = 1;
  let i = start;
  while (i < html.length && depth > 0) {
    const lt = html.indexOf("<", i);
    if (lt === -1) return html.length;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const close = html.startsWith("</", lt);
    const end = findTagEnd(html, lt);
    if (end === -1) return html.length;
    const name = html
      .slice(close ? lt + 2 : lt + 1, end)
      .trim()
      .toLowerCase()
      .split(/[\s/>]/, 1)[0];
    if (name === tag) depth += close ? -1 : html[end - 1] === "/" ? 0 : 1;
    i = end + 1;
  }
  return i;
}

function parseNodes(html: string, start: number, openTag: string | null, depth: number): [RawNode[], number] {
  const children: RawNode[] = [];
  let i = start;

  while (i < html.length) {
    const lt = html.indexOf("<", i);

    if (lt === -1) {
      if (i < html.length) children.push({ kind: "text", text: decodeEntities(html.slice(i)) });
      return [children, html.length];
    }

    if (lt > i) children.push({ kind: "text", text: decodeEntities(html.slice(i, lt)) });

    // Comments, doctypes and processing instructions are markup, not text.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end = findTagEnd(html, lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    // `<` only begins a tag when a name follows it: "a < b" is a comparison,
    // and "</" that names nothing is not a closing tag.
    const closing = html[lt + 1] === "/";
    if (!/[a-zA-Z]/.test((closing ? html[lt + 2] : html[lt + 1]) ?? "")) {
      children.push({ kind: "text", text: "<" });
      i = lt + 1;
      continue;
    }

    // A closing tag ends this element when it names it; anything else is either
    // a stray close from malformed html (ignored) or one we are not inside.
    if (closing) {
      const end = html.indexOf(">", lt);
      if (end === -1) return [children, html.length];
      const name = html.slice(lt + 2, end).trim().toLowerCase().split(/[\s>]/, 1)[0];
      i = end + 1;
      if (openTag !== null && name === openTag) return [children, i];
      continue;
    }

    const end = findTagEnd(html, lt);
    if (end === -1) {
      // A `<` that never closes is text, not a tag.
      children.push({ kind: "text", text: "<" });
      i = lt + 1;
      continue;
    }

    const raw = html.slice(lt + 1, end);
    const selfClosing = raw.endsWith("/");
    const open = selfClosing ? raw.slice(0, -1) : raw;
    const space = open.search(/[\s/]/);
    const name = (space === -1 ? open : open.slice(0, space)).toLowerCase();
    const attrSource = space === -1 ? "" : open.slice(space).trim();
    i = end + 1;

    if (!name) continue;

    if (DROPPED_WITH_CONTENTS.has(name)) {
      i = VOID_TAGS.has(name) ? i : skipElement(html, i, name);
      continue;
    }

    if (VOID_TAGS.has(name)) {
      const alias = TAG_ALIASES[name];
      const attributes = attrSource ? readAttributes(attrSource) : { href: null, style: undefined };
      // An image is not something a description can carry; it disappears.
      if (alias === "br") children.push({ kind: "element", tag: "br", href: null, style: undefined, children: [] });
      else if (alias === "hr") children.push({ kind: "element", tag: "hr", href: null, style: undefined, children: [] });
      else if (alias) children.push({ kind: "element", tag: alias, href: attributes.href, style: attributes.style, children: [] });
      continue;
    }

    if (selfClosing) {
      const alias = TAG_ALIASES[name];
      if (alias === "br" || alias === "hr") {
        children.push({ kind: "element", tag: alias, href: null, style: undefined, children: [] });
      }
      continue;
    }

    if (depth >= MAX_DEPTH) {
      i = skipElement(html, i, name);
      continue;
    }

    const attributes = attrSource ? readAttributes(attrSource) : { href: null, style: undefined };
    const [inner, next] = parseNodes(html, i, name, depth + 1);
    i = next;
    children.push({ kind: "element", tag: name, href: attributes.href, style: attributes.style, children: inner });
  }

  return [children, i];
}

// ── Normalising the raw tree into the canonical one ──────────────────────────

/**
 * Whitespace and nothing else, by the html definition.
 *
 * A non-breaking space is deliberately NOT whitespace here: `<p>&nbsp;</p>` is
 * how a document spells a blank line, and it draws one. It still reads as empty
 * to `richTextIsEmpty` and is still trimmed from the edges, which is what the
 * question "did the poster type anything?" needs.
 */
function isWhitespaceOnly(text: string): boolean {
  return !/[^\t\n\r\f ]/.test(text);
}

/**
 * The whitespace rule a browser applies inside a paragraph: a run of spaces,
 * tabs and source line breaks is one space.
 */
function collapseWhitespace(text: string): string {
  return text.replace(/[\t\n\r\f ]+/g, " ");
}

function canonical(node: RawElement): string | null {
  return TAG_ALIASES[node.tag] ?? null;
}

/**
 * Inline children of one run. Whitespace-only text is what a pasted document
 * uses to indent its own markup, so a node that is nothing but whitespace is
 * dropped between elements and kept as one space between words — the rule a
 * browser applies, and the reason a paste does not arrive double-spaced.
 */
function normalizeInline(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const text = collapseWhitespace(node.text);
      if (isWhitespaceOnly(text)) {
        const previous = out[out.length - 1];
        if (!previous || previous.type === "br") continue;
        out.push({ type: "text", text: " " });
        continue;
      }
      out.push({ type: "text", text });
      continue;
    }
    out.push(node);
  }
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last && last.type === "text" && isWhitespaceOnly(last.text)) out.pop();
    else break;
  }
  return out;
}

/** Wrap a run in the emphasis its own `style` asked for. */
function wrapEmphasis(children: InlineNode[], emphasis: Emphasis): InlineNode[] {
  let wrapped = children;
  if (emphasis.strike) wrapped = [{ type: "s", children: wrapped }];
  if (emphasis.underline) wrapped = [{ type: "u", children: wrapped }];
  if (emphasis.italic) wrapped = [{ type: "em", children: wrapped }];
  if (emphasis.bold) wrapped = [{ type: "strong", children: wrapped }];
  return wrapped;
}

/**
 * One raw element as a run of inline nodes. Its tag may add emphasis on top of
 * what its style asked for; a style that explicitly says "normal" takes the
 * tag's emphasis away again, which is how Docs marks text it is not bolding.
 */
function inlineFrom(node: RawElement): InlineNode[] {
  const tag = canonical(node);
  if (tag === "br") return [{ type: "br" }];

  const emphasis = emphasisFromStyle(node.style);
  const children = normalizeInline(inlineChildren(node));

  if (tag === "a") {
    const href = node.href ?? "";
    if (!href || !isSafeHref(href)) return children;
    return [{ type: "a", href, children }];
  }

  const wrappers: ("strong" | "em" | "u" | "s")[] = [];
  if (tag === "strong" && !emphasis.plainWeight) wrappers.push("strong");
  if (tag === "em" && !emphasis.plainStyle) wrappers.push("em");
  if (tag === "u") wrappers.push("u");
  if (tag === "s") wrappers.push("s");

  let wrapped = wrapEmphasis(children, {
    ...emphasis,
    bold: emphasis.plainWeight ? false : emphasis.bold,
  });

  for (let i = wrappers.length - 1; i >= 0; i--) {
    const wrapper = wrappers[i];
    if (wrapper === "strong") wrapped = [{ type: "strong", children: wrapped }];
    else if (wrapper === "em") wrapped = [{ type: "em", children: wrapped }];
    else if (wrapper === "u") wrapped = [{ type: "u", children: wrapped }];
    else if (wrapper === "s") wrapped = [{ type: "s", children: wrapped }];
  }
  // An empty emphasis wrapper — `<span style="font-weight:bold"></span>` — is
  // nothing, not an empty tag to carry forward.
  return contentful(wrapped) ? wrapped : [];
}

/** Everything inside an element that is not a block, as inline nodes. */
function inlineChildren(node: RawElement): InlineNode[] {
  const out: InlineNode[] = [];
  for (const child of node.children) {
    if (child.kind === "text") out.push({ type: "text", text: child.text });
    else out.push(...inlineFrom(child));
  }
  return out;
}

function contentful(nodes: InlineNode[]): boolean {
  return nodes.some((node) =>
    node.type === "br"
      ? true
      : node.type === "text"
        ? !isWhitespaceOnly(node.text)
        : contentful(node.children)
  );
}

function blockOf(tag: string, children: InlineNode[], emphasis?: Emphasis): BlockNode | null {
  const inline = normalizeInline(emphasis ? wrapEmphasis(children, emphasis) : children);
  if (!contentful(inline)) return null;
  if (tag === "h2" || tag === "h3" || tag === "blockquote") return { type: tag, children: inline };
  return { type: "p", children: inline };
}

/**
 * A list item: its own inline runs, with nested lists kept in place between
 * them, and any paragraph or heading Word wrapped around a bullet folded into
 * the run rather than emitted as a block inside an item.
 */
function listItemFrom(node: RawElement): ListItemNode {
  const children: (InlineNode | ListBlockNode)[] = [];
  let run: InlineNode[] = [];

  const flush = () => {
    const inline = normalizeInline(run);
    run = [];
    if (inline.length > 0) children.push(...inline);
  };

  for (const child of node.children) {
    if (child.kind === "text") {
      run.push({ type: "text", text: child.text });
      continue;
    }
    const tag = canonical(child);
    if (tag === "ul" || tag === "ol") {
      flush();
      const list = listFrom(child);
      if (list) children.push(list);
      continue;
    }
    run.push(...inlineFrom(child));
  }
  flush();

  return { children: normalizeItemChildren(children) };
}

/**
 * An item's own children, with the whitespace a pasted document indents its
 * markup with removed from the edges and from either side of a nested list.
 */
function normalizeItemChildren(
  children: (InlineNode | ListBlockNode)[]
): (InlineNode | ListBlockNode)[] {
  const out: (InlineNode | ListBlockNode)[] = [];
  for (const child of children) {
    if (child.type === "text" && isWhitespaceOnly(child.text)) {
      const previous = out[out.length - 1];
      if (!previous || previous.type === "ul" || previous.type === "ol") continue;
      out.push({ type: "text", text: " " });
      continue;
    }
    out.push(child);
  }
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last && last.type === "text" && isWhitespaceOnly(last.text)) out.pop();
    else break;
  }
  return out;
}

function isInlineNode(node: InlineNode | ListBlockNode): node is InlineNode {
  return node.type !== "ul" && node.type !== "ol";
}

/**
 * Whether an element holds something that has to be its own block — looked for
 * through the wrappers it may be hiding behind, since a paste arrives as
 * `<html><body>` around the blocks and both of those are wrappers.
 */
function hasBlockChild(node: RawElement): boolean {
  return node.children.some((child) => {
    if (child.kind !== "element") return false;
    const tag = canonical(child);
    if (tag !== null && BLOCK_TAGS.has(tag)) return true;
    return tag === null && hasBlockChild(child);
  });
}

function listFrom(node: RawElement): ListBlockNode | null {
  const ordered = canonical(node) === "ol";
  const items: ListItemNode[] = [];

  // Text or inline markup that is not inside an item belongs to one anyway —
  // `<ul><span>a</span><li>b</li></ul>` is a two-item list, not a list with a
  // stray word in it.
  let loose: InlineNode[] = [];
  const flushLoose = () => {
    const inline = normalizeInline(loose);
    loose = [];
    if (inline.length > 0) items.push({ children: inline });
  };

  for (const child of node.children) {
    if (child.kind === "text") {
      loose.push({ type: "text", text: child.text });
      continue;
    }
    const tag = canonical(child);
    if (tag === "li") {
      flushLoose();
      items.push(listItemFrom(child));
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      flushLoose();
      const nested = listFrom(child);
      if (nested) items.push({ children: [nested] });
      continue;
    }
    loose.push(...inlineFrom(child));
  }
  flushLoose();

  const kept = items.filter((item) => item.children.length > 0);
  if (kept.length === 0) return null;
  return ordered ? { type: "ol", items: kept } : { type: "ul", items: kept };
}

/**
 * Walk a node list into block nodes, hoisting anything block-level out of the
 * paragraph or heading it was found in: a list pasted inside a paragraph must
 * end up beside it, because a `<ul>` inside a `<p>` is not a paragraph a
 * browser will render.
 */
function blocksFrom(
  nodes: RawNode[],
  out: BlockNode[],
  container: string | null,
  containerEmphasis?: Emphasis
): void {
  let run: InlineNode[] = [];

  const flush = () => {
    const inline = normalizeInline(run);
    run = [];
    const block = blockOf(container ?? "p", inline, containerEmphasis);
    if (block) out.push(block);
  };

  for (const node of nodes) {
    if (node.kind === "text") {
      run.push({ type: "text", text: node.text });
      continue;
    }

    const tag = canonical(node);

    if (tag === "hr") {
      flush();
      out.push({ type: "hr" });
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      flush();
      const list = listFrom(node);
      if (list) out.push(list);
      continue;
    }

    if (tag === "li") {
      // A bullet outside a list keeps its words and loses its marker.
      flush();
      const item = listItemFrom(node);
      const inline: InlineNode[] = [];
      const nested: BlockNode[] = [];
      for (const child of item.children) {
        if (isInlineNode(child)) inline.push(child);
        else nested.push(child);
      }
      const paragraph = blockOf("p", inline);
      if (paragraph) out.push(paragraph);
      out.push(...nested);
      continue;
    }

    if (tag === "p" || tag === "h2" || tag === "h3" || tag === "blockquote") {
      flush();
      // The container is passed down rather than held in a variable: a heading
      // is a heading all the way through, including when a list is pasted
      // inside it and has to be hoisted back out to this level.
      blocksFrom(node.children, out, tag, emphasisFromStyle(node.style));
      continue;
    }

    if (tag === null && hasBlockChild(node)) {
      // A wrapper with no meaning of its own — a clipboard's `<body>`, a
      // table, the shell a spreadsheet paste arrives in. Descending keeps the
      // headings and lists inside it as blocks instead of running the whole
      // document together into one paragraph.
      flush();
      blocksFrom(node.children, out, container, containerEmphasis);
      continue;
    }

    // Inline, or an unwrapped wrapper holding nothing but inline: it all joins
    // the run being collected.
    run.push(...inlineFrom(node));
  }

  flush();
}

// ── Public surface ───────────────────────────────────────────────────────────

/** Whether a value carries any markup at all, or is only words. */
export function hasMarkup(html: string | null | undefined): boolean {
  return typeof html === "string" && /<[a-zA-Z!/?]/.test(html);
}

/** Any html string into the canonical block list both readers draw from. */
export function parseRichText(html: string | null | undefined): BlockNode[] {
  const value = typeof html === "string" ? html : "";
  if (!value) return [];

  // A value with no markup is plain text, and in plain text a line break is
  // something the poster wrote — every description that predates this field is
  // one, and their blank lines have to survive. In `html` a line break between
  // two words is just where an author wrapped their source, so it collapses.
  // Spelling the plain-text case as `<br>` is also what makes the canonical
  // form stable: the second pass sees markup and no newlines at all.
  const source = hasMarkup(value) ? value : escapeText(value).replace(/\r\n?|\n/g, "<br>");
  const [raw] = parseNodes(source, 0, null, 0);
  const out: BlockNode[] = [];
  blocksFrom(raw, out, null);
  return out;
}

// ── Writing the canonical tree back out ──────────────────────────────────────

function serializeInline(nodes: InlineNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += escapeText(node.text);
        break;
      case "br":
        out += "<br>";
        break;
      case "a":
        out += `<a href="${escapeAttribute(node.href)}">${serializeInline(node.children)}</a>`;
        break;
      default:
        out += `<${node.type}>${serializeInline(node.children)}</${node.type}>`;
        break;
    }
  }
  return out;
}

function serializeBlocks(blocks: BlockNode[]): string {
  let out = "";
  for (const block of blocks) {
    if (block.type === "hr") {
      out += "<hr>";
      continue;
    }
    if (block.type === "ul" || block.type === "ol") {
      out += `<${block.type}>`;
      for (const item of block.items) {
        out += "<li>";
        for (const child of item.children) {
          out += child.type === "ul" || child.type === "ol" ? serializeBlocks([child]) : serializeInline([child]);
        }
        out += "</li>";
      }
      out += `</${block.type}>`;
      continue;
    }
    out += `<${block.type}>${serializeInline(block.children)}</${block.type}>`;
  }
  return out;
}

export function serializeRichText(blocks: BlockNode[]): string {
  return serializeBlocks(blocks);
}

/**
 * A value's html as it should be *inserted* into running text: a single
 * paragraph loses its wrapper, because pasting a sentence into the middle of a
 * paragraph must not put a paragraph inside a paragraph. Anything with more
 * structure keeps its blocks, so a pasted list stays a list.
 */
export function richTextToInlineHtml(html: string | null | undefined): string {
  const blocks = parseRichText(html);
  const only = blocks.length === 1 ? blocks[0] : null;
  if (only && (only.type === "p" || only.type === "blockquote")) return serializeInline(only.children);
  return serializeRichText(blocks);
}

/**
 * The one function a write path needs: whatever arrives becomes the subset,
 * and running it again over its own output changes nothing.
 */
export function sanitizeRichText(html: string | null | undefined): string {
  return serializeRichText(parseRichText(html));
}

/** The words an inline run draws, with a line break for every `<br>`. */
function inlineToText(nodes: InlineNode[]): string {
  let text = "";
  for (const node of nodes) {
    if (node.type === "text") text += node.text;
    else if (node.type === "br") text += "\n";
    else text += inlineToText(node.children);
  }
  return text;
}

/** A block that would draw nothing — an empty line, not a line of spaces. */
function blankBlock(block: BlockNode): boolean {
  if (block.type === "hr" || block.type === "ul" || block.type === "ol") return false;
  // `trim` takes non-breaking space with it, so `<p>&nbsp;</p>` is blank too.
  return inlineToText(block.children).trim().length === 0;
}

/** The words a reader would see, one line per block and per break. */
export function richTextToPlainText(html: string | null | undefined): string {
  const lines: string[] = [];

  const inline = (nodes: InlineNode[], out: string): string => out + inlineToText(nodes);

  const walk = (blocks: BlockNode[]) => {
    for (const block of blocks) {
      if (block.type === "hr") continue;
      if (block.type === "ul" || block.type === "ol") {
        for (const item of block.items) {
          let text = "";
          const nested: BlockNode[] = [];
          for (const child of item.children) {
            if (child.type === "ul" || child.type === "ol") nested.push(child);
            else text = inline([child], text);
          }
          lines.push(text);
          walk(nested);
        }
        continue;
      }
      lines.push(inline(block.children, ""));
    }
  };

  walk(parseRichText(html));
  return lines.join("\n").replace(/\u00a0/g, " ");
}

/** Whether a description says anything at all — `<p><br></p>` does not. */
export function richTextIsEmpty(html: string | null | undefined): boolean {
  return richTextToPlainText(html).trim().length === 0;
}

/**
 * Trim the blank space an editor leaves at the edges of a value, so an edit
 * that only added a trailing empty paragraph stores what a reader sees.
 */
export function trimRichText(html: string | null | undefined): string {
  const blocks = parseRichText(html);
  while (blocks.length > 0) {
    const last = blocks[blocks.length - 1];
    if (last && blankBlock(last)) blocks.pop();
    else break;
  }
  while (blocks.length > 0) {
    const first = blocks[0];
    if (first && blankBlock(first)) blocks.shift();
    else break;
  }
  return serializeRichText(blocks);
}
