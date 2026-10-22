import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRichText, richTextToPlainText, type BlockNode } from "./jobRichText";

/** The paragraph's inline text, flattened for a compact assertion. */
function textOf(block: BlockNode): string {
  if (block.type === "hr") return "—";
  if (block.type === "ul" || block.type === "ol") return block.items.length.toString();
  const flatten = (nodes: typeof block.children): string =>
    nodes
      .map((node) => {
        if (node.type === "text") return node.text;
        if (node.type === "br") return "\n";
        if ("children" in node) return flatten(node.children);
        return "";
      })
      .join("");
  return flatten(block.children);
}

test("plain text keeps the line breaks the poster typed", () => {
  const blocks = parseRichText("First line\nSecond line\n\nNew paragraph");
  assert.equal(blocks.length, 1);
  assert.equal(textOf(blocks[0]), "First line\nSecond line\n\nNew paragraph");
});

test("canonical html reads as paragraphs, headings and lists", () => {
  const blocks = parseRichText(
    "<p>Intro <strong>bold</strong> and <em>italic</em>.</p><h2>Heading</h2><ul><li>One</li><li>Two</li></ul><hr>",
  );
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["p", "h2", "ul", "hr"],
  );
  assert.equal(textOf(blocks[0]), "Intro bold and italic.");
  assert.equal(textOf(blocks[1]), "Heading");
});

test("links keep http(s) and mailto, and lose anything else", () => {
  const [safe] = parseRichText('<p><a href="https://example.com">site</a></p>');
  assert.equal(safe.type, "p");
  const anchor = safe.type === "p" ? safe.children[0] : null;
  assert.equal(anchor && "href" in anchor ? anchor.href : null, "https://example.com");

  const [unsafe] = parseRichText('<p><a href="javascript:alert(1)">click</a></p>');
  assert.equal(unsafe.type, "p");
  assert.deepEqual(unsafe.type === "p" ? unsafe.children.map((node) => node.type) : [], ["text"]);
});

test("scripts disappear, unknown wrappers are unwrapped, entities decode", () => {
  const blocks = parseRichText(
    "<div><script>alert(1)</script><span>Hello &amp; bye</span> &mdash; 5 &lt; 6&nbsp;ok</div>",
  );
  assert.equal(blocks.length, 1);
  assert.equal(textOf(blocks[0]), "Hello & bye — 5 < 6\u00a0ok");
});

test("a list pasted inside a paragraph is hoisted out", () => {
  const blocks = parseRichText("<p>Before<ul><li>One</li></ul>After</p>");
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["p", "ul", "p"],
  );
});

test("plain text flattens back for the edit form", () => {
  const html =
    "<h2>Role</h2><p>Build <strong>things</strong>.</p><ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>";
  assert.equal(
    richTextToPlainText(html),
    "Role\n\nBuild things.\n\n- One\n- Two\n  - Nested",
  );
});
