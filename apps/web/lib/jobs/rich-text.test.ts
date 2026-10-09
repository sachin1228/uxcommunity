import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseRichText,
  richTextIsEmpty,
  richTextToPlainText,
  RICH_TEXT_MAX_CHARS,
  sanitizeRichText,
  trimRichText,
} from "./rich-text";

/**
 * The sanitizer is the only door into the `description` column and the only
 * interpreter of what it holds, so these tests are about two things at once:
 * that a paste keeps the shape it arrived with, and that nothing else survives.
 */

const clean = (html: string) => sanitizeRichText(html);

test("text with no markup is one paragraph, and its line breaks stay", () => {
  // Every description written before the field took formatting. The break is
  // spelled `<br>` but drawn the way `whitespace-pre-line` drew it.
  const legacy = "1. Mandatory Requirements to Apply\n\n5-10+ years in B2B\nStrong network of PMs";
  assert.equal(
    clean(legacy),
    "<p>1. Mandatory Requirements to Apply<br><br>5-10+ years in B2B<br>Strong network of PMs</p>"
  );
  assert.equal(richTextToPlainText(clean(legacy)), legacy);
  // And the html spelling of the same value reads the same way.
  assert.equal(richTextToPlainText(clean(`<p>${legacy.replace(/\n/g, "<br>")}</p>`)), legacy);
});

test("a bullet list survives as a list, in both flavours", () => {
  assert.equal(clean("<ul><li>One</li><li>Two</li></ul>"), "<ul><li>One</li><li>Two</li></ul>");
  assert.equal(clean("<ol><li>First</li><li>Second</li></ol>"), "<ol><li>First</li><li>Second</li></ol>");
});

test("a nested list stays inside the item it belongs to", () => {
  assert.equal(
    clean("<ul><li>Parent<ul><li>Child</li></ul></li></ul>"),
    "<ul><li>Parent<ul><li>Child</li></ul></li></ul>"
  );
});

test("bold and italic survive, both as tags and as inline styles", () => {
  assert.equal(clean("<p><strong>Bold</strong> and <em>italic</em></p>"), "<p><strong>Bold</strong> and <em>italic</em></p>");
  assert.equal(clean("<p><b>Bold</b> / <i>italic</i> / <u>under</u> / <strike>gone</strike></p>"), "<p><strong>Bold</strong> / <em>italic</em> / <u>under</u> / <s>gone</s></p>");
  // Word bolds with a style, not a tag.
  assert.equal(clean('<p><span style="font-weight:700">Bold</span></p>'), "<p><strong>Bold</strong></p>");
  assert.equal(clean('<p><span style="font-style: italic">Italic</span></p>'), "<p><em>Italic</em></p>");
  assert.equal(clean('<p><span style="text-decoration: underline">Under</span></p>'), "<p><u>Under</u></p>");
});

test("Google Docs says \"not bold\" with a bold tag, and that is honoured", () => {
  // `b` around text Docs is explicitly *not* bolding — a doc paste is full of it.
  assert.equal(clean('<b style="font-weight:normal;font-size:11pt">Plain</b>'), "<p>Plain</p>");
  assert.equal(clean('<i style="font-style:normal">Plain</i>'), "<p>Plain</p>");
  assert.equal(clean('<b style="font-weight:normal"><span style="font-weight:700">Real</span></b>'), "<p><strong>Real</strong></p>");
});

test("headings survive, clamped to the two levels a description has", () => {
  assert.equal(clean("<h1>Title</h1>"), "<h2>Title</h2>");
  assert.equal(clean("<h3>Sub</h3>"), "<h3>Sub</h3>");
  assert.equal(clean("<h5>Deep</h5>"), "<h3>Deep</h3>");
  assert.equal(clean('<h2 class="MsoHeading2">Word heading</h2>'), "<h2>Word heading</h2>");
});

test("the shell a clipboard pastes into does not swallow the document", () => {
  // A copied fragment arrives as html/body around real blocks. Flattening the
  // wrapper would turn the whole description into one paragraph.
  assert.equal(
    clean("<html><body><!--StartFragment--><h2>About</h2><p>Body</p><ul><li>Perk</li></ul><!--EndFragment--></body></html>"),
    "<h2>About</h2><p>Body</p><ul><li>Perk</li></ul>"
  );
  assert.equal(clean('<meta charset="utf-8"><div>Line one</div><div>Line two</div>'), "<p>Line one</p><p>Line two</p>");
});

test("a list pasted in the middle of a paragraph is hoisted beside it", () => {
  // A `<ul>` inside a `<p>` is not a paragraph a browser will render.
  assert.equal(
    clean("<p>Requirements<ul><li>Figma</li></ul>Nice to have</p>"),
    "<p>Requirements</p><ul><li>Figma</li></ul><p>Nice to have</p>"
  );
  assert.equal(clean("<h2>Role<ul><li>One</li></ul></h2>"), "<h2>Role</h2><ul><li>One</li></ul>");
});

test("Word's paragraph and list shells become lines and bullets", () => {
  assert.equal(clean('<p class=MsoNormal><span style="mso-fareast-font-family:Calibri">Body</span></p>'), "<p>Body</p>");
  assert.equal(clean("<li><p>Wrapped bullet</p></li>"), "<p>Wrapped bullet</p>");
  assert.equal(clean("<table><tr><td>Cell A</td><td>Cell B</td></tr></table>"), "<p>Cell A</p><p>Cell B</p>");
});

test("an unclosed or stray tag cannot unbalance the output", () => {
  assert.equal(clean("<p>Unclosed"), "<p>Unclosed</p>");
  assert.equal(clean("<p>a</div>b</p>"), "<p>ab</p>");
  assert.equal(clean("</p>orphan"), "<p>orphan</p>");
  // A `<` that never becomes a tag is text.
  assert.equal(clean("a < b and c > d"), "<p>a &lt; b and c &gt; d</p>");
});

test("a link survives only when its target is one", () => {
  assert.equal(clean('<p><a href="https://uxcommunity.in/roles">Roles</a></p>'), '<p><a href="https://uxcommunity.in/roles">Roles</a></p>');
  assert.equal(clean('<p><a href="mailto:jobs@acme.com">jobs@acme.com</a></p>'), '<p><a href="mailto:jobs@acme.com">jobs@acme.com</a></p>');
  // The tag goes; the words stay.
  assert.equal(clean('<p><a href="javascript:alert(1)">Click</a></p>'), "<p>Click</p>");
  assert.equal(clean('<p><a href="JaVaScRiPt:alert(1)">Click</a></p>'), "<p>Click</p>");
  assert.equal(clean('<p><a href="java\tscript:alert(1)">Click</a></p>'), "<p>Click</p>");
  assert.equal(clean('<p><a href="jav&#x0A;ascript:alert(1)">Click</a></p>'), "<p>Click</p>");
  assert.equal(clean('<p><a href="data:text/html;base64,PHNjcmlwdD4=">Click</a></p>'), "<p>Click</p>");
  // A link with nothing to point at is not a link.
  assert.equal(clean('<p><a>Click</a></p>'), "<p>Click</p>");
});

test("scripts, styles and their contents never reach the value", () => {
  assert.equal(clean('<p>Before</p><script>alert("x")</script>'), "<p>Before</p>");
  assert.equal(clean("<style>p{color:red}</style><p>After</p>"), "<p>After</p>");
  assert.equal(clean("<p>a<script>b</script>c</p>"), "<p>ac</p>");
  // Nested inside markup that is otherwise allowed.
  assert.equal(clean("<blockquote>Quote<script>alert(1)</script></blockquote>"), "<blockquote>Quote</blockquote>");
  assert.equal(clean('<svg><script>alert(1)</script></svg>ok'), "<p>ok</p>");
  assert.equal(clean("<iframe src='https://evil.test'></iframe>ok"), "<p>ok</p>");
});

test("every attribute except a link target is discarded", () => {
  assert.equal(clean('<p onclick="alert(1)" id="x" data-y="z">Text</p>'), "<p>Text</p>");
  assert.equal(clean('<img src="x" onerror="alert(1)">Text'), "<p>Text</p>");
  assert.equal(clean('<p><a href="https://a.test" onclick="alert(1)" target="_blank">Link</a></p>'), '<p><a href="https://a.test">Link</a></p>');
  assert.equal(clean('<div style="position:fixed;top:0">Text</div>'), "<p>Text</p>");
});

test("entities are decoded once and re-encoded once", () => {
  assert.equal(clean("<p>Tom &amp; Jerry</p>"), "<p>Tom &amp; Jerry</p>");
  assert.equal(clean("<p>Tom & Jerry</p>"), "<p>Tom &amp; Jerry</p>");
  assert.equal(clean("<p>5 &lt; 10</p>"), "<p>5 &lt; 10</p>");
  assert.equal(clean("<p>don&#39;t</p>"), "<p>don't</p>");
  assert.equal(clean("<p>a&nbsp;b</p>"), "<p>a&nbsp;b</p>");
  assert.equal(clean("<p>1 &ndash; 2</p>"), "<p>1 \u2013 2</p>");
  // A bare ampersand is not an entity and must not be eaten.
  assert.equal(clean("<p>R&amp;D & something</p>"), "<p>R&amp;D &amp; something</p>");
});

test("the whitespace a document indents its own markup with is not spacing", () => {
  assert.equal(clean("<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>"), "<ul><li>One</li><li>Two</li></ul>");
  assert.equal(clean("<p>a</p>\n\n<p>b</p>"), "<p>a</p><p>b</p>");
  // A blank line the poster typed is spacing, and stays.
  assert.equal(clean("<p>a</p><p><br></p><p>b</p>"), "<p>a</p><p><br></p><p>b</p>");
  // A line break in the source of an html value is where its author wrapped,
  // not a break the reader should see...
  assert.equal(clean("<p>a\n<span>b</span></p>"), "<p>a b</p>");
  // ...while in a value with no markup it is a line the poster wrote.
  assert.equal(clean("line one\nline two"), "<p>line one<br>line two</p>");
});

test("an empty paragraph is not a description", () => {
  assert.equal(richTextIsEmpty(""), true);
  assert.equal(richTextIsEmpty(null), true);
  assert.equal(richTextIsEmpty("<p></p>"), true);
  assert.equal(richTextIsEmpty("<p><br></p>"), true);
  assert.equal(richTextIsEmpty("<p>&nbsp;</p>"), true);
  assert.equal(richTextIsEmpty("<ul><li></li></ul>"), true);
  assert.equal(richTextIsEmpty("<p> </p>"), true);
  assert.equal(richTextIsEmpty("<p>x</p>"), false);
  assert.equal(richTextIsEmpty("<ul><li>Perk</li></ul>"), false);
  assert.equal(richTextIsEmpty(clean("Run the design system.")), false);
});

test("plain text reading gives a sentence per line, list items included", () => {
  assert.equal(
    richTextToPlainText("<h2>Role</h2><p>Body</p><ul><li>Perk one</li></ul>"),
    "Role\nBody\nPerk one"
  );
  assert.equal(richTextToPlainText("<p>a<br>b</p>"), "a\nb");
});

test("the edges an editor leaves behind are trimmed, the middle is not", () => {
  assert.equal(trimRichText("<p>Body</p><p><br></p>"), "<p>Body</p>");
  assert.equal(trimRichText("<p></p><p>Body</p>"), "<p>Body</p>");
  assert.equal(trimRichText("<p>a</p><p><br></p><p>b</p>"), "<p>a</p><p><br></p><p>b</p>");
  assert.equal(trimRichText("<p><br></p>"), "");
});

test("the character budget counts words, not markup", () => {
  // The limit a poster reads is about text; the store accepts the markup that
  // formatting it costs, which is why the two numbers differ.
  assert.equal(RICH_TEXT_MAX_CHARS, 8000);
  const long = "x".repeat(RICH_TEXT_MAX_CHARS);
  assert.equal(richTextToPlainText(clean(`<p><strong>${long}</strong></p>`)).length, RICH_TEXT_MAX_CHARS);
});

test("sanitising twice changes nothing", () => {
  const inputs = [
    "",
    "plain text\n\nwith a gap",
    "<p>par</p>",
    "<ul><li>a<ul><li>b</li></ul></li></ul>",
    '<p><a href="https://a.test">link</a> and <strong>bold</strong></p>',
    "<h1>T</h1><blockquote>q</blockquote><hr><p><br></p>",
    '<p><span style="font-weight:700">w</span> <b style="font-weight:normal">n</b></p>',
    "<p>Requirements<ul><li>x</li></ul>After</p>",
    "<html><body><p>deep</p></body></html>",
    "<div>a</div><div>b</div>",
    "<p>Tom &amp; Jerry &lt;3</p>",
    "<p>&nbsp;</p>",
    "<table><tr><td>c1</td><td>c2</td></tr></table>",
    "<p>a\nb</p>",
  ];
  for (const input of inputs) {
    const once = clean(input);
    assert.equal(clean(once), once, `not stable: ${input} → ${once}`);
  }
});

test("a nesting bomb is refused rather than followed", () => {
  const bomb = "<div>".repeat(400) + "deep" + "</div>".repeat(400);
  const out = clean(bomb);
  assert.ok(out.length < 200, `expected the deep part to be dropped, got ${out.length} chars`);
  assert.equal(clean(out), out);
});

test("parsing never throws on hostile or broken markup", () => {
  const hostile = [
    "<",
    "<<<",
    "<p",
    "<p ",
    "<!-- unterminated",
    "<!DOCTYPE html>",
    "<a href=",
    "<a href='x",
    "<script",
    "<p>&#x110000;</p>",
    "<p>&#xD800;</p>",
    "<p>&unknownentity;</p>",
    "<p>\u0000</p>",
    "\u00a0",
    "<ul><li>a<li>b</ul>",
    "<p><strong><em>unclosed",
  ];
  for (const input of hostile) {
    assert.doesNotThrow(() => parseRichText(input), input);
    const once = clean(input);
    assert.equal(clean(once), once, `not stable: ${input}`);
  }
});
