import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import {
  parseRichText,
  type BlockNode,
  type InlineNode,
  type ListBlockNode,
} from '@/lib/jobRichText';

type Palette = ReturnType<typeof useColors>;

/**
 * A job description drawn from its stored formatting — the mobile mirror of
 * the web `RichText` component. Every node is built as native text from the
 * parsed tree, so nothing in a description is ever interpreted a second time.
 */
export function RichText({ html }: { html: string | null }) {
  const colors = useColors();
  const blocks = parseRichText(html);
  if (blocks.length === 0) return null;

  return (
    <View style={styles.root}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} colors={colors} />
      ))}
    </View>
  );
}

function Block({ block, colors }: { block: BlockNode; colors: Palette }) {
  if (block.type === 'hr') {
    return <View style={[styles.rule, { backgroundColor: colors.border }]} />;
  }
  if (block.type === 'ul' || block.type === 'ol') {
    return <ListBlock block={block} colors={colors} />;
  }
  if (block.type === 'h2') {
    return (
      <Text style={[styles.h2, { color: colors.foreground }]}>
        <InlineRun nodes={block.children} colors={colors} />
      </Text>
    );
  }
  if (block.type === 'h3') {
    return (
      <Text style={[styles.h3, { color: colors.foreground }]}>
        <InlineRun nodes={block.children} colors={colors} />
      </Text>
    );
  }
  if (block.type === 'blockquote') {
    return (
      <View style={[styles.quote, { borderLeftColor: colors.border }]}>
        <Text style={[styles.body, { color: colors.foregroundMuted }]}>
          <InlineRun nodes={block.children} colors={colors} />
        </Text>
      </View>
    );
  }
  return (
    <Text style={[styles.body, { color: colors.foreground }]}>
      <InlineRun nodes={block.children} colors={colors} />
    </Text>
  );
}

function ListBlock({
  block,
  colors,
  nested = false,
}: {
  block: ListBlockNode;
  colors: Palette;
  nested?: boolean;
}) {
  return (
    <View style={nested ? styles.nestedList : undefined}>
      {block.items.map((item, index) => (
        <View key={index} style={styles.listItem}>
          <Text style={[styles.marker, { color: colors.foregroundSubtle }]}>
            {block.type === 'ol' ? `${index + 1}.` : '•'}
          </Text>
          <View style={styles.listItemBody}>
            {groupItem(item.children).map((part, partIndex) =>
              part.type === 'list' ? (
                <ListBlock key={partIndex} block={part.block} colors={colors} nested />
              ) : (
                <Text key={partIndex} style={[styles.body, { color: colors.foreground }]}>
                  <InlineRun nodes={part.nodes} colors={colors} />
                </Text>
              ),
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

/** An item's children, with runs of inline nodes kept in one Text. */
function groupItem(children: (InlineNode | ListBlockNode)[]): (
  | { type: 'inline'; nodes: InlineNode[] }
  | { type: 'list'; block: ListBlockNode }
)[] {
  const parts: ({ type: 'inline'; nodes: InlineNode[] } | { type: 'list'; block: ListBlockNode })[] = [];
  for (const child of children) {
    if (child.type === 'ul' || child.type === 'ol') {
      parts.push({ type: 'list', block: child });
      continue;
    }
    const last = parts[parts.length - 1];
    if (last && last.type === 'inline') last.nodes.push(child);
    else parts.push({ type: 'inline', nodes: [child] });
  }
  return parts;
}

function InlineRun({ nodes, colors }: { nodes: InlineNode[]; colors: Palette }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Inline key={index} node={node} colors={colors} />
      ))}
    </>
  );
}

function Inline({ node, colors }: { node: InlineNode; colors: Palette }) {
  switch (node.type) {
    case 'text':
      return <Text>{node.text}</Text>;
    case 'br':
      return <Text>{'\n'}</Text>;
    case 'strong':
      return (
        <Text style={styles.strong}>
          <InlineRun nodes={node.children} colors={colors} />
        </Text>
      );
    case 'em':
      return (
        <Text style={styles.em}>
          <InlineRun nodes={node.children} colors={colors} />
        </Text>
      );
    case 'u':
      return (
        <Text style={styles.u}>
          <InlineRun nodes={node.children} colors={colors} />
        </Text>
      );
    case 's':
      return (
        <Text style={styles.s}>
          <InlineRun nodes={node.children} colors={colors} />
        </Text>
      );
    case 'a':
      return (
        <Text
          style={[styles.link, { color: colors.link }]}
          onPress={() => {
            void Linking.openURL(node.href).catch(() => undefined);
          }}
          accessibilityRole="link"
        >
          <InlineRun nodes={node.children} colors={colors} />
        </Text>
      );
  }
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  body: { fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 21 },
  h2: { fontFamily: 'Geist_600SemiBold', fontSize: 16, lineHeight: 22 },
  h3: { fontFamily: 'Geist_600SemiBold', fontSize: 14.5, lineHeight: 21 },
  strong: { fontFamily: 'Geist_600SemiBold' },
  em: { fontStyle: 'italic' },
  u: { textDecorationLine: 'underline' },
  s: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
  quote: { borderLeftWidth: 2, paddingLeft: 12 },
  rule: { height: StyleSheet.hairlineWidth, width: '100%' },
  listItem: { flexDirection: 'row', gap: 8 },
  marker: { fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 21, minWidth: 14 },
  listItemBody: { flex: 1, gap: 4 },
  nestedList: { marginTop: 4, gap: 4 },
});
