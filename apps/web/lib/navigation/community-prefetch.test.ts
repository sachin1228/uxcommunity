import assert from "node:assert/strict";
import test from "node:test";

import { prefetchCommunityRoute } from "./community-prefetch";

test("a community hover prefetches only the router route", () => {
  const prefetched: string[] = [];
  prefetchCommunityRoute((href) => prefetched.push(href), "community-1");

  assert.deepEqual(prefetched, ["/dashboard/communities/community-1"]);
});

test("sweeping many rows issues only route prefetches, one per row", () => {
  const prefetched: string[] = [];
  const prefetch = (href: string) => prefetched.push(href);

  for (const id of ["a", "b", "c", "d", "e"]) prefetchCommunityRoute(prefetch, id);

  assert.deepEqual(prefetched, [
    "/dashboard/communities/a",
    "/dashboard/communities/b",
    "/dashboard/communities/c",
    "/dashboard/communities/d",
    "/dashboard/communities/e",
  ]);
  assert.equal(
    prefetched.some((href) => href.includes("/bootstrap")),
    false,
    "hover must never request a community bootstrap",
  );
});
