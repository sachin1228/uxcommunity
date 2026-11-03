import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement, createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

type MessageListComponent = typeof import("./MessageList").MessageList;
type Props = ComponentProps<MessageListComponent>;
let MessageList: MessageListComponent;

before(async () => {
  const require = createRequire(import.meta.url);
  // Keep the actual timeline/render gates; isolate the leaf bubbles and images.
  const leaves: Record<string, string> = {
    "@/components/ui/Spinner": "export const Spinner = () => null;",
    "./MessageBubble": "export const MessageBubble = ({ msg }) => msg.content;",
    "./UnreadDivider": "export const UnreadDivider = () => null;",
    "./ThreadNotificationBubble": "export const ThreadNotificationBubble = ({ event }) => event.title;",
    "./ContentNotificationBubble": "export const ContentNotificationBubble = ({ event }) => event.title;",
    "./DisappearingNotice": "export const DisappearingNotice = () => null;",
    "./chatUtils": "export const fmtDate = date => date.slice(0, 10);",
    "../CommunityDp": "export const CommunityDp = () => null;",
  };
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./MessageList.tsx", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic",
    plugins: [{ name: "timeline-leaves", setup(builder) {
      builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, ({ path }) => ({ path: pathToFileURL(require.resolve(path)).href, external: true }));
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in leaves ? { path, namespace: "leaf" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "leaf" }, ({ path }) => ({ contents: leaves[path], loader: "js" }));
    } }],
  });
  const timeline = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  MessageList = timeline.MessageList;
});

function render(overrides: Partial<Props> = {}) {
  const noop = () => {};
  return renderToStaticMarkup(createElement(MessageList, {
    grouped: [], threadEvents: [], contentEvents: [], currentUserId: "viewer",
    firstUnreadMsgId: null, unreadDisplayCount: 0,
    unreadDividerRef: createRef<HTMLDivElement>(), topSentinelRef: createRef<HTMLDivElement>(), bottomRef: createRef<HTMLDivElement>(),
    initialPositionResolved: true, loading: false, loadingOlder: false, hasMoreAbove: false,
    displayCommunity: { id: "room", name: "Designers", type: "user", image_url: null },
    communityId: "room", highlightedMsgId: null,
    onReplyClick: noop, onCancelSend: noop, onRetrySend: noop, onReaction: noop, onReply: noop,
    onEdit: noop, onCopy: noop, onDelete: noop, onImageClick: noop,
    ...overrides,
  }));
}

test("confirmed empty messages show a ready welcome without waiting for activity history", () => {
  const html = render();
  assert.match(html, /Welcome to/);
  assert.match(html, /Say hello to the community/);
  assert.doesNotMatch(html, /Be the first/);
  assert.match(html, /data-chat-ready="true"/);
  assert.match(html, /visibility:visible/);
});

test("the welcome still waits for the initial message response", () => {
  const html = render({ loading: true });
  assert.match(html, /aria-label="Loading messages"/);
  assert.doesNotMatch(html, /Welcome to|data-chat-ready="true"/);
});

test("the timeline stays hidden until its initial position is resolved", () => {
  const html = render({ initialPositionResolved: false });
  assert.match(html, /data-chat-ready="false"/);
  assert.match(html, /visibility:hidden/);
});

test("late activity cards replace the welcome without another loading state", () => {
  const html = render({ contentEvents: [{
    id: "post", community_id: "room", user_id: "author", kind: "showcase", title: "A design update",
    created_at: "2026-11-03T00:00:00Z", users: { name: "Designer", avatar_url: null },
  }] });
  assert.match(html, /A design update/);
  assert.doesNotMatch(html, /Welcome to|Loading messages/);
  assert.match(html, /data-chat-ready="true"/);
});
