# Stage 4 — Performance Optimization Report

**Date:** 2026-11-06
**Branch:** `performance/stage-4-optimization`
**Base:** `main` @ `0583d2b9`
**Scope:** AUD-P1 through AUD-P7 from the Stage 4 brief.
**Constraint:** No production database, infrastructure, credentials or deployment was touched. All measurements are from the isolated local stack; nothing was merged or deployed.

---

## 1. Executive summary

Five of the seven areas needed code or database changes; two were already implemented and are documented with the evidence that led to that conclusion. The largest measured win is the home feed: a page that took **365 ms** on a 130k-card synthetic dataset now takes **31 ms**, and deep pagination dropped from **401 ms to 3.3 ms**.

| Area | Status | Headline |
|---|---|---|
| **AUD-P1** Chat duplicate bootstrap / metadata | **PARTIALLY FIXED** | In-flight dedupe and the 15-minute bootstrap cache were already present. The chat no longer depends on a full read model on every open: member count, role, owner and mute state now ride the existing two-row snapshot; ordinary members never issue the extra metadata read, while managers load grants only to keep their moderation controls. |
| **AUD-P2** Home-feed full scans | **FIXED** | Per-branch page bounds, correct `(created_at, id)` keyset cursor, and global/partial `(created_at, id)` indexes. Page 1: 365 → 31 ms; page 5: 401 → 3.3 ms. |
| **AUD-P3** Sidebar unread counts | **ALREADY OPTIMIZED** | One batched SQL projection (`get_sidebar_activity`), client cache + in-flight dedupe, bounded refetch/polling, per-community `LIMIT 1` laterals. A containment rewrite and extra covering indexes were measured and reverted because they did not improve the count (median 76 ms before vs 91 ms after; covering index made no measurable difference). |
| **AUD-P4** RSVP concurrency | **FIXED** | Database trigger locks the event row and enforces capacity atomically; the route uses an idempotent upsert, explicit join/leave intent, and `COUNT(*)` instead of transferring every RSVP row. Six concurrent requests for two seats leave exactly two rows. |
| **AUD-P5** Member search indexing | **FIXED** | `pg_trgm` GIN index on `users.name`; search terms escape `%`, `_` and `\` so wildcards are literal. No-match search: 9.5 → 2.1 ms; matching search: 18.0 → 8.9 ms. |
| **AUD-P6** Image optimization | **PARTIALLY FIXED** | Avatars and community DPs on R2/Supabase now go through the existing Next image optimizer at their rendered size; unknown hosts keep the plain `<img>`. A 400px sample avatar (53,290 B) became 294 B at 48px and 1,437 B at 96px in the local page. Mobile avatars gained memory-disk caching and a recycling key. No new image service was introduced. |
| **AUD-P7** Chat / DM virtualization | **PARTIALLY FIXED** | Mobile chat and DM lists were already `FlatList`-virtualized. The web DM conversation list now mounts a fixed-row window (visible + overscan) instead of all 200 rows; web message timelines keep all rows addressable but skip off-screen day groups with CSS `content-visibility`. Full variable-height windowing of message bubbles was deliberately not attempted. |

---

## 2. Measurement setup

All database numbers come from the isolated local stack (PostgreSQL 17.11), never production.

- Synthetic dataset inserted inside a transaction and rolled back:
  - 200 users, 10 communities, 20,003 memberships
  - 60,000 threads, 20,000 events, 30,000 resources, 20,000 showcase posts
  - 100,000 community messages (50,001 unread for the viewer)
- The baseline was captured before the new migrations were applied; the after run used the same seed and `EXPLAIN (ANALYZE, BUFFERS)` on the same function calls.
- Three after runs were taken; medians are reported.
- The browser measurement used a fresh Playwright context against the local Next dev server, a seeded member with 120 messages in the room, and `community-chat-ready` as the readiness mark.
- The image measurement used a 400×400 photo-like WebP in the local R2 emulator and the app's real `_next/image` endpoint.

---

## 3. Findings

### AUD-P1 — Community chat duplicate bootstrap / metadata

**Original problem.** Opening a community chat can trigger duplicate bootstrap/API requests and unnecessary metadata reads.

**Root cause and evidence.**

- The duplicate request itself was already fixed before this stage:
  - `lib/request-cache.ts` deduplicates identical in-flight GETs and caches the bootstrap for 15 minutes.
  - `fetchAndHydrateCommunityBootstrap` hydrates the canonical `/api/communities/[id]`, `/messages`, and section keys from one response.
  - Request-cache tests already cover concurrent bootstrap-backed reads, StrictMode-style remounts, failed revalidations and partial snapshots.
- The remaining avoidable work was a **full read model on every chat open**, because `useChatData` always called `fetchMeta()` after first paint. That read carries members, About, rules and grants, and its results were only needed by the right rail/management UI, not by the chat itself.

**What changed.**

- `loadCommunityChatReadModel` now selects `member_count`, `owner_id`, `role`, `notifications_muted` and `notifications_muted_until` on the same two rows it already read. The snapshot still performs **exactly two queries**; the existing test that guards that invariant was extended, not weakened.
- `useChatData` no longer calls `fetchMeta()` after a successful open.
- The chat header now shows the member count and mute state from the snapshot, and the owner role is resolved from `owner_id` on the same row.
- The full read model is loaded on demand:
  - owner/admin/moderator (manager tier) loads it after first paint so chat moderation controls keep working;
  - leaving the Chat tab (Members, Activity, Threads, Showcase, Events or Resources) loads it when opened;
  - the settings button loads it before opening a half-filled form;
  - the header menu's existing "load details" affordance still works.
- Ordinary members never pay for the extra read.

**Before/after.**

- Baseline (code path): one bootstrap + the chat's own full read model; the right rail also requested the same URL, so the request cache usually collapsed them into one network request on desktop.
- After: one bootstrap (22,349 B in the measured room) + one right-rail metadata request (1,306 B) on desktop. On narrow layouts without the right rail, the full read is no longer part of opening the chat at all.
- Browser sample: visible chat ready in **858 ms**; the measured room issued the bootstrap, the right-rail sections (`content-latest`, `rules`, `requests`), the timeline-card section, one empty catch-up page, one older page (the room opened at the first unread), and the right-rail metadata. No duplicate bootstrap was observed.

**Tests.** `lib/communities/chat-read-model.test.ts` now proves the snapshot is still exactly two queries, that the header fields ride on them, and that the owner role needs no second read. The full web suite passes.

**Remaining risk.** The right rail still needs its full read on desktop; that is a deliberate data dependency, not an accidental duplicate. Mobile/narrow web avoids it.

---

### AUD-P2 — Home-feed database full scans

**Original problem.** The feed RPC unioned four tables, sorted the entire union, then applied `LIMIT`; two content tables had no global created-at index; and the cursor was timestamp-only while the total order was `(created_at, id)`.

**Root cause.** `candidates` was `UNION ALL` of four unbounded table scans with one outer `ORDER BY … LIMIT`. Events/resources had no global `(created_at, id)` index at all; the showcase public index omitted `id`. A page boundary with equal timestamps could skip rows on the next page.

**What changed.**

- Each content branch is now bounded to the page size before the UNION. The union carries `(created_at, id)` and the outer sort receives at most eight small pages.
- The `all` scope is split into a joined-communities branch and a public branch per table instead of an `OR` that defeated the partial public indexes. The two branches are disjoint and preserve the existing scope semantics.
- New 5-argument `get_home_feed_page(p_user_id, p_before, p_before_id, p_limit, p_scope)` with the id half of the cursor. The predicate keeps the old timestamp-only behaviour when `p_before_id` is null.
- The old 4-argument overload is left in place for older clients.
- New indexes:
  - `community_threads (created_at DESC, id DESC)`
  - `community_showcase_posts (created_at DESC, id DESC)`
  - `community_events (created_at DESC, id DESC)`
  - `community_resources (created_at DESC, id DESC)`
  - partial `(created_at DESC, id DESC) WHERE is_public AND community_id IS NOT NULL` for events, resources and showcase.
- The route and load-more link now carry `before_id`; a shared `home-feed-cursor` helper validates both halves.
- The dashboard's home-feed stale window now uses the shared 60-second dashboard value instead of an inconsistent 30 seconds.

**Before/after (local synthetic, 130k content rows).**

| Query | Before | After | Improvement |
|---|---:|---:|---|
| Home feed page 1 | 365.2 ms | 30.9 ms | ~11.8× |
| Home feed page 5 (cursor) | 401.1 ms | 3.3 ms | ~121× |

The plan now uses the global `(created_at, id)` indexes for the joined-community branches and the partial public indexes for the public branches, with each branch stopping after its page bound.

**Tests.** `supabase/tests/home_feed_pagination.test.sql` (11 assertions) covers equal-timestamp pagination, the final empty page, the legacy 4-argument overload, and every new index. `lib/feeds/home-feed-cursor.test.ts` covers cursor parsing and URL construction.

**Remaining risk.** The final projection still uses `to_jsonb(t)` plus per-row count/exists subqueries. That is bounded by the page size (12 rows) and was not the dominant cost after the branch bounds; narrowing the projection would be a larger payload-contract change and is left for a future stage.

**Deployment note.** Apply the migration before deploying the app build that sends `before_id`; the new overload is additive, but the server code intentionally calls the 5-argument version.

---

### AUD-P3 — Sidebar unread-count queries

**Status: ALREADY OPTIMIZED.**

**Evidence.**

- `get_sidebar_activity` is a single SQL projection for every joined community: one row per membership, with `LIMIT 1` laterals for the newest message/reaction/content and grouped `COUNT(*)` for unread. There is no per-community request and no N+1 in Node.
- `useSidebarCommunities` is cache-first (60-second window), shares in-flight requests, and only polls when the member has more than the 15-community realtime cap.
- Realtime increments are applied locally; opening a chat optimistically clears the row while the read manager debounces the write.
- The DM equivalents are also batched RPCs (`get_dm_conversations`, `get_dm_unread_total`).
- Existing `supabase/tests/sidebar_scan_bounds.test.sql` pins the watermark semantics, previews and indexes.

**Measured.** 50,001 unread messages across three communities: **55.0 ms** for the whole sidebar projection. The cost scales with unread volume, not with community count.

**Experiments rejected.**

- Replacing `jsonb_array_elements` mention matching with `@>` containment made the query slower in local measurements (median 91 ms vs 76 ms), even after hoisting the needle into a CTE.
- Added covering `community_messages` and `dm_messages` indexes made no measurable difference to the count on the synthetic data (the planner still read the heap for visibility/other filters) and would add write cost. Both experiments were reverted; no unusable index or slower query shipped.

**Remaining risk.** A member who never opens a very busy room pays an exact `COUNT(*)` over the unread range. A maintained counter would fix that at the cost of correctness work on every message insert/delete/read-clear path; it is not justified without production evidence of the unread volume.

---

### AUD-P4 — RSVP concurrency

**Original problem.** The route read the attendee count, then inserted. Concurrent requests all saw "not full" and could exceed capacity; a duplicate insert returned a 500; counts were built by transferring every RSVP row.

**What changed.**

- Migration `20261106150000_event_rsvp_capacity.sql`:
  - `enforce_event_rsvp_capacity()` takes `FOR UPDATE` on the event row, then counts committed RSVPs and raises `EVENT_CAPACITY_REACHED` (`P0001`) when full.
  - The trigger first returns early for an existing `(event_id, user_id)` row, so an idempotent `ON CONFLICT DO NOTHING` re-join is accepted even when the event is full and adds no attendee.
  - `idx_event_rsvps_event_created (event_id, created_at)` serves attendee previews; the old `(event_id)` index could not order by time.
- Route:
  - "Going" is `upsert(..., { onConflict: "event_id,user_id", ignoreDuplicates: true })`, so a double-tap, lost response or undo-toast restore cannot flip the state.
  - Clients may send `action: "join" | "leave"`; older clients keep the toggle contract.
  - A `P0001` capacity error returns 409 with the authoritative count and limit; a `23505` from a database without the trigger is treated as already joined.
  - Counts use `COUNT(*)` (`head: true`) instead of selecting every row.
  - Notification/realtime publish only on an actual insert; chat join side effects remain idempotent and also repair a missing room membership on a re-join.
- Web `EventCard` sends explicit intent and adopts the 409 count; mobile `sendEventRsvp` accepts and sends the same intent.

**Tests.** `supabase/tests/event_rsvp_capacity.test.sql` (7 assertions) races six real psql sessions for two seats, then verifies: exactly two rows, idempotent re-join, a plain insert past capacity rejected with `P0001`, cancellation freeing a seat, and no duplicate attendee. The SQL test harness now exports the disposable database's `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` so concurrent-session tests are self-contained.

**Remaining risk.** Capacity changes (lowering `max_attendees`) are still allowed below current attendance; existing rows are not evicted. This preserves current business behaviour and was not changed.

---

### AUD-P5 — Community member search

**Original problem.** `users.name ILIKE '%term%'` had no supporting index; every search scanned the community's memberships and every profile. `%` and `_` were treated as wildcards.

**What changed.**

- `CREATE INDEX idx_users_name_trgm ON users USING gin (name gin_trgm_ops)` (`pg_trgm` was already installed).
- Both `get_community_members_page` and the admin twin escape the search term (`\` → `\\`, `%` → `\%`, `_` → `\_`) and use `ILIKE … ESCAPE '\'`. Wildcards are now literal; normal names behave the same.
- No response-shape or relevance/order change.

**Before/after (local synthetic, 20k members in one community).**

| Search | Before | After |
|---|---:|---:|
| No match | 9.5 ms | 2.1 ms |
| `sharma` (match) | 18.0 ms | 8.9 ms |

The filtered path can now use the trigram GIN index instead of a sequential membership scan.

**Tests.** `supabase/tests/member_search.test.sql` (9 assertions) verifies the index, normal search and total, literal `%` and `_`, the unfiltered roster/total, and the admin twin.

**Remaining risk.** Pagination remains `LIMIT/OFFSET`; very deep member pages still re-walk skipped rows. Member browsing is page-0-heavy and a keyset refactor was not justified by measurements.

---

### AUD-P6 — Image optimization

**Original problem.** Every avatar and community DP was a raw `<img>` at its original upload size; a 24px sidebar face downloaded the full 400px avatar. No Next image usage existed for R2 media.

**What changed.**

- `next.config.js` derives a `remotePatterns` entry from `R2_PUBLIC_URL` and exposes the public origin to client components as `NEXT_PUBLIC_R2_PUBLIC_URL` (public media, not a credential). The existing Cloudflare `IMAGES` binding and Next optimizer are reused; no new service was introduced.
- `AvatarImg` and `CommunityDp` now use `next/image` when the URL is on the configured R2 or Supabase public-storage origin, with `width`/`height`/`sizes` matched to the rendered size. Unknown hosts, relative paths and data URLs keep the plain `<img>` fallback.
- Above-the-fold faces (chat header DP) load with `priority`; avatars keep lazy loading by default.
- Mobile `PersonAvatar` now uses `cachePolicy="memory-disk"` and `recyclingKey`, so list recycling does not re-download or show the previous member's face.

**Measured (local R2 emulator, real `_next/image` endpoint).**

| Variant | Bytes |
|---|---:|
| Original 400×400 WebP | 53,290 |
| 96px optimized (2× a 48px face) | 1,437 |
| 48px optimized (2× a 24px face) | 294 |
| Page-captured sidebar/topbar variants | 78 B (32px), 294 B (48px) |

The sample is synthetic, but the ratio is representative of a real photo-like avatar; the optimizer caches each variant at the edge.

**Tests.** `lib/images/remote-image.test.ts` covers R2, Supabase public storage, signed paths, unknown hosts, relative paths and data URLs. The production build succeeds with the new config.

**Remaining risk.** Existing images are not re-uploaded as smaller variants; they are resized on delivery by the optimizer. Unknown hosts still serve full-size originals. Verify the production R2 hostname is present in the built `remotePatterns` and monitor Cloudflare image-transformation volume/cost after deploy. No private R2 URL is affected: only public avatar/DP URLs take this path.

---

### AUD-P7 — Chat and DM virtualization

**Original problem.** Long chat/DM lists can render every loaded row.

**What was already true.**

- The mobile app uses `FlatList` for community messages, DM messages and DM conversation lists; those lists are already windowed by React Native.
- Web message bubbles are memoized and pages are bounded (50-message pages, bounded catch-up passes), so ordinary rooms never render thousands of rows.

**What changed.**

- **Web DM conversation list** (`DmListPane`): fixed 60px rows are now windowed to the visible viewport plus five rows of overscan above and below, with exact spacers preserving the scrollbar. With 200 conversations, the mounted row count is roughly 25 instead of 200. The active row is scrolled into view when selection changes.
- **Web message timelines** (`MessageList`, `DmMessageList`): each date group gets CSS `content-visibility: auto` with `contain-intrinsic-size: auto 160px`. Off-screen groups keep their rows addressable (reply jumps, scroll anchoring) but the browser skips their layout, style and paint work; the `auto` keyword remembers the real size after first render.
- The existing variable-height scroll anchor, unread divider and prepend-compensation logic is untouched.

**Tests.** `lib/virtual/virtual-window.test.ts` covers empty lists, the first viewport, deep scroll, end clamping and unmeasured viewports.

**Remaining risk.** Web message bubbles are still in the DOM inside `content-visibility` groups; this is not a full variable-height windowing library. A full virtualization rewrite was deliberately avoided because the current anchor logic (`useMessageListAnchor`) depends on DOM presence and measured positions, and the task requires preserving scroll position, unread markers, reply jumps and image-loading stability. Staging should explicitly test a long room with images: scroll to the top, load older pages, jump to a reply, and return to the bottom.

---

## 4. Database changes

| Migration | Purpose |
|---|---|
| `20261106140000_home_feed_performance.sql` | Global/partial `(created_at, id)` indexes; bounded UNION branches; 5-argument compound-cursor RPC; grants. |
| `20261106150000_event_rsvp_capacity.sql` | Event-row-locking capacity trigger; idempotent re-join guard; `(event_id, created_at)` index. |
| `20261106160000_member_search_index.sql` | `users.name` trigram GIN index; escaped search in member and admin member RPCs. |

No production migration was run, no production data was read or modified, and no RLS/auth policy was weakened.

---

## 5. Tests executed

| Check | Result |
|---|---|
| Web `tsc --noEmit` | Pass |
| Full web unit suite (`*.test.ts`, `APP_ENV=production`) | **1,192 / 1,192 pass** |
| Mobile `tsc --noEmit` | Pass |
| Mobile communities suite | 89 / 89 |
| Mobile content-actions suite | 16 / 16 |
| Mobile chat-open suite | 17 / 17 |
| SQL: home-feed pagination | 11 / 11 |
| SQL: RSVP capacity / concurrency | 7 / 7 |
| SQL: member search | 9 / 9 |
| Fresh-schema migration run | Pass; 86 application tables empty; no unexpected drift |
| Web production build | Pass |
| Comment audit | Pass after tracking the new files |
| ESLint on changed files | No new errors; the touched files retain pre-existing advisory findings (`set-state-in-effect` warnings and one unescaped entity in `EventCard`) |

---

## 6. Files changed

**Web**
- `apps/web/app/api/home/feed/route.ts`
- `apps/web/app/api/communities/[id]/events/[eventId]/rsvp/route.ts`
- `apps/web/app/dashboard/HomeFeed.tsx`, `apps/web/app/dashboard/page.tsx`
- `apps/web/components/ui/AvatarImg.tsx`
- `apps/web/components/communities/CommunityDp.tsx`
- `apps/web/components/communities/CommunityChat.tsx`
- `apps/web/components/communities/chat/ChatHeader.tsx`
- `apps/web/components/communities/chat/MessageList.tsx`
- `apps/web/components/communities/chat/useChatData.ts`
- `apps/web/components/communities/events/EventCard.tsx`
- `apps/web/components/direct-messages/DmListPane.tsx`
- `apps/web/components/direct-messages/DmMessageList.tsx`
- `apps/web/lib/communities/chat-read-model.ts` + test
- `apps/web/lib/feeds/home-feed-cursor.ts` + test (new)
- `apps/web/lib/home/home-feed-server.ts`
- `apps/web/lib/images/remote-image.ts` + test (new)
- `apps/web/lib/virtual/virtual-window.ts` + test (new)
- `apps/web/lib/supabase/performance-rpcs.ts`
- `apps/web/lib/supabase/database.types.ts`
- `apps/web/next.config.js`

**Mobile**
- `expo-app-standalone 3/components/PersonAvatar.tsx`
- `expo-app-standalone 3/components/community/contentView.tsx`
- `expo-app-standalone 3/lib/communityContent.ts`

**Database / CI**
- `supabase/migrations/20261106140000_home_feed_performance.sql` (new)
- `supabase/migrations/20261106150000_event_rsvp_capacity.sql` (new)
- `supabase/migrations/20261106160000_member_search_index.sql` (new)
- `supabase/tests/home_feed_pagination.test.sql` (new)
- `supabase/tests/event_rsvp_capacity.test.sql` (new)
- `supabase/tests/member_search.test.sql` (new)
- `scripts/db/test_fresh.py` (export the disposable PG connection for concurrent-session tests)
- `.github/workflows/database.yml` (run the three new SQL suites)

---

## 7. Remaining risks and staging validation

1. **Apply the three migrations before the web build that sends `before_id`.** The new feed RPC overload is additive, but the server calls the 5-argument form.
2. **Staging chat run:** open a community as a regular member and as a moderator. Confirm the header member count/mute state, moderator delete controls, Members/Activity tabs and the settings form all behave; the regular member should not issue the full read model, the manager should.
3. **Staging feed run:** load several pages through a boundary with equal timestamps, then verify no card is skipped or duplicated; check `Server-Timing` and the new index usage with `EXPLAIN (ANALYZE)`.
4. **Staging RSVP run:** two accounts, one event with a small capacity, concurrent join attempts; verify 409 on the loser, no over-capacity row, cancel/rejoin, and the group-chat membership.
5. **Staging image run:** confirm the production R2 hostname is in the built `remotePatterns`, avatars/DPs render through `/_next/image`, an unknown-host avatar still renders through the plain `<img>` fallback, and Cloudflare image-transformation usage is within expectations.
6. **Staging long-chat run:** a room with hundreds of messages and images; verify scroll anchoring when loading older pages, jumping to a reply, the unread divider, and the DM list's windowed scrollbar.
7. **Sidebar unread counts** are intentionally unchanged; if production telemetry shows very large unread ranges, revisit a maintained counter as a separate, correctness-first project.
