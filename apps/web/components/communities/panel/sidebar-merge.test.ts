import assert from "node:assert/strict";
import { test } from "node:test";
import type { CachedSidebarCommunity } from "@/lib/communities/cache";
import { mergeStaleServerList } from "./sidebar-merge";

type Community = CachedSidebarCommunity;

function community(
  id: string,
  name: string,
  lastMessageAt: string | null,
  overrides: Partial<Community> = {},
): Community {
  return {
    id,
    name,
    type: "interest",
    image_url: null,
    member_count: 2,
    message_count: 0,
    joined_at: "2026-07-01T00:00:00Z",
    last_message: lastMessageAt
      ? {
          id: `${id}-msg`,
          content: `msg-${lastMessageAt}`,
          created_at: lastMessageAt,
          user: { name: "john" },
        }
      : null,
    ...overrides,
  };
}

// The exact repro from the bug report: the server snapshot predates john's
// 2:08 PM message to Accessibility (realtime applied it client-side only),
// while every other community's preview matches.
const STALE_SERVER_LIST: Community[] = [
  community("illustration", "Illustration", "2026-09-14T14:05:00Z"),
  community("senior", "Senior designers", "2026-09-14T14:05:30Z"),
  community("industrial", "Industrial Design", "2026-09-14T14:05:10Z"),
  community("general", "General", "2026-09-14T14:04:00Z"),
  community("accessibility", "Accessibility", "2026-09-14T13:05:00Z", {
    message_count: 1, // server still counts the unread 2:08 message
  }),
];

const LOCAL_REALTIME_LIST: Community[] = [
  community("accessibility", "Accessibility", "2026-09-14T14:08:00Z", {
    message_count: 0, // optimistic badge zero on open
  }),
  community("illustration", "Illustration", "2026-09-14T14:05:00Z"),
  community("senior", "Senior designers", "2026-09-14T14:05:30Z"),
  community("industrial", "Industrial Design", "2026-09-14T14:05:10Z"),
  community("general", "General", "2026-09-14T14:04:00Z"),
];

test("stale server replay does not demote realtime-newer activity", () => {
  const merged = mergeStaleServerList(LOCAL_REALTIME_LIST, STALE_SERVER_LIST);

  const accessibility = merged.find((c) => c.id === "accessibility")!;
  assert.equal(
    accessibility.last_message?.created_at,
    "2026-09-14T14:08:00Z",
    "the 2:08 PM last_message must survive the merge",
  );
  assert.equal(
    merged[0]?.id,
    "accessibility",
    "Accessibility must remain pinned at the top",
  );
  // Server-authoritative counters still come from the server row.
  assert.equal(accessibility.message_count, 1);
});

test("genuinely newer server data still wins", () => {
  const server = [
    community("a", "A", "2026-09-14T15:00:00Z", { message_count: 3 }),
  ];
  const local = [community("a", "A", "2026-09-14T14:00:00Z")];
  const merged = mergeStaleServerList(local, server);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.last_message?.created_at, "2026-09-14T15:00:00Z");
  assert.equal(merged[0]?.message_count, 3);
});

test("locally-known communities missing from the server snapshot are kept", () => {
  const server = [community("a", "A", "2026-09-14T14:00:00Z")];
  const local = [
    community("a", "A", "2026-09-14T14:00:00Z"),
    community("b", "B", "2026-09-14T14:30:00Z"), // joined after the snapshot
  ];
  const merged = mergeStaleServerList(local, server);
  assert.deepEqual(merged.map((c) => c.id), ["b", "a"]);
});

test("newer locally-known reaction preview is preserved", () => {
  const server = [
    community("a", "A", "2026-09-14T14:00:00Z", { lastReaction: null }),
  ];
  const local = [
    community("a", "A", "2026-09-14T14:00:00Z", {
      lastReaction: {
        messageId: "m1",
        emoji: "👍",
        createdAt: "2026-09-14T14:01:00Z",
        firstName: "John",
        isOwn: false,
        messagePreview: '"hi"',
      },
    }),
  ];
  const merged = mergeStaleServerList(local, server);
  assert.equal(merged[0]?.lastReaction?.emoji, "👍");
});

test("empty local list just returns the server list", () => {
  const merged = mergeStaleServerList([], STALE_SERVER_LIST);
  assert.equal(merged, STALE_SERVER_LIST);
});

test("a locally cached content preview without an author name is healed from the server", () => {
  // Regression: a last_content cached before the server started sending
  // author_name (no firstName) would win the merge forever and render
  // "Someone created a thread" even after the fix shipped.
  const staleLocal = [
    community("a", "A", "2026-09-14T14:00:00Z", {
      last_content: {
        id: "t1",
        kind: "thread",
        title: "Design systems",
        created_at: "2026-09-14T13:59:00Z",
        firstName: null,
      },
    }),
  ];
  const server = [
    community("a", "A", "2026-09-14T14:00:00Z", {
      last_content: {
        id: "t1",
        kind: "thread",
        title: "Design systems",
        created_at: "2026-09-14T13:59:00Z",
        firstName: "sachin",
      },
    }),
  ];
  const merged = mergeStaleServerList(staleLocal, server);
  assert.equal(merged[0]?.last_content?.firstName, "sachin");
});

test("a realtime content preview with a name is not clobbered by an older server row", () => {
  const server = [
    community("a", "A", "2026-09-14T14:00:00Z", {
      last_content: {
        id: "t0",
        kind: "showcase",
        title: "Old post",
        created_at: "2026-09-14T13:00:00Z",
        firstName: "john",
      },
    }),
  ];
  const local = [
    community("a", "A", "2026-09-14T14:00:00Z", {
      last_content: {
        id: "t1",
        kind: "thread",
        title: "Brand new thread",
        created_at: "2026-09-14T13:59:00Z",
        firstName: "sachin",
      },
    }),
  ];
  const merged = mergeStaleServerList(local, server);
  assert.equal(merged[0]?.last_content?.id, "t1");
  assert.equal(merged[0]?.last_content?.firstName, "sachin");
});
