/**
 * The job description's stored formatting, parsed for native rendering.
 *
 * A description is the web rich-text field's canonical subset — `p`, `h2`,
 * `h3`, `ul`, `ol`, `li`, `blockquote`, `hr` and the inline set `strong`,
 * `em`, `u`, `s`, `a`, `br` — already sanitised on the server. This module
 * turns that subset into the block tree the mobile renderer draws, and can
 * flatten it to plain text for the edit form (which submits the stored html
 * unchanged unless the words were actually edited).
 *
 * Text with no markup is one paragraph whose line breaks the poster typed,
 * exactly like the web reader. Nothing here ever interprets a description as
 * anything but data.
 */

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'u'; children: InlineNode[] }
  | { type: 's'; children: InlineNode[] }
  | { type: 'a'; href: string; children: InlineNode[] }
  | { type: 'br' };

export type ListBlockNode =
  | { type: 'ul'; items: ListItemNode[] }
  | { type: 'ol'; items: ListItemNode[] };

export type ListItemNode = { children: (InlineNode | ListBlockNode)[] };

export type BlockNode =
  | { type: 'p' | 'h2' | 'h3' | 'blockquote'; children: InlineNode[] }
  | { type: 'hr' }
  | ListBlockNode;

// ── Raw tree ────────────────────────────────────────────────────────────────

interface RawText {
  kind: 'text';
  text: string;
}

interface RawElement {
  kind: 'element';
  /** The canonical tag, or null for an unrecognised wrapper to unwrap. */
  tag: string | null;
  href: string | null;
  children: RawNode[];
}

type RawNode = RawText | RawElement;

const TAG_ALIASES: Record<string, string> = {
  b: 'strong',
  strong: 'strong',
  i: 'em',
  em: 'em',
  u: 'u',
  ins: 'u',
  s: 's',
  strike: 's',
  del: 's',
  a: 'a',
  br: 'br',
  p: 'p',
  div: 'p',
  h1: 'h2',
  h2: 'h2',
  h3: 'h3',
  h4: 'h3',
  h5: 'h3',
  h6: 'h3',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  blockquote: 'blockquote',
  hr: 'hr',
};

const DROPPED_WITH_CONTENTS = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'template',
  'head',
  'title',
  'meta',
  'link',
  'base',
  'video',
  'audio',
  'source',
  'select',
  'textarea',
  'input',
  'button',
  'form',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'base', 'source', 'wbr']);

const MAX_DEPTH = 40;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  middot: '\u00b7',
  bull: '\u2022',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
};

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
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

function readHref(attributes: string): string | null {
  const match = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const value = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
  return /^(?:https?:|mailto:)/i.test(value) ? decodeEntities(value) : null;
}

function findTagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from + 1; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }
  return -1;
}

function skipElement(html: string, start: number, tag: string): number {
  let depth = 1;
  let i = start;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) return html.length;
    const closing = html[lt + 1] === '/';
    const end = findTagEnd(html, lt);
    if (end === -1) return html.length;
    const name = html
      .slice(closing ? lt + 2 : lt + 1, end)
      .trim()
      .toLowerCase()
      .split(/[\s/>]/, 1)[0];
    if (name === tag) depth += closing ? -1 : html[end - 1] === '/' ? 0 : 1;
    i = end + 1;
    if (depth === 0) return i;
  }
  return i;
}

function parseNodes(html: string, start: number, openTag: string | null, depth: number): [RawNode[], number] {
  const children: RawNode[] = [];
  let i = start;

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      if (i < html.length) children.push({ kind: 'text', text: decodeEntities(html.slice(i)) });
      return [children, html.length];
    }
    if (lt > i) children.push({ kind: 'text', text: decodeEntities(html.slice(i, lt)) });

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = findTagEnd(html, lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const closing = html[lt + 1] === '/';
    if (!/[a-zA-Z]/.test((closing ? html[lt + 2] : html[lt + 1]) ?? '')) {
      children.push({ kind: 'text', text: '<' });
      i = lt + 1;
      continue;
    }

    if (closing) {
      const end = html.indexOf('>', lt);
      if (end === -1) return [children, html.length];
      const name = html.slice(lt + 2, end).trim().toLowerCase().split(/[\s>]/, 1)[0];
      i = end + 1;
      if (openTag !== null && (TAG_ALIASES[name] ?? name) === openTag) return [children, i];
      continue;
    }

    const end = findTagEnd(html, lt);
    if (end === -1) {
      children.push({ kind: 'text', text: '<' });
      i = lt + 1;
      continue;
    }

    const raw = html.slice(lt + 1, end);
    const selfClosing = raw.endsWith('/');
    const open = selfClosing ? raw.slice(0, -1) : raw;
    const space = open.search(/[\s/]/);
    const name = (space === -1 ? open : open.slice(0, space)).toLowerCase();
    const attributes = space === -1 ? '' : open.slice(space).trim();
    i = end + 1;

    if (!name) continue;

    if (DROPPED_WITH_CONTENTS.has(name)) {
      i = VOID_TAGS.has(name) ? i : skipElement(html, i, name);
      continue;
    }

    const tag = TAG_ALIASES[name] ?? null;

    if (VOID_TAGS.has(name)) {
      if (tag === 'br' || tag === 'hr') {
        children.push({ kind: 'element', tag, href: null, children: [] });
      }
      continue;
    }

    if (selfClosing) continue;

    if (depth >= MAX_DEPTH) {
      i = skipElement(html, i, name);
      continue;
    }

    const [inner, next] = parseNodes(html, i, name, depth + 1);
    i = next;
    children.push({ kind: 'element', tag, href: readHref(attributes), children: inner });
  }

  return [children, i];
}

// ── Normalising into the rendered tree ──────────────────────────────────────

function isWhitespaceOnly(text: string): boolean {
  return !/[^\t\n\r\f ]/.test(text);
}

function collapseWhitespace(text: string): string {
  return text.replace(/[\t\n\r\f ]+/g, ' ');
}

function normalizeInline(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      const text = collapseWhitespace(node.text);
      if (isWhitespaceOnly(text)) {
        const previous = out[out.length - 1];
        if (!previous || previous.type === 'br') continue;
        out.push({ type: 'text', text: ' ' });
        continue;
      }
      out.push({ type: 'text', text });
      continue;
    }
    out.push(node);
  }
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last && last.type === 'text' && isWhitespaceOnly(last.text)) out.pop();
    else break;
  }
  return out;
}

function contentful(nodes: InlineNode[]): boolean {
  return nodes.some((node) =>
    node.type === 'br'
      ? true
      : node.type === 'text'
        ? !isWhitespaceOnly(node.text)
        : contentful(node.children),
  );
}

function inlineFrom(node: RawElement): InlineNode[] {
  if (node.tag === 'br') return [{ type: 'br' }];

  const children = normalizeInline(inlineChildren(node));

  if (node.tag === 'a') {
    if (!node.href) return children;
    return [{ type: 'a', href: node.href, children }];
  }
  if (node.tag === 'strong') return contentful(children) ? [{ type: 'strong', children }] : [];
  if (node.tag === 'em') return contentful(children) ? [{ type: 'em', children }] : [];
  if (node.tag === 'u') return contentful(children) ? [{ type: 'u', children }] : [];
  if (node.tag === 's') return contentful(children) ? [{ type: 's', children }] : [];
  return children;
}

function inlineChildren(node: RawElement): InlineNode[] {
  const out: InlineNode[] = [];
  for (const child of node.children) {
    if (child.kind === 'text') out.push({ type: 'text', text: child.text });
    else out.push(...inlineFrom(child));
  }
  return out;
}

function blockOf(
  tag: 'p' | 'h2' | 'h3' | 'blockquote',
  children: InlineNode[],
): BlockNode | null {
  const inline = normalizeInline(children);
  if (!contentful(inline)) return null;
  return { type: tag, children: inline };
}

function isListBlock(node: InlineNode | ListBlockNode): node is ListBlockNode {
  return node.type === 'ul' || node.type === 'ol';
}

function listItemFrom(node: RawElement): ListItemNode {
  const children: (InlineNode | ListBlockNode)[] = [];
  let run: InlineNode[] = [];

  const flush = () => {
    const inline = normalizeInline(run);
    run = [];
    if (inline.length > 0) children.push(...inline);
  };

  for (const child of node.children) {
    if (child.kind === 'text') {
      run.push({ type: 'text', text: child.text });
      continue;
    }
    if (child.tag === 'ul' || child.tag === 'ol') {
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

function normalizeItemChildren(children: (InlineNode | ListBlockNode)[]): (InlineNode | ListBlockNode)[] {
  const out: (InlineNode | ListBlockNode)[] = [];
  for (const child of children) {
    if (child.type === 'text' && isWhitespaceOnly(child.text)) {
      const previous = out[out.length - 1];
      if (!previous || isListBlock(previous)) continue;
      out.push({ type: 'text', text: ' ' });
      continue;
    }
    out.push(child);
  }
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last && last.type === 'text' && isWhitespaceOnly(last.text)) out.pop();
    else break;
  }
  return out;
}

function listFrom(node: RawElement): ListBlockNode | null {
  const ordered = node.tag === 'ol';
  const items: ListItemNode[] = [];
  let loose: InlineNode[] = [];

  const flushLoose = () => {
    const inline = normalizeInline(loose);
    loose = [];
    if (inline.length > 0) items.push({ children: inline });
  };

  for (const child of node.children) {
    if (child.kind === 'text') {
      loose.push({ type: 'text', text: child.text });
      continue;
    }
    if (child.tag === 'li') {
      flushLoose();
      items.push(listItemFrom(child));
      continue;
    }
    if (child.tag === 'ul' || child.tag === 'ol') {
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
  return ordered ? { type: 'ol', items: kept } : { type: 'ul', items: kept };
}

function hasBlockChild(node: RawElement): boolean {
  return node.children.some((child) => {
    if (child.kind !== 'element') return false;
    if (child.tag === 'p' || child.tag === 'h2' || child.tag === 'h3' || child.tag === 'blockquote') {
      return true;
    }
    if (child.tag === 'ul' || child.tag === 'ol' || child.tag === 'li' || child.tag === 'hr') {
      return true;
    }
    return child.tag === null && hasBlockChild(child);
  });
}

function blocksFrom(
  nodes: RawNode[],
  out: BlockNode[],
  container: 'p' | 'h2' | 'h3' | 'blockquote' | null,
): void {
  let run: InlineNode[] = [];

  const flush = () => {
    const block = blockOf(container ?? 'p', run);
    run = [];
    if (block) out.push(block);
  };

  for (const node of nodes) {
    if (node.kind === 'text') {
      run.push({ type: 'text', text: node.text });
      continue;
    }

    if (node.tag === 'hr') {
      flush();
      out.push({ type: 'hr' });
      continue;
    }

    if (node.tag === 'ul' || node.tag === 'ol') {
      flush();
      const list = listFrom(node);
      if (list) out.push(list);
      continue;
    }

    if (node.tag === 'li') {
      flush();
      const item = listItemFrom(node);
      const inline: InlineNode[] = [];
      const nested: BlockNode[] = [];
      for (const child of item.children) {
        if (isListBlock(child)) nested.push(child);
        else inline.push(child);
      }
      const paragraph = blockOf('p', inline);
      if (paragraph) out.push(paragraph);
      out.push(...nested);
      continue;
    }

    if (node.tag === 'p' || node.tag === 'h2' || node.tag === 'h3' || node.tag === 'blockquote') {
      flush();
      blocksFrom(node.children, out, node.tag);
      continue;
    }

    if (node.tag === null && hasBlockChild(node)) {
      flush();
      blocksFrom(node.children, out, container);
      continue;
    }

    run.push(...inlineFrom(node));
  }

  flush();
}

/** Whether a value carries any markup at all, or is only words. */
export function hasMarkup(html: string | null | undefined): boolean {
  return typeof html === 'string' && /<[a-zA-Z!/?]/.test(html);
}

/** Any stored description into the block list the renderer draws. */
export function parseRichText(html: string | null | undefined): BlockNode[] {
  const value = typeof html === 'string' ? html : '';
  if (!value) return [];

  // Text with no markup is plain text, where a line break is something the
  // poster wrote — the same rule the web reader applies.
  const source = hasMarkup(value)
    ? value
    : value.replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');

  const [raw] = parseNodes(source, 0, null, 0);
  const out: BlockNode[] = [];
  blocksFrom(raw, out, null);
  return out;
}

// ── Plain text (the edit form's editable copy) ──────────────────────────────

function inlineToText(nodes: InlineNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') out += node.text;
    else if (node.type === 'br') out += '\n';
    else out += inlineToText(node.children);
  }
  return out;
}

function listToText(block: ListBlockNode, depth = 0): string {
  const lines: string[] = [];
  block.items.forEach((item, index) => {
    const inline: InlineNode[] = [];
    const nested: ListBlockNode[] = [];
    for (const child of item.children) {
      if (isListBlock(child)) nested.push(child);
      else inline.push(child);
    }
    const marker = block.type === 'ol' ? `${index + 1}.` : '-';
    const indent = '  '.repeat(depth);
    lines.push(`${indent}${marker} ${inlineToText(inline).trim()}`.trimEnd());
    for (const list of nested) lines.push(listToText(list, depth + 1));
  });
  return lines.join('\n');
}

/** A description flattened for editing; paragraphs are blank-line separated. */
export function richTextToPlainText(html: string | null | undefined): string {
  const blocks = parseRichText(html);
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'hr') {
      parts.push('---');
    } else if (block.type === 'ul' || block.type === 'ol') {
      parts.push(listToText(block));
    } else {
      parts.push(inlineToText(block.children).trim());
    }
  }
  return parts.filter((part) => part.length > 0).join('\n\n');
}
