import type { BlockNode, InlineNode, ListBlockNode } from "@/lib/jobs/rich-text";
import { parseRichText } from "@/lib/jobs/rich-text";

/**
 * A description drawn from the formatting the field stores.
 *
 * Every node is built as a React element from the parsed tree, so nothing in a
 * description is ever interpreted as html a second time: a `<script>` that
 * somehow reached the column is text in the tree and text on the page. The
 * parser is what guarantees the shapes here nest legally — no list inside a
 * paragraph, no item outside a list.
 *
 * Text with no markup is one paragraph whose `<br>`s are the line breaks the
 * poster typed, which is what `whitespace-pre-line` drew for every description
 * written before the field took formatting.
 */
export function RichText({ html, className }: { html: string | null; className?: string }) {
  const blocks = parseRichText(html);
  if (blocks.length === 0) return null;

  return (
    <div className={className ?? "flex flex-col gap-2.5"}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

/** Body copy, shared by a paragraph and an item so the two always match. */
const BODY = "font-body text-sm leading-relaxed text-foreground";

function Block({ block }: { block: BlockNode }) {
  if (block.type === "hr") return <hr className="border-border" />;
  if (block.type === "ul" || block.type === "ol") return <ListBlock block={block} />;

  if (block.type === "h2") {
    return (
      <h2 className="font-display text-base font-semibold text-foreground">
        <InlineRun nodes={block.children} />
      </h2>
    );
  }
  if (block.type === "h3") {
    return (
      <h3 className="font-body text-sm font-semibold text-foreground">
        <InlineRun nodes={block.children} />
      </h3>
    );
  }
  if (block.type === "blockquote") {
    return (
      <blockquote className={`border-l-2 border-border pl-3 text-foreground-muted ${BODY}`}>
        <InlineRun nodes={block.children} />
      </blockquote>
    );
  }
  return (
    <p className={BODY}>
      <InlineRun nodes={block.children} />
    </p>
  );
}

/** A list, and the lists nested inside its items. */
function ListBlock({ block, nested = false }: { block: ListBlockNode; nested?: boolean }) {
  const ordered = block.type === "ol";
  const className = [
    "flex flex-col gap-1.5 pl-5",
    ordered ? "list-decimal" : "list-disc",
    "marker:text-foreground-subtle",
    nested ? "mt-1.5" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const items = block.items.map((item, index) => (
    <li key={index} className={BODY}>
      {item.children.map((child, childIndex) =>
        child.type === "ul" || child.type === "ol" ? (
          <ListBlock key={childIndex} block={child} nested />
        ) : (
          <Inline key={childIndex} node={child} />
        )
      )}
    </li>
  ));

  return ordered ? <ol className={className}>{items}</ol> : <ul className={className}>{items}</ul>;
}

function InlineRun({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Inline key={index} node={node} />
      ))}
    </>
  );
}

function Inline({ node }: { node: InlineNode }) {
  switch (node.type) {
    case "text":
      return <>{node.text}</>;
    case "br":
      return <br />;
    case "strong":
      return (
        <strong className="font-semibold">
          <InlineRun nodes={node.children} />
        </strong>
      );
    case "em":
      return (
        <em className="italic">
          <InlineRun nodes={node.children} />
        </em>
      );
    case "u":
      return (
        <u>
          <InlineRun nodes={node.children} />
        </u>
      );
    case "s":
      return (
        <s>
          <InlineRun nodes={node.children} />
        </s>
      );
    case "a":
      // A stored link is a link to somewhere else; it never carries the
      // opener's window with it.
      return (
        <a
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          <InlineRun nodes={node.children} />
        </a>
      );
  }
}
