# Web vs Mobile — Feed, Posts & Content Interactions (raw parity notes)

Audit date: 2026-10. Web app = `apps/web` (Next.js App Router). Mobile = `expo-app-standalone 3/` (Expo Router, React Native). Realtime worker = `apps/realtime` (Cloudflare Durable Objects). All behavior below was read from source (no servers run, no DB queried). Line citations are `path/file.ts:LINE`.

Terminology used throughout:
- **card kinds** = `thread` / `event` / `resource` / `showcase` (the `_type` discriminator on every feed payload; `apps/web/lib/feeds/feed-items.ts:13-18`).
- **scope** = the communityId slug in API URLs; the literal `"public"` is a legacy content scope (`apps/web/lib/content-scope.ts:1-5`), not a community.

---

## Feature table

| Feature | Web pages | API endpoints (method path) | Auth/roles | Key business rules & edge cases | Realtime | Mobile-relevant constraints | Suggested mobile priority |
|---|---|---|---|---|---|---|---|
| Home feed — two source tabs | `/dashboard` (`app/dashboard/page.tsx`, `DashboardHome.tsx`, `HomeFeedFilters.tsx`, `HomeFeed.tsx`) | `GET /api/home/feed?scope=public\|communities\|all&before=<ISO>` | Any session with role `user` (`requireSession("user", {verifyActive:false})`); admin never reaches `/dashboard` (layout redirects non-`user` roles to /login) | Two disjoint tabs: `public` = `is_public AND community NOT joined`; `communities` = every card of joined communities (incl. private); `all` = legacy, any public card (server default when param missing — the scope-less mobile call keeps this). Sort `created_at desc, id desc`. Cursor = `created_at` only (strict `<`, timestamp ties can skip). Limit ≤ 30. Server `unstable_cache` 10 s per (user, cursor, scope). | None (feed has no subscription; catches up on visibility return ≥ 5 s and remounts on tab switch) | Mobile `getHomeFeed()` sends no scope → legacy `all`; no scope tabs, no saved scope choice (web persists choice in localStorage key `uxcommunity:home-feed-scope`). | **P1 (scope tabs), P1 (card parity)** |
| Home feed — pagination/refresh/empty | same | same + `GET /api/profile/feed?scope=saved&before=` (saved) | same | `FEED_PAGE_SIZE = 30`; `hasMore = items.length >= 30`; load-more dedupes by id and keeps order; stale cache 30 s client-side; refresh = hidden-catch-up refetch (no pull on web); error state has no retry button on home (retry only on profile scope). Empty copy differs per scope. | None | Mobile already does keyset `?before=<last.created_at>` + pull-to-refresh; items with past events are filtered out client-side on web only (`showPastEvents=false`). | P2 |
| Post creation — thread | `CreateThreadModal` opened from community Threads tab (`ThreadsView.tsx:290`); edit via `EditThreadModal` | `POST /api/communities/{id}/threads`; `PATCH /api/communities/{id}/threads/{threadId}`; `POST .../upload` | Member of the community (403 otherwise, `threads/route.ts:105`). Edit/delete = author; delete also allowed to managers with `can_moderate_threads`. | Body: `title` ≤ 2000 (composer derives title from body, `threadShared.ts:48-50`), `category ∈ {question,discussion,idea,feedback}`, `tags` ≤ 3 (≤30 chars, `#` stripped), `links` ≤ 10 (http/https, deduped), `attachments` ≤ 5, optional `poll`, `allow_replies` (default true), `is_public` (default false). Poll: 2–6 options, question ≤ 200, option ≤ 100, unique options. Rate limit 10 creates/60 s. Creation budget: **3 posts/day** shared by thread+showcase+resource. Edit has **no time window**; poll votes are reset only if the option list changes; removed attachments are reclaimed from R2. | `threads:{communityId}` `thread` (create/update), chat `thread-insert`, chat `content-insert`, chat `thread-update`, chat `thread-delete` | Mobile composer exists (title/body, tags, images via multipart). **No poll UI**, no files (pdf/zip) picker parity, title is typed (web hides title, derives from body). | **P1 (non-poll parity), P2 (poll)** |
| Post creation — resource | `ResourceFormModal` (community Resources tab) | `POST /api/communities/{id}/resources`; `PATCH/DELETE .../resources/{resourceId}` | Member to create; author to edit; delete also `can_moderate_resources`. | `title` ≤ 120, `url` required ≤ 2048 http/https, `description` ≤ 2000, `resource_type ∈ {figma,article,tool,video,book,font,icon_pack,color,template,inspiration,other}`, `is_public`, `allow_replies` (default true). Rate limit 10/60 s. No attachments/cover on resources. Delete sends audit + author notification when moderated. | `resources:{communityId}` `resource`; chat `content-insert`/`content-delete`/`content-comment` | Mobile resource create/edit exists but sends `tags` (ignored server-side) and no link-preview fetch parity requirement. | P1 |
| Post creation — showcase | `CreateShowcaseModal` (community Showcase tab + edit from any feed card) | `POST /api/communities/{id}/showcase`; `PATCH/DELETE .../showcase/{postId}`; `POST .../showcase/upload` (image multipart OR video JSON finalize); `POST .../showcase/upload-ticket` (presigned video PUT) | Member to create; author to edit/PATCH; delete also `can_moderate_showcase`. | `title` ≤ 2000, `category` ∈ 11 fixed values (`showcase-categories.ts:8-20`), up to **5 media** of `image/jpeg|png|webp|gif` or `video/mp4|webm|quicktime`; images proxied as multipart ≤ **8 MB**; videos upload **direct to R2** (ticket = presigned PUT, 10-min expiry, key `media/videos/processed/{mediaId}{ext}`; finalize HEAD-verifies object, ≤ **50 MB**); cover = first image else `image_url`; poster only for videos. Rate limit 5/60 s. Editing cleans up replaced R2 objects. | Chat `content-insert`/`content-delete`; `showcase:{postId}` only for `comment`; like/save have **no** realtime publish | Mobile editor supports images only (via generic upload); **no video upload, no upload-ticket usage**. | **P2 (video), P1 (existing image parity)** |
| Post edit/delete — all kinds | cards menus (`ThreadCard`, `ResourceCard`, `ShowcaseOptionsMenu`, `EventOptionsMenu`) | `PATCH/DELETE` per kind (above) | Author always; managers via `can_*` permissions; public-scope (`"public"`) content = author only | DELETE returns 204; moderated delete writes `community_admin_activity` audit + `*_deleted` notification; admin removals snapshot into `content_removals` (undoable), member/manager deletes hard-delete media. | `thread`/`resource`/`event` room + chat delete topics | Works on mobile inside community tabs; home-feed cards on web delete showcase inline, mobile is read-only on home. | P2 |
| Likes / hearts | card heart buttons | `POST /api/communities/{id}/threads/{tid}/like` `{liked:boolean}`; `POST .../showcase/{postId}` `{action:"like"|"save", active}`; events `POST .../events/{eid}/like`; resource heart = `POST .../resources/{rid}/save` | Any authenticated user; **thread like/save/poll routes do not re-check membership** (only that the thread exists in this community); showcase interactions require member **or** post `is_public` | Toggle endpoints; upsert on conflict `(thread_id,user_id)` idempotent; thread like insert notifies author; response returns authoritative count (`{liked,count}` / `{active,count}` / `{saved,save_count}`). UI is optimistic (BooleanIntentCoalescer + dedupeFetch, rollback + inline error on failure). | `threads:{id}`/`events:{id}`/`resources:{id}` `like`/`save`; showcase like has none | Mobile has all toggles (`setContentAction`), optimistic coalescing, same endpoints. Card counters differ on web home (thread card shows like+comment, resource shows heart count; resource bookmark count only returned, not rendered on the card face). | P1 (already mostly done; verify resource heart vs bookmark) |
| Saves / bookmarks (semantics) | card ••• menu “Save/Unsave” | thread: `POST .../threads/{tid}/save`; showcase: same POST with `action:"save"`; event: `POST .../events/{eid}/save`; **resource Save = `POST .../resources/{rid}/bookmark`** | Auth similar to likes | **Verified in code: `resource_saves` = the heart (UI “Like”), `resource_bookmarks` = the ••• “Save” and is what the Saved page lists** (`20261010170000_profile_feed_saved_bookmarks.sql:1-25,76-80`; `20261015160000:79-96`; `ResourceCard.tsx` heart vs bookmark handlers). Saves/bookmarks publish nothing on realtime except resource save (`resources:{id}` `save`); resource bookmark has **no** realtime; thread save has **no** realtime/notification. | see above | Mobile `bookmark` action targets the same route; Saved page must list resources by `user_bookmarked`, threads/showcase/events by `user_saved`. | **P1** |
| Poll voting | inline thread card poll | `POST /api/communities/{id}/threads/{tid}/poll` `{option_index}` or `{action:"undo"}` | Any authenticated user (no member check) | One vote/user; vote change requires the one-time undo (409 “final…undo once”); re-voting same option is a no-op; undo once only (`undo_used`); totals recomputed server-side and returned `{counts,user_vote,undo_used}`. Threads list/feed attach `poll_vote_counts`, `poll_user_vote`, `poll_undo_used` per viewer. | `threads:{id}` `poll` `{event,thread_id,user_id,counts,user_vote,undo_used}` | **Missing on mobile entirely.** | P2 (P1 if polls are considered core) |
| Comments | `CommentSection` in thread/resource/showcase detail; community cards show count | `GET/POST /api/communities/{id}/{threads|resources|showcase}/{targetId}/comments`; `DELETE .../comments/{commentId}`; reactions `POST .../comments/{commentId}/reactions` | Read: public target = any user; private target = member. Post: member for private targets, non-members allowed on `is_public` threads/showcase; `allow_replies=false` → 403. Delete: **author only** (no moderator delete). | Max length: thread 5000 / resource 5000 / showcase **1000** chars; **one nesting level** (“Cannot reply to a reply.”); parent must belong to the target (404); 20 comments/60 s (showcase 15/60 s); reactions limited to 👍❤️🎉💡👏, 60/60 s; comments cannot be edited anywhere; deleting a parent cascades replies; author + parent-author notifications (threads/resources; showcase comments notify nobody — no `deferNotification` in showcase POST). Reply composer seeds “@Name ”; @mentions render blue but have **no** mention notifications. | `thread-comments:{threadId}` / `resource-comments:{resourceId}` / `showcase:{postId}` topic `comment` `{user_id}` (reaction frames add `reaction:true`); chat `content-comment` republishes totals | Mobile has comments + reactions for all kinds with matching limits (`comments.ts:65-70`). No comment edit on either side. | P1 (already exists; keep in sync) |
| Sharing | events only (card + detail menu) | none (client-only) | Any member | `navigator.share({title,url})`, else copy link to clipboard; URL = canonical `/dashboard/communities/{cid}/events/{eid}` (home card) or current page (detail) (`EventCard.tsx:442-454`). **Threads, resources, showcase have no share/copy-link; no share-to-DM anywhere.** | none | Native share sheet is a natural fit but only used for events on web; decide if mobile adds it for all kinds (web does not). | P3 |
| Reporting | card ••• → Report (`ReportModal`) | `POST /api/content-reports` | Any authenticated user | `content_type ∈ {thread,showcase,resource,event}`, reason ∈ 8 values in `report-reasons.ts:12-22`, `details` ≤ 1000; cannot report own post (403); duplicate open report by same user = 409 (“already reported”, partial unique index); target must still exist (404 “That content no longer exists.”); author/title snapshotted onto the report row. Admin review: `GET/POST /api/admin/reports/...` with actions `remove|dismiss|reopen|restore` (remove = snapshot + undoable). | none | **Mobile has no report UI.** | P2 |
| Saved page | `/dashboard/saved` (nav rail + palette) | `GET /api/profile/feed?scope=saved&before=` | role `user` | One flat list of saved **threads, showcase posts, resources (via bookmark), events**; RPC `get_profile_feed_page(p_scope='saved')`; page ≤ 30 (RPC cap 50); unsaving drops the card instantly via content bus; empty copy “Nothing saved yet / Save a thread, event, resource or showcase post…” | none (catch-up refetch only) | **No mobile Saved screen.** | **P1** |
| Search | Topbar palette (`DashboardSearch.tsx`, ⌘K) | **No search API.** Client-side ranking `lib/dashboard/topbar.ts:150-178` over 9 static page destinations + the sidebar’s already-loaded communities (non-archived); limit 10; empty query lists pages then communities | role `user` (sidebar cache only exists when signed in) | Rank: label prefix 0 < label substring 1 < keyword prefix 2 < keyword substring 3; pages grouped before communities. Nothing server-side searchable: no users, no all-communities, no jobs/posts/events search. (Only other searches: community members `GET /api/communities/{id}/members?search=` debounced, and company picker `GET /api/companies/search` 60 req/60 s.) | none | Mobile has no search UI; palette is cheap to port (static pages + joined communities from cache). | P2 |
| Threads (community tab) | `/dashboard/communities/{id}?tab=threads`, deep link `/dashboard/communities/{id}/threads/{threadId}`, cross-community detail `/dashboard/threads/{threadId}` | `GET /api/communities/{id}/threads?cursor=createdAt\|id` → `{threads,nextCursor}`; detail `GET .../threads/{threadId}` → `{thread}` | List: member only (RPC 42501 → 403). Detail (community scope): member, or anyone if `is_public`. Cross-community page loads by id and redirects non-members to the community for private threads. | Page size 50 (fetch 51), compound cursor `created_at|id`; order newest first; enrich adds author, like/save/comment counts, poll vote state; aggregates RPC `get_thread_list_aggregates`. | `threads:{communityId}` topics `thread`, `like`, `poll`; detail subscribes `thread-comments:{id}` `comment` and `threads:{id}` `like`+`poll` | Mobile lists first page only (no cursor walk). | P1 |
| Resources (community tab) | `/dashboard/communities/{id}?tab=resources`, deep link `.../resources/{resourceId}`, `/dashboard/resources/{resourceId}` | `GET /api/communities/{id}/resources?cursor=` → `{resources,nextCursor}`; detail → `{resource}` | List: member only. Detail: member, or anyone if `is_public`. | Page size 100 (fetch 101); aggregated `save_count` (heart), `bookmark_count`, `comment_count`; link-preview via `GET /api/link-preview?url=`; Figma URLs embed. | `resources:{communityId}` `resource`, `save`; `resource-comments:{id}` `comment` | Mobile first page only; bookmark vs heart both exist. | P1 |
| Showcase (community tab) | `/dashboard/communities/{id}?tab=showcase`, deep link, `/dashboard/showcase/{postId}` | `GET /api/communities/{id}/showcase?cursor=` → `{posts,nextCursor}`; detail `GET .../showcase/{postId}` | List: member only (403 “Not a member.”). Detail: member, or `is_public`. Create member. | Page size 25 (fetch 26); categories filter chips; post has `title`, cover `image_url`, `attachments` (images/videos + posters), `category`, likes/saves/comments; comments toggle via `allow_replies` (migration `20260830140000`). | `showcase:{postId}` `comment`; chat `content-insert`/`content-delete` | See realtime caveat below for `showcase:{postId}` sockets. Mobile view exists; no video. | P1/P2 |
| Library | `/dashboard/library` (palette + sidebar) | `GET` via RPC only (`get_library_page`, SSR) + admin: `GET /api/admin/library?kind=&sort=&search=&page=`, `GET/POST /api/admin/library/featured` | Member page: role `user`. Admin console: role `admin`. | Read-only *curated* shelf: admin picks threads/showcase/resources into `library_items` with 1..N rank per kind. Member sees a pick only when it `is_public` or they are a member of its community. Tabs Threads/Showcase/Resources with per-kind chips (thread has extra “Polls” chip); one unpaginated payload; grid 1/2/3 columns. Cards keep all mutations (like/save/comment); actions here reuse the same API routes. Curation queue ranks by **likes+comments** (resources: **saves+comments**) or newest; shelf ops idempotent; `featured_rank` gap-closed on removal. | none (content bus only) | **No mobile Library screen**; whole payload is small (curated set). | P2 |
| Community preview for non-members | `/dashboard/communities/{id}` when read model 403s (non-member) → `CommunityPreview` with Join / Request-to-join; pending request state | `GET /api/communities/{id}/preview` (loader `lib/communities/preview`) | Any signed-in user; private/pending handled inside preview (`can_join`, `has_pending_request`, join message) | Public content cards opened by non-members show this preview instead of “Community not found”. Chat/members stay members-only. | none | Mobile community page exists; verify preview + pending-request parity. | P3 |
| Moderation model | community settings/managers, `community_admin_activity`, admin removal console | enforced inside content routes (`loadCommunityPermissionCheck`); admin via `/api/admin/reports/...` | Roles: `owner` (all permissions), `admin` (app-created communities only, granted toggles, defaults all when row missing), `moderator` (granted toggles, defaults none when row missing), `member`. Permissions: `can_edit_settings, can_manage_members, can_delete_messages, can_moderate_threads, can_moderate_showcase, can_moderate_resources, can_moderate_events`. | Managers can delete others’ threads/resources/showcase (not comments) through the same DELETE routes; audit row + author notification with role label; admin removals are undoable snapshots (`content_removals`), member/manager deletes are not. | room `thread`/`resource`/`event` delete frames + chat `content-delete` | Mobile has no moderation surfaces except message delete (chat). | P3 |

Cross-cutting (all web routes): every request first passes `middleware.ts` global rate limit (burst 50/10 s, sustained 300/60 s per identity, `lib/global-request-rate-limit.ts:8-10`) → 429 JSON for APIs, `/too-many-requests` page for pages. Session = 7-day JWT cookie `uxcommunity_session`; `requireSession("user", {verifyActive:true})` on writes also checks the user row isn’t blocked/deleted (`lib/auth/session.ts:167-204`); read routes use `verifyActive:false`.

---

## 1. Home feed

### 1.1 Page → component chain
- `/` → `redirect("/login")` (`apps/web/app/page.tsx:3-5`). Middleware redirects a signed-in visitor of `/` or `/login` to `/dashboard` (user) or `/admin` (admin) (`apps/web/middleware.ts:64-71`), and any unauthenticated `/dashboard/*` request to `/login` (`middleware.ts:84-91`). There is **no logged-out feed** on web; logged-out users see only /login.
- `/dashboard` server component reads the session and renders `DashboardHome` with `HomeRail` (`app/dashboard/page.tsx:7-12`). `app/dashboard/layout.tsx:16-19` additionally redirects any non-`user` role to `/login` (so an `admin` session cannot see the member dashboard).
- `DashboardHome` (`app/dashboard/DashboardHome.tsx:24-59`): scope state defaults to `public`, then swaps to the stored choice after hydration; `HOME_FEED_TAB_SCOPES = ["public","communities"]`; storage key `uxcommunity:home-feed-scope`; a stored legacy `all` is coerced to `public` (`lib/feeds/home-feed-options.ts:21-43`). Feed is **keyed by scope** so switching remounts (cache-hit or spinner; the old tab’s cards never linger). `refreshToken` is accepted but never incremented — refresh happens via remount/catch-up only.
- `HomeFeedFilters` renders the sliding pill switcher labelled “Public Posts” (Earth glyph) / “Your Communities” (Lock) (`app/dashboard/HomeFeedFilters.tsx:12-25`).

### 1.2 Data fetching (client)
- `feedUrl = /api/home/feed?scope=<scope>` (`HomeFeed.tsx:38`); `initRequestCache(userId)` scopes the module-level request cache by user.
- Initial load: `fetchJsonCached(feedUrl, {staleMs: 30_000, force}, userId)` — a mount can render straight from cache; `force` only when `refreshToken > 0` (never, see above). `hasMore = items.length >= 30` (`HomeFeed.tsx:52-75`, `FEED_PAGE_SIZE=30` from `lib/feeds/feed-items.ts:9`).
- Refresh: `useHiddenCatchUp(() => fetchFeed(true))` — refetch when the tab returns visible after ≥ 5 s hidden (`lib/use-hidden-catchup.ts:11,36-53`). The feed has **no realtime subscription** (comment in `HomeFeed.tsx:77-79`); other surfaces’ mutations arrive through the in-memory content bus instead (below).
- Load more (keyset): `GET {feedUrl}&before=<last.created_at>`; incoming items filtered by id to dedupe; `hasMore = incoming.length >= 30`; network errors leave the list untouched (`HomeFeed.tsx:104-126`). Note the cursor is the timestamp only — the RPC condition is `created_at < p_before` (`20260925030000:57` etc.), so rows sharing the exact last timestamp are skipped on the next page (possible under backfilled/identical timestamps).
- Error/empty: spinner → error panel (“Couldn’t load your feed” + message, no retry button) → `CommunityFeedList` with scope-specific empty copy (`HomeFeed.tsx:130-168`).
- Content bus: every card mutation anywhere publishes a `ContentChange {kind,id,patch?,removed?,created?}` (`lib/communities/content-sync.ts:23-32,71-107`); the feed merges them (`applyContentChanges`, `HomeFeed.tsx:100-102`). This is web-only; mobile relies on refetch + its own realtime.

### 1.3 API route
`GET /api/home/feed` (`app/api/home/feed/route.ts`):
- Auth: `requireSession("user", {verifyActive:false})` → 401 body `{error:"Unauthorized"}`.
- 400 `{error:"Invalid feed cursor."}` when `before` is unparseable (`route.ts:114-121`).
- `scope` default `all`; unknown values fall back to `all` (`route.ts:126-129`) — this is what the scope-less Expo call gets.
- RPC `get_home_feed_page(p_user_id, p_before, p_limit=30, p_scope)` through `callPerformanceRpc` on the service client. Result is filtered through `isFeedCard` (drops rows without `community_id`), normalized (thread arrays default to `[]`), poll votes attached for threads (`attachPollVotes`), event extras attached (`rsvps` attendee previews + `chat_community` link). Response `{items}` with `Cache-Control: no-store` + `Server-Timing` (`route.ts:26-100,131-157`).
- Wrapped in `unstable_cache(["home-feed", HOME_FEED_TAG], {revalidate:10})` so identical (user, cursor, scope) reads collapse for 10 s (`route.ts:20-26`); like counts/deletes can therefore lag ≤ 10 s inside the feed.

### 1.4 RPC / DB semantics (`get_home_feed_page`, latest body in `20261008140000_remove_design_interests.sql:287-411`; scope semantics introduced by `20260925030000_home_feed_scope_visibility.sql:1-23`)
- Candidate kinds: `community_threads`, `community_events`, `community_resources`, `community_showcase_posts`, all with `community_id is not null` (standalone `community_id = null` posts were deleted and the column made NOT NULL by `20260830100000`).
- `communities` scope: `community_id in (my community_members)` regardless of `is_public`.
- `public` scope: `is_public AND community_id NOT IN (my communities)` — disjoint from the other tab.
- `all`: `is_public` only (joined or not).
- Order `created_at desc, id desc`; `limit least(greatest(p_limit,1),30)` (`…:343-347`).
- Projection adds: `_type`, `users {name, avatar_url}`, showcase `author`, `community_name`, `community_image` (resolved through master-data rows for app-created communities, falling back to `communities.image_url`), `comment_count` (thread_comments / resource_comments / event_comments / showcase_comments), `like_count` + `user_liked` (thread_likes / event_likes / showcase_likes; **resources have no like**), `rsvp_count`/`user_rsvped` (events), `save_count`/`user_saved` (event_saves / **resource_saves = heart** / showcase_saves / thread_saves), `bookmark_count`/`user_bookmarked` (**resource_bookmarks only**) (`…:348-394`).
- Back-compat overload `(uuid,timestamptz,int,bool)` still exists (delegates `p_member_only=true → 'communities'`), `20260925030000:161-188`.

### 1.5 Card list behavior
`CommunityFeedList` (`components/feeds/CommunityFeedList.tsx`):
- Ended events are hidden on the home feed (`showPastEvents=false` → filter `end_date ?? event_date >= now`, lines 270-275); the profile tabs pass `showPastEvents`.
- Consecutive resources are grouped into one row group; threads/events/showcase render full width (lines 281-302).
- Empty list → the passed empty UI (line 277-279).
- All mutation callbacks patch the feed list, patch the request cache, and publish on the content bus (lines 97-267). Showcase edit/delete is done inline from the feed via `CreateShowcaseModal` / `ConfirmDialog` (lines 439-457).

---

## 2. Post creation / edit / delete

### 2.1 Threads
**POST `/api/communities/[id]/threads`** (`app/api/communities/[id]/threads/route.ts:91-192`)
1. `requireSession("user")` (verify-active) → 401/403.
2. `isCommunityMember` → 403 `{error:"Not a member of this community."}` (line 105-107).
3. Rate limit `thread:create:{userId}:60s` 10/60 s → 429 + `Retry-After` (109-115).
4. Body parse → 400 `{error:"Invalid request body."}`.
5. Fields: `title` (trimmed, 1..2000 → 422), `category` (must be in `THREAD_CATEGORY_VALUES` → 422), `tags`/`links`/`attachments`/`poll` normalized (any null → 422 “One or more thread fields are invalid.”), `allow_replies` (default true), `is_public` (`=== true`).
6. Insert; DB creation-limit trigger error (`P0001` `limit:posts_daily`) → 429 with mapped copy (`lib/creation-limits.ts:11-27`); other errors → 500.
7. Realtime batch: `threads:{communityId}` `thread` (full row), chat `thread-insert` (row), chat `content-insert` (`contentEventPayload` — id/community_id/user_id/kind/title/created_at/meta) (171-188).
8. Response `201 {thread}` with author + aggregates attached.

Normalizers (`lib/communities/thread-body.ts`):
- Poll (63-77): object `{question, options[]}`; question 1..200; 2..6 options, each 1..100, unique; absent → `{poll:null}`; malformed → `null` → 422.
- Tags (79-87): array ≤ 3, string-only, trim, strip leading `#`, non-empty, ≤ 30 chars, deduped.
- Links (89-102): array ≤ 10, each valid http/https URL, deduped.
- Attachments (104-128): array ≤ 5 of `{name≤255, url≤2048, type≤100, size≥0}` (optional `poster`).

**PATCH …/threads/[threadId]** (`[threadId]/route.ts:94-186`) — identical body contract; owner only (403 “You can only edit your own threads.”); 404 if not found in scope; `updated_at` bumps. Poll votes are deleted only when the options array changes (`:140-148`). Replaced attachment URLs are reclaimed from R2 (`deleteOwnedR2AssetIfUnique`, `:150-170`). Realtime: `threads:` `thread` + chat `thread-update` (`:172-183`). Returns `{thread}` enriched.

**DELETE …/threads/[threadId]** (`:188-264`) — author, or a manager with `can_moderate_threads` (403 otherwise; public-scope content author-only). Uses `removeCommunityContent` (row delete + R2 cleanup + realtime); moderated deletes add `community_admin_activity` `thread_deleted` + `thread_deleted` notification quoting the role. 204.

**Upload** `POST …/threads/upload` (`threads/upload/route.ts`) — member only; multipart field `file`; allowed `image/jpeg|png|webp|gif`, `application/pdf`, `application/zip`, `application/x-zip-compressed`, `text/plain`; **≤ 10 MB** (422 otherwise); stored at `threads/{communityId}/{userId}/{ts-rand}.{ext}` on R2; returns `201 {attachment:{name,url,type,size}}`.

Composer (`components/communities/threads/CreateThreadModal.tsx`): two tabs — Post / Poll (line 90-120); poll question becomes the thread title (line 111-114); `tags: []` is always sent (line 141); links are auto-extracted from the body (line 143); “Allow replies” and “Share publicly” switches (239-246); client limits: body 2000 chars (202), ≤ **4 images** (`ThreadComposerControls.tsx:227`) and ≤ **5 attachments total** (`useThreadFileUpload.ts:10-54`), images client-compressed (GIFs untouched) (64-68).

### 2.2 Resources
**POST `/api/communities/[id]/resources`** (`resources/route.ts:92-168`) — member; rate 10/60 s; `title` ≤ 120; `url` required ≤ 2048 and http/https (`new URL`); `description` ≤ 2000; `resource_type` in the 11-value set; `is_public`, `allow_replies`. 422 messages are field-specific. Insert → 201 `{resource}`; creation-limit 429. Realtime: `resources:{id}` `resource` + chat `content-insert`.

**PATCH/DELETE …/resources/[resourceId]** (`[resourceId]/route.ts:91-212`) — PATCH owner only; DELETE author or `can_moderate_resources` (audit + notification). 204 on delete; `removeCommunityContent` announces `resources:` `resource` `{id}` + chat `content-delete`.

No resource upload endpoint and no attachments: resources are link cards (`LinkPreviewCard`, Figma embed in `FigmaEmbed.tsx`). Mobile’s editor currently sends `tags` which the server ignores.

### 2.3 Showcase
**POST `/api/communities/[id]/showcase`** (`showcase/route.ts:60-92`) — member (`{error:"Not a member."}` 403); rate 5/60 s (`showcase:create:{userId}:60s`); `parseShowcaseBody` (`lib/communities/showcase-validation.ts:49-112`):
- `title` 1..2000; `category` required + in the 11 categories; `is_public` (`===true`), `allow_replies` (default true).
- `attachments` ≤ 5; each `{name≤255, url≤2048, type, size, poster?, mediaId?, status?}`; allowed types `SHOWCASE_MEDIA_TYPES` (images jpeg/png/webp/gif + video mp4/webm/quicktime) (`:10`); video-only fields validated (`mediaId` UUID regex, `status ∈ {ready,failed}`, poster image URL).
- Cover `image_url` = first image attachment, else explicit `image_url`.
Insert → 201 `{post}`; only chat `content-insert` is published (no `showcase:…` create frame).

**PATCH/DELETE …/showcase/[postId]** (`[postId]/route.ts`) — GET requires member or `is_public` (`canInteract`, `:48-53`); POST is the single like/save endpoint `{action:"like"|"save", active:boolean}` → 422 when malformed, returns `{active,count}` (no realtime publish); PATCH owner only, same validation, R2 cleanup of removed attachments/posters/cover; DELETE author or `can_moderate_showcase`.

**Media pipeline**
- Images: `POST …/showcase/upload` multipart (`showcase/upload/route.ts:35-116`): member; JSON body is the *video finalize* mode; multipart proxies to R2 at `showcase/{id}/{uid}/…`; rejects videos (422 “Videos upload directly to storage…”), non-image types (422), images > **8 MB** (422); body bounded against oversized/chunked bodies (413).
- Videos: `POST …/showcase/upload-ticket` (`upload-ticket/route.ts:19-64`): member; `{type,size,hasPoster}`; type ∈ `VIDEO_MIME_TYPES` (`packages/shared/src/video/video-config.ts:10`), size ≤ **50 MB** (`:13`); returns `{mediaId,key,uploadUrl,publicUrl,posterUploadUrl?,posterPublicUrl?}` — presigned PUTs valid 600 s; key `media/videos/processed/{mediaId}{.mp4|.webm|.mov}`, poster `media/videos/posters/{mediaId}.jpg`.
- Finalize: same `/upload` with JSON `{mediaId,key,name,type,size,posterUrl}`; key must match the issued mediaId (`isShowcaseVideoKeyForMedia`), type ∈ video set, size ≤ 50 MB, HEAD-verified in R2 (409 if missing); returns the ready attachment.

### 2.4 Creation budgets (DB-enforced, applies to all clients)
`creation_limits` + `usage_counters` + `consume_creation_budget` (`20261013120000_creation_limits.sql:60-175`; resources added to the same budget `20261014120000`):
- `posts_daily` = **3/day** shared by threads + showcase + resources,
- `events_monthly` = 1, `jobs_monthly` = 1, `dms_monthly` = 5 new conversations, `communities_total` = 1, `community_joins` = 7.
Triggers raise `P0001` `limit:<kind>`; routes map to copy and 429 (`20261013120000:60-75`; `lib/creation-limits.ts:11-38`).

### 2.5 Permissions matrix (content)

| Action | Non-member | Member | Author | Moderator (`can_moderate_*`) | Owner/Admin | Platform admin |
|---|---|---|---|---|---|---|
| Read public card/detail | yes | yes | yes | yes | yes | yes |
| Read private card/detail | no (403/redirect to community) | yes | yes | yes | yes | yes |
| Create (thread/resource/showcase) | no (403) | yes (rate + budget) | — | same as member | yes | n/a |
| Edit | no | no (403 “only edit your own”) | yes, no time limit | no | no (unless author) | no |
| Delete + R2 cleanup | no | no | yes | yes (other kinds; `can_moderate_threads/showcase/resources`) | yes | yes via admin reports (undoable snapshot) |
| Like/heart/save/bookmark | thread/showcase-like: public targets yes1; else member | yes | yes | yes | yes | (admin n/a) |
| Comment | public target yes (thread/resource/showcase); private no | yes | yes | yes | yes | n/a |
| Delete comment | no | author only (“You can only delete your own comments.”) | yes | **no** | **no** | remove content cascades comments |
| Vote poll | any signed-in user (no member re-check)1 | yes | yes | yes | yes | n/a |
| Report | any signed-in user, not own post, one open report per post | same | cannot report self | same | same | reviews/dismisses/removes/restores |

1 The thread `like`/`save`/`poll` routes verify only “thread exists in this community/scope” — there is **no `isCommunityMember` check** (contrast with comments and creates). Same for showcase POST interactions (member-or-public rule) and resource save/bookmark (member or `is_public`).

### 2.6 Error-shape summary (content routes)

| Status | Body | Where |
|---|---|---|
| 401 | `{error:"Unauthorized"}` | `requireSession` throw |
| 400 | invalid JSON / “Invalid cursor.” / “Unknown profile feed scope.” / “Invalid poll option.” / boolean-state required | per route |
| 403 | “Not a member of this community.” / “You can only edit your own …” / “This thread does not allow replies.” / “Comments are turned off for this resource.” / “You can’t report your own post.” | per route |
| 404 | “… not found.” / “That content no longer exists.” | per route |
| 409 | poll: final vote/undo-once; reports: already reported; video finalize: object missing | poll/report/upload routes |
| 413 | body too large (showcase image proxy) | showcase upload |
| 415 | wrong content-type (showcase upload) | showcase upload |
| 422 | field validation, wrong media type, size caps | POST/PATCH/upload routes |
| 429 | rate limits + creation budgets (+`Retry-After` on thread/resource creates) | per route |
| 500 | “… could not be confirmed.” etc. | per route |
| 503 | comment reactions table missing | reactions route |

---

## 3. Post interactions

### 3.1 Likes / reactions / hearts
- **Thread like** `POST …/threads/[threadId]/like` body `{liked:boolean}` (`[threadId]/like/route.ts`): 400 when not boolean; 404 unknown thread; upsert/delete into `thread_likes` (unique `thread_id,user_id`); returns `{liked,count}`; on first insert defers a `thread_like` notification; publishes `threads:{communityId}` `like` `{event:"INSERT"|"DELETE",thread_id,user_id}`. UI is optimistic with coalescing and rollback (`ThreadCard.tsx:142-225` uses `BooleanIntentCoalescer` + dedupeFetch with `TOGGLE_FETCH_OPTIONS`).
- **Showcase like/save** `POST …/showcase/[postId]` `{action,active}` → `{active,count}` in `showcase_likes`/`showcase_saves`; no realtime, no notifications.
- **Resource heart** = `POST …/resources/[resourceId]/save` `{saved:boolean}` → `{saved,save_count}` in `resource_saves`; publishes `resources:{communityId}` `save`; **label on the UI is “Like”/“Unlike”** (`ResourceCard.tsx` heart `aria-label`).
- **Event like/save** (feed cards) → `events:{communityId}` topics `like`/`save`; store owner’s RSVP is written with event creation (`event_host_is_going` migration).
- Counts shown: thread card `like_count` + `comment_count`; showcase card `like_count` + `comment_count`; resource card `save_count` (heart) + `comment_count` (hidden when `allow_replies === false`); event card `rsvp_count` + spot countdown, `like_count`, `comment_count`.

### 3.2 Saves vs bookmarks (verified)
- Tables: `thread_saves`, `showcase_saves`, `event_saves`, and **both** `resource_saves` (heart) and `resource_bookmarks` (menu Save).
- The **Saved page/profile Saved tab reads `resource_bookmarks` for resources** and `*_saves` for the other kinds (`20261010170000_profile_feed_saved_bookmarks.sql:44-91`; regression-guard note `20261015160000:24-27`). The projection still renders `user_saved/save_count` for resources from `resource_saves` — those fields drive the **heart**, never the saved listing.
- Endpoint shapes: thread `{saved}`→`{saved}` (no count, no realtime, no notification, extra confirmation read); resource save/bookmark and showcase return authoritative counts; event save returns `{saved,save_count}`.
- Unsave removes the card from the Saved list immediately via the content bus (`ProfileActivityFeed.tsx:213-245`, `changeNeedsRefetch` `content-sync.ts:150-152`).

### 3.3 Comments
- GET shapes: `{comments: topLevel[]}` where each parent carries `replies[]` (exactly 1 level), `users {name, avatar_url, designation?}` and `reactions: [{emoji,user_ids}]`, sorted `created_at asc` (`threads/[threadId]/comments/route.ts:53-78`).
- POST validation recap (per kind): body trim 1..5000 (threads/resources) / 1..1000 (showcase); parent must exist on the same target and be top-level (“Cannot reply to a reply.” 422); `allow_replies=false` → 403; private target + non-member → 403; rate 20/60 s (showcase 15/60 s) → 429.
- Notifications: thread → author always, parent author when different (`thread_comment`, `thread_reply`); resource → author (`resource_comment`); showcase → **none**.
- Delete: thread/resource/showcase comment routes delete own comment only (403 otherwise) and return 204; deleting a parent takes its replies with it (comment text: “possibly a parent, taking its replies with it”).
- **No comment edit endpoint exists for any kind** (routes only export GET/POST/DELETE); `updated_at` is carried but never changed.
- Comment reactions: exactly `["👍","❤️","🎉","💡","👏"]` (`lib/communities/comment-reactions.ts:23`), one row per (comment,user,emoji) in `thread_comment_reactions` / `resource_comment_reactions` / `showcase_comment_reactions`; POST toggles and returns the grouped summaries; 429 at 60/60 s; 503 if the migration is missing.
- Mentions: reply composer seeds an `@Name ` text and `@…` renders blue in comment bodies (`CommentComposer.tsx:23-35,132`), but **no mention notifications** are sent for comments.

### 3.4 Sharing / reporting
- Share exists only for events (Web Share API → clipboard fallback, canonical community URL) — `EventCard.tsx:442-454`. No DM-share of cards anywhere (grep of `/api/dm` and DM components shows no sharing feature). Cards have no “copy link”.
- Report: `ReportModal` posts `{content_type, content_id, reason, details}` to `POST /api/content-reports`; 8 reasons (`lib/communities/report-reasons.ts:12-22`); details ≤ 1000; self-report 403; duplicate open report 409; success 201 `{ok:true}` — the modal disables the item afterwards (“Reported”). Admin surface: `/api/admin/reports` and `/api/admin/reports/[contentType]/[contentId]` with `remove|dismiss|reopen|restore`.

---

## 4. Saved page (`/dashboard/saved`)

- Server page (`app/dashboard/saved/page.tsx:14-31`): session role `user` else `/login`; renders header copy and `<SavedFeed currentUserId>`.
- `SavedFeed` = `ProfileActivityScope scope="saved" subject=null` (`components/feeds/ProfileActivityFeed.tsx:418-425`) → `GET /api/profile/feed?scope=saved` with `before` paging, `staleMs 30_000`, hidden-catch-up refetch, no tabs.
- Data: RPC `get_profile_feed_page(p_user_id, 'saved', p_before, p_limit)` — the saved branch unions `thread_saves`, `event_saves`, `showcase_saves` and `resource_bookmarks` (`20261015160000:78-96`; page limit cap 50 `20261010170000:96`). Cards are the same four card components; mutations from here go through the same routes and the bus keeps all lists in sync.
- Membership rules: a saved card the viewer can no longer read (left the community, privacy flipped) still appears in the list because the saved branch joins the content table directly — the client filters nothing; only unsave/build removes cards.
- Profile tabs sit on the same payload: All/Threads/Showcase/Resources/Events list **authored** cards only, Saved lists saves (`20261015160000` motivation comment; `ProfileActivityFeed.tsx:34-51` for tab metadata). Another member’s profile exposes the same tabs minus Saved (`:345-347`), via `get_member_feed_page` when `?user=` is present (`api/profile/feed/route.ts:39-112`).
- Empty state: “Nothing saved yet — Save a thread, event, resource or showcase post and it will appear here.” (`ProfileActivityFeed.tsx:76-79`).
- Mobile: **no Saved screen** — the largest simple gap.

---

## 5. Search

- **UI**: Topbar magnifier → `DashboardSearch` palette (`app/dashboard/DashboardSearch.tsx`), mounted only while open; combobox with ↑↓/Enter/Esc; group headers “Pages” and “Your communities”.
- **There is no search endpoint** — explicitly documented (`DashboardSearch.tsx:29-36`). Rows = 9 static page destinations + the sidebar store’s already-fetched communities (snapshot per open) filtered by `!is_archived` (`lib/dashboard/topbar.ts:27-119`).
- Ranking (`topbar.ts:134-177`): label prefix 0, label substring 1, keyword prefix 2, keyword substring 3; sort by group (page before community) → rank → shorter label → localeCompare; `SEARCH_RESULT_LIMIT = 10`. Empty query = first 10 rows (pages first).
- Keyword examples: Library matches “saved/bookmarks/collection”; Saved matches “save/saved”; Communities matches “discover/explore/browse/join” (`topbar.ts:28-94`).
- Other search-shaped surfaces, for completeness: community members `GET /api/communities/[id]/members?page=&search=` (server-side, debounced, `MembersView.tsx:128-168`); company picker `GET /api/companies/search?q=` (rate 60/60 s, read-only public company data, `api/companies/search/route.ts`); admin library queue search ≤ 80 chars; jobs/communities pages filter **client-side** over loaded data (`JobsBrowser.tsx:181`, `communities/page.tsx:253`).
- Users, jobs, events, posts are **not** searchable anywhere. Mobile has no palette; porting is cheap (static list + cached joined communities).

---

## 6. Community content types (threads, resources, showcase)

### 6.1 Where they live
- Community hub page `/dashboard/communities/[id]` renders the member chat shell with tabs chat/showcase/threads/events/resources/members (`communities/[id]/page.tsx:17-98`). Non-members get `CommunityPreview` (Join or Request-to-join, `can_join`, `has_pending_request`); an event-chat joiner gets `EventChatJoinGate`.
- Deep links: `/dashboard/communities/[id]/{threads|resources|showcase}/…` wrap the same chrome through per-tab layouts that load the community read model and redirect `/dashboard` when it fails (`*/layout.tsx`).
- Cross-community detail pages `/dashboard/threads/[threadId]`, `/dashboard/resources/[resourceId]`, `/dashboard/showcase/[postId]` load the row directly (service client), then enforce: any signed-in member may read when `is_public`, otherwise must be a member (redirect to the community) (`threads/[threadId]/page.tsx:23-30`, `resources/[resourceId]/page.tsx:107-117`, `showcase/[postId]/page.tsx:10-13`). They render the same detail clients with community attribution + HomeRail.
- The legacy `"public"` URL scope (`communityId === "public"`) still exists in every route as a back-compat branch (`is_public=true AND community_id IS NULL`) but no content can match it since `20260830100000` — treat as dead paths except for old bookmarks.

### 6.2 List endpoints and pagination
| Kind | GET | Response | Page size | Cursor | Aggregates |
|---|---|---|---|---|---|
| Threads | `/api/communities/{id}/threads?cursor=` | `{threads, nextCursor}` | 50 (fetch 51) | compound `createdAt\|id` (`lib/communities/read-models.ts:224-261`) | `get_thread_list_aggregates` (likes, user_liked, user_saved, comments) |
| Resources | `…/resources?cursor=` | `{resources, nextCursor}` | 100 (fetch 101) | compound (`:263-299`) | `get_resource_list_aggregates` (heart counts + bookmark counts) |
| Showcase | `…/showcase?cursor=` | `{posts, nextCursor}` | 25 (fetch 26) | compound (`:301-336`) | `get_showcase_interactions` |
Invalid cursor → 400 “Invalid cursor.”; non-member on the list RPCs → 42501 mapped to 403 “Not a member of this community.”; showcase list does its own member check first (403 “Not a member.”).

### 6.3 Realtime per type
- Threads: `threads:{communityId}` publishes `thread` (created/updated payloads and `{id}` on delete), `like`, `poll`. Thread detail subscribes to `thread-comments:{threadId}` `comment` (refetch comments; own-user frames skipped) and reduces `like`/`poll` frames locally (`ThreadDetailClient.tsx:114-175`).
- Resources: `resources:{communityId}` publishes `resource` (create/update/delete) and `save`. Detail subscribes `resource-comments:{resourceId}` `comment` (refetch) and `resources:{communityId}` `save` (count adjust).
- Showcase: create/delete only ride the **chat** room (`content-insert` / `content-delete`); interactions (like/save) publish nothing; the `showcase:{postId}` room carries only `comment` frames.
- **Caveat found in code (risk to flag):** the Room DO skips the membership check only for `thread-comments:*` and `resource-comments:*` (`apps/realtime/src/room.ts:193-204`). For every other community room it calls `MembershipAuthorizer.check`, which derives the community id as the substring after the first `:` (`room.ts:515-519`) — for `showcase:{postId}` that is the **post id**, so the internal membership check (`GET /api/communities/{postId}/members/{userId}/check` returning 403 for a non-existent community row, `check/route.ts:73-77`) is read as “genuine non-member” and the socket is refused. Live showcase-comment updates therefore appear fail-closed in the current implementation; mobile should not depend on `showcase:*` sockets without fixing the room name/authorization (e.g. key it by communityId, or add it to the sub-entity skip list and rely on the API route's publish authorization).

### 6.4 Pinning
No pinning for threads/resources/showcase/comments anywhere (grep over web + migrations). The only “pinned” behavior in the product is event-date promotion in the sidebar (`pinned_until` on communities used by sidebar ordering). Do not design mobile pinning expecting server support.

### 6.5 Moderation & attribution
- Every card displays the community (name + resolved DP) with a preview popup for non-members on the feed (`CommunityPostLabel` / `CommunityPreviewModal`, `onOpenCommunityPreview` in feed/feed list).
- Manager permissions and removal audits are described in the matrix above; deletion is the only moderator action (no lock/close thread, no comment removal).
- Deleting an event still keeps its group chat; deleting content removes it from the chat timeline through `content-delete` and (for adds) `content-insert` (chat timeline cards are permanent “X created a …” entries with comment/RSVP counts maintained by `content-comment`).

---

## 7. Library

- Member page `/dashboard/library` (`app/dashboard/library/page.tsx:19-64`): role `user`; SSR RPC `get_library_page(p_user_id)`; filters through `isFeedCard`/`normalizeFeedCard`; attaches poll votes for threads; renders `LibraryView` in a full-width `max-w-[80rem]` container (not the feed column).
- Shelf semantics (migration `20261015180000_library_curation.sql`):
  - `library_items` table (44-69): one row per pick, exactly one of `thread_id|showcase_id|resource_id` (unique FKs, `on delete cascade`), generated `item_type`, `featured_rank ≥ 1` per kind, `curated_by/curated_at`. RLS enabled, revoked from API roles.
  - Member visibility: a pick lists only when the post `is_public` or the viewer is a member of its community (29-33, 468-491).
  - One unpaginated payload; same projection as the feed RPCs (counts + viewer flags), so cards render and mutate identically (492-531).
- `LibraryView` (`components/library/LibraryView.tsx`): tabs {Threads, Showcase, Resources}; chips come from the **same vocabularies as the composers** — thread categories + a special `poll` chip, showcase categories, resource types; client-side filtering only (`filterLibraryItems`, `library-filter.ts:16-26`); grid `grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3` (line 189); content-bus live merge; per-kind empty states (“Handpicked … will appear here”).
- Admin console (`/admin/library`, APIs `api/admin/library/route.ts` + `featured/route.ts`): queue = `admin_library_candidates(kind, search≤80, sort ∈ {engagement,newest}, offset, limit≤100)` where **engagement = likes + comments (resources: saves + comments)** (`20261015180000:437-445`); page size 25; shelf read = `admin_library_featured`; curation = `admin_set_library_item(type,id,featured,curated_by)` / `admin_move_library_item(type,id,±1)`, idempotent, `featured_rank` renumbered 1..N; POST errors: 404 not found, 422 invalid, 409 `item_not_featured`.
- Mobile: **no Library screen**; read-only port is straightforward (single payload, client filters).

---

## 8. Realtime rooms & topics

Room-name helpers (`apps/web/lib/realtime/rooms.ts:6-20`):

| Room pattern | Owner DO | Feature | Topics published by web APIs | Payload shapes |
|---|---|---|---|---|
| `chat:{communityId}` | Community | community chat + timeline cards + sidebar preview | `message`, `message-edit`, `message-delete`, `reaction-insert/update/delete`, `thread-insert`, `thread-update`, `thread-delete`, `content-insert`, `content-delete`, `content-comment`, `content-reaction-insert/update/delete`, `rule` frames (rules room is separate; chat carries content frames) | `content-insert`: `{id,community_id,user_id,kind,title,created_at,meta{image_url,video_poster,description,resource_type,url,event_date,end_date,is_online,rsvp_count,comment_count}}`; `content-delete`: `{id,community_id,kind}`; `content-comment`: `{community_id,content_id,kind,comment_count}`; `thread-insert/update/delete`: the thread row / `{id}` |
| `threads:{communityId}` | Community | thread cards feed | `thread` (created/updated row or `{id}` delete), `like` `{event:"INSERT"\|"DELETE",thread_id,user_id}`, `poll` `{event:"INSERT"\|"UNDO",thread_id,user_id,counts[],user_vote,undo_used}` | see left |
| `thread-comments:{threadId}` | Community (sub-entity; **no membership check**) | thread comment lists | `comment` `{user_id}` (+`reaction:true` for reaction toggles) | consumers refetch comments; own-user frames skipped |
| `events:{communityId}` | Community | event cards | `event` (row / `{id}`), `like` `{event_id,user_id}`, `save` `{event_id,user_id}`, `rsvp` `{event:"INSERT"\|"DELETE",event_id,user_id}` | left |
| `resources:{communityId}` | Community | resource cards | `resource` (row / `{id}`), `save` `{event:"INSERT"\|"DELETE",resource_id,user_id}` | left |
| `resource-comments:{resourceId}` | Community (sub-entity; **no membership check**) | resource comment lists | `comment` `{user_id}` | consumers refetch |
| `showcase:{postId}` | Community — **membership check uses postId as community id → sockets currently refused** (see §6.3 caveat) | showcase comment list | `comment` `{user_id}` | consumers refetch |
| `rules:{communityId}` | Community | community rules | `rule` | row |
| `presence:{communityId}` (helper) / any community room | Community | presence | server-coalesced presence frames `{t:"presence",count}` | count only |
| `notifications:{userId}` | UserDO (`user:{userId}` instance) | notification bell/inbox | `insert`, `update`, … (notifications feature) | notification rows |
| `dm:{userId}` | UserDO | all DM conversations multiplexed | DM message/reaction events | DM payloads |

Transport facts for mobile:
- Web authenticates sockets with the session **cookie** on the handshake (`apps/web/lib/realtime/client.ts:83-89`; build URL never carries the token). The worker reads `uxcommunity_session` (or legacy `draft_session`) cookie, or a `?token=` query fallback (`apps/realtime/src/index.ts:138-162`); mobile passes the cookie as a **header** on the RN WebSocket (`expo-app-standalone 3/lib/realtimeCore.ts:120-132`) — no URL token needed.
- One socket per community room + one per user; user-scoped logical rooms (`notifications:`, `profile:`, `dm:`) are routed to `user:{userId}` DOs (`room-routing.ts:45-99`). Community room upgrades are membership-authorized, fail-closed, cached 60 s (`membership-auth.ts:39-44,148-261`); sub-entity comment rooms skip it.
- Client → server publishes are limited to the `typing` topic (`apps/realtime/src/client-publish.ts: CLIENT_PUBLISHABLE_TOPICS`); everything else arrives only from the secret-authenticated route publishes.
- Web client keeps ≤ 15 sidebar community sockets live (`useSidebarRealtime.ts:39`), heartbeats every 25 s, reconnects with backoff 1→15 s, and re-subscribes refcounted topics after reconnect.
- The sidebar is the only always-on web consumer of `chat:` frames; the feed, saved page, library and profile tabs have **no subscriptions** — they rely on hidden-catch-up refetches + the in-memory content bus (web-only).

---

## 9. Mobile gap checklist (derived from code, not from product promises)

Present on mobile today: session cookie API client (`lib/api.ts`), home feed tab (scope-less → legacy `all`), community tabs with threads/resources/showcase/events lists (first page only), create/edit/delete for the three content kinds (images only), like/heart/save/bookmark/rsvp toggles with optimistic coalescing (`lib/communityContent.ts:301-340`), comments + comment reactions for all four kinds (limits match web), chat realtime with cookie-header sockets.

Missing / divergent vs web (candidate parity work):
1. Feed scope tabs (`public` / `communities`) and persistence of the choice — P1.
2. Saved page (bookmark semantics for resources; `scope=saved` profile feed) — P1.
3. Library member shelf — P2.
4. Search palette (client-side) — P2.
5. Polls: voting (P2) and poll creation (P2).
6. Showcase video upload (ticket + finalize) — P2.
7. Report flow (content-reports + reasons) — P2.
8. Comment/community-content cursor pagination (threads 50 / resources 100 / showcase 25 with compound cursor) — P2.
9. Share (events only on web; decide mobile policy) — P3.
10. Community preview / pending-join states on the community page — P3.
11. Web-only mechanisms mobile must NOT try to reuse: the in-memory content bus (`lib/communities/content-sync.ts`) and `unstable_cache` server behavior; mobile's equivalent is refetch + realtime (feed has no realtime in either app today).
