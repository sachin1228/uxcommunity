import assert from "node:assert/strict"
import test from "node:test"

import type { FeedItem } from "@/components/feeds/types";
import { filterLibraryItems } from "./library-filter";

/** Minimal shelf cards — the filter only reads `_type`, category and poll. */
function thread(id: string, category: string, poll: unknown = null): FeedItem {
  return { _type: "thread", id, category, poll } as unknown as FeedItem;
}
function showcase(id: string, category: string): FeedItem {
  return { _type: "showcase", id, category } as unknown as FeedItem;
}
function resource(id: string, resourceType: string): FeedItem {
  return { _type: "resource", id, resource_type: resourceType } as unknown as FeedItem;
}
function event(id: string): FeedItem {
  return { _type: "event", id } as unknown as FeedItem;
}

const shelf: FeedItem[] = [
  thread("t-question", "question"),
  thread("t-idea-poll", "idea", { question: "Which tool?", options: ["A", "B"] }),
  thread("t-discussion", "discussion"),
  showcase("s-ui", "ui_design"),
  showcase("s-motion", "motion_design"),
  resource("r-figma", "figma"),
  resource("r-article", "article"),
  event("e-meetup"),
];

const ids = (items: FeedItem[]) => items.map((item) => item.id);

test("all keeps every card of the kind only", () => {
  assert.deepEqual(
    ids(filterLibraryItems(shelf, "thread", "all")),
    ["t-question", "t-idea-poll", "t-discussion"],
  );
  assert.deepEqual(
    ids(filterLibraryItems(shelf, "showcase", "all")),
    ["s-ui", "s-motion"],
  );
  assert.deepEqual(
    ids(filterLibraryItems(shelf, "resource", "all")),
    ["r-figma", "r-article"],
  );
});

test("a thread category chip matches that category and nothing else", () => {
  assert.deepEqual(
    ids(filterLibraryItems(shelf, "thread", "discussion")),
    ["t-discussion"],
  );
});

test("the poll chip selects poll threads of any category", () => {
  assert.deepEqual(
    ids(filterLibraryItems(shelf, "thread", "poll")),
    ["t-idea-poll"],
  );
});

test("showcase and resource chips match their own vocabulary", () => {
  assert.deepEqual(
    ids(filterLibraryItems(shelf, "showcase", "motion_design")),
    ["s-motion"],
  );
  assert.deepEqual(
    ids(filterLibraryItems(shelf, "resource", "figma")),
    ["r-figma"],
  );
});

test("a chip from another kind's vocabulary matches nothing", () => {
  assert.deepEqual(filterLibraryItems(shelf, "thread", "figma"), []);
  assert.deepEqual(filterLibraryItems(shelf, "resource", "question"), []);
  assert.deepEqual(filterLibraryItems(shelf, "showcase", "poll"), []);
});

test("the event tab is a placeholder and always empty", () => {
  assert.deepEqual(filterLibraryItems(shelf, "event", "all"), []);
});
