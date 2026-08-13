# Performance Audit

## Scope

This is a read-only, evidence-based audit of the existing Next.js and Supabase application. No Supabase resources were configured, no remote SQL was executed, and no application behavior was changed.

## Audit plan

1. Map the monorepo architecture, server/client boundaries, shared data utilities, authentication flow, request cache, and Supabase clients.
2. Inspect the high-traffic API route families: home feed, communities, events, threads, showcase, messages, notifications, comments, and interaction mutations.
3. Trace authentication work, database query count and ordering, payload selection, joins and aggregations, cache behavior, and likely index usage.
4. Audit frontend consumers for duplicate fetches, cache bypasses, broad invalidations, navigation waterfalls, remounts, and `router.refresh()` use.
5. Trace Realtime channels and cleanup to identify duplicate subscriptions, leaks, and event-driven refetch amplification.
6. Trace likes, saves, votes, comments, messages, and event mutations for optimistic updates, races, duplicate calls, and overly broad invalidation.
7. Trace image uploads through preprocessing, validation, moderation, storage, and database writes.
8. Run available read-only tests, lint, and production build checks, distinguishing measured results from code-derived estimates.

## Executive summary

The application already includes useful performance foundations: a bounded request cache with in-flight deduplication, optimistic interaction updates, batched enrichment in several endpoints, Realtime cleanup, and database-side aggregate functions for the home feed. The primary remaining risks are data-volume amplification rather than simple N+1 mistakes.

The most urgent issues are the community sidebar endpoint transferring historical reaction data, one Realtime channel per joined community, global home-feed subscriptions that can force seven-query feed refreshes, and list APIs transferring every interaction row to aggregate counts in Node.js. These patterns can remain acceptable at small scale but become expensive and unpredictable as community membership, interaction history, and concurrent activity grow.

## Ranked findings

### 1. Community sidebar API scales with historical data

**Severity:** Critical at scale
**Evidence:** `apps/web/app/api/communities/route.ts`

The endpoint fetches all memberships, member rows for joined communities, up to `communityCount × 10` messages, and reactions across all joined communities without a bounded per-community history. Aggregation then occurs in the application process.

**Impact:** Response size, database work, serverless memory, and serialization cost increase with historical activity rather than only with the number of communities displayed.

**Recommendation:** Replace row transfer with database-side grouped counts and latest-message/latest-reaction queries. Return only the fields required by the sidebar.

**Expected improvement:** Potentially orders-of-magnitude lower row transfer for mature communities.
**Tradeoff:** More SQL/RPC complexity and additional aggregate-query tests.

### 2. Sidebar opens one Realtime channel per joined community

**Severity:** Critical at scale
**Evidence:** `apps/web/components/communities/panel/useSidebarRealtime.ts`

The sidebar creates one channel containing multiple message and reaction handlers for every joined community. A user in 50 communities can create roughly 50 channels and hundreds of change handlers before active-chat and notification subscriptions are counted.

Cleanup is present, so this is amplification rather than a memory leak.

**Recommendation:** Consolidate sidebar subscriptions where supported, subscribe only to visible/recent communities, or use a server-maintained lightweight sidebar projection.

**Expected improvement:** Fewer concurrent sockets/channels and lower client event-processing overhead.
**Tradeoff:** More complex subscription routing and potentially less immediate updates for inactive communities.

### 3. Global event interactions can trigger seven-query feed refreshes

**Severity:** Critical at scale
**Evidence:** `apps/web/app/dashboard/HomeFeed.tsx`

The home feed subscribes without a row-level filter to global `event_likes` and `event_saves` changes. Each event interaction can force revalidation of `/api/home/feed`; that route performs seven database calls per refresh.

**Recommendation:** Patch only the affected event from the Realtime payload, restrict subscriptions to displayed item IDs where practical, or remove these global subscriptions while retaining optimistic updates and periodic/focus refresh.

**Expected improvement:** Removes a major request-storm multiplier during high interaction volume.
**Tradeoff:** The feed may need explicit reconciliation after missed events.

### 4. List APIs transfer interaction rows and aggregate in Node.js

**Severity:** High
**Evidence:**

- `apps/web/app/api/communities/[id]/threads/route.ts` — approximately 8 queries
- `apps/web/app/api/communities/[id]/events/route.ts` — approximately 10 queries
- `apps/web/app/api/communities/[id]/resources/route.ts` — approximately 9 queries
- `apps/web/app/api/communities/[id]/showcase/route.ts` — approximately 7 queries

These routes fetch one row per vote, RSVP, like, save, comment, or bookmark and aggregate the results in JavaScript. Query count is bounded, but transferred row count is not.

**Recommendation:** Add grouped aggregate RPCs or security-invoker views following the existing home-feed aggregate pattern. Include only current-user interaction rows separately.

**Expected improvement:** Stable response size as content popularity grows and lower serverless CPU/memory.
**Tradeoff:** Database logic becomes more sophisticated and must preserve RLS semantics.

### 5. Showcase and event lists need stronger pagination

**Severity:** High
**Evidence:**

- `apps/web/app/api/communities/[id]/showcase/route.ts`
- `apps/web/app/api/communities/[id]/events/route.ts`

Showcase can return up to 100 posts with broad selection, while events are not consistently bounded by cursor pagination.

**Recommendation:** Add cursor pagination, explicit projections, and stable ordering keys such as `(created_at, id)` or `(event_date, id)`.

**Expected improvement:** Bounded memory, payload, and query duration.
**Tradeoff:** Clients must support incremental loading and cursor lifecycle.

### 6. Messages have several enrichment rounds

**Severity:** Medium to high
**Evidence:** `apps/web/app/api/communities/[id]/messages/route.ts`

The endpoint avoids per-message N+1 queries by batching users and reactions, which is good. However, the initial page can still require up to approximately eight calls after authentication. Reply preview users and experience-level resolution add sequential stages.

**Recommendation:** Consolidate message, author, profile, reply-preview, reaction counts, and experience-label retrieval into one carefully secured RPC or a small number of parallel aggregate calls.

**Expected improvement:** Lower database round-trip latency, particularly across regions.
**Tradeoff:** A larger RPC is harder to evolve and must be tested against RLS and reply visibility.

### 7. Community detail has sequential query stages

**Severity:** Medium
**Evidence:** `apps/web/app/api/communities/[id]/route.ts`

The request proceeds through membership/community lookup, reference/member queries, user/profile hydration, and experience-level hydration. It can reach approximately eight queries.

**Recommendation:** Join or aggregate member profile and experience-label data in the database, while preserving authorization checks before private community data is exposed.

**Expected improvement:** Fewer network round trips and better tail latency.
**Tradeoff:** Query complexity and larger joined rows if projections are not kept narrow.

### 8. Image upload work is synchronous and memory intensive

**Severity:** Medium to high
**Evidence:**

- `apps/web/lib/moderation/image.ts`
- `apps/web/lib/image-utils.ts`
- community create/update upload flows

The critical path buffers the image, calls remote moderation, writes moderation logs, runs Sharp compression, uploads to storage, and writes database metadata. Large files increase serverless memory usage and timeout exposure.

**Recommendation:** Keep validation and moderation blocking, but move non-critical logging after the response where policy allows. Enforce strict dimensions/bytes before expensive processing, avoid repeated buffering, and consider direct-to-storage uploads with a quarantined state if the security model permits.

**Expected improvement:** Lower upload latency and timeout probability.
**Tradeoff:** Asynchronous processing requires explicit pending/failed states and careful moderation guarantees.

## Database recommendations

### Community sidebar aggregation

- **Tables:** `community_members`, `community_messages`, `message_reactions`
- **Columns:** membership `user_id`; messages `(community_id, created_at)`; reactions `(community_id, created_at)`
- **Query pattern:** latest row and grouped unread/activity counts per community
- **Why:** the current endpoint transfers large row sets and aggregates in Node.js
- **Expected improvement:** substantially less database-to-server transfer
- **Tradeoff:** RPC/query complexity

### Public feed indexes

- **Tables:** `community_threads`, `community_events`, `community_resources`
- **Columns:** `(is_public, created_at DESC)`
- **Query pattern:** public feed ordered by creation time using a cursor
- **Why:** supports the three feed candidate scans
- **Expected improvement:** bounded index scans instead of filter-and-sort work
- **Tradeoff:** additional write and storage cost
- **Note:** repository migrations appear to address these indexes; confirm deployment before adding duplicates

### Community list indexes

- **Tables:** threads, resources, showcase, messages, and events
- **Columns:** `(community_id, created_at DESC)`; events may additionally need `(community_id, event_date)`
- **Query pattern:** filter by community and order newest-first
- **Why:** avoids repeated sort work for high-volume communities
- **Expected improvement:** faster list retrieval and more stable pagination
- **Tradeoff:** index maintenance on writes

### Notification indexes

- **Table:** `notifications`
- **Columns:** `(user_id, created_at DESC)` and a partial index on `(user_id) WHERE read_at IS NULL`
- **Query pattern:** fetch latest notifications and count unread rows
- **Why:** supports the common list and unread-count paths
- **Expected improvement:** fast retrieval and unread counting
- **Tradeoff:** additional write overhead

## Request-cache assessment

The current request cache has strong fundamentals:

- canonicalized keys
- per-user isolation
- in-flight request deduplication
- bounded 100-entry storage
- cursor-specific keys
- targeted patch and invalidation helpers

A notable portion of the application still uses direct `fetch()` calls. The most consequential bypasses are Realtime follow-up lookups and mutation paths without centralized retry/rollback behavior. The recommendation is to expand selective use of the existing cache rather than add a second cache system.

## Realtime assessment

- Active chat cleanup correctly removes channels.
- Notification subscriptions clean up correctly.
- Active chat combines multiple handlers on one channel.
- Sidebar channel fan-out is the main connection-volume concern.
- Home-feed global subscriptions are the largest refetch amplifier.
- Reconnect/focus catch-up is debounced.

## Mutation assessment

Positive findings:

- Boolean interaction mutations use explicit intent coalescing.
- Optimistic feed updates patch only the affected item.
- Message sending avoids redundant profile queries.
- Realtime echo suppression is implemented.

Risks:

- Notification optimistic mutations do not consistently roll back on failure.
- Several Realtime callbacks issue direct profile or message follow-up requests.
- Thread, event, and resource creation can synchronously perform actor lookup, notification fan-out, and enrichment before responding.

## Validation results

- Request-cache tests: **10/10 passed**
- Interaction/coalescing tests: **3/3 passed**
- Signup tests: **4/4 passed**
- Production build: **passed**, compiling in approximately **12.1 seconds** during the audit
- Lint: **failed** because of existing React effect/state errors and image warnings
- Build configuration skipped type validation, so a standalone type check is still required
- The working tree remained unchanged during the read-only audit

These checks validate application buildability and targeted utility behavior; they are not production load measurements. Live before/after latency was not measured because the audit did not exercise or alter the production Supabase dataset.

## Remaining risks at 100k users

The largest risks are:

1. Realtime connection and handler fan-out for users with many community memberships.
2. Global feed subscriptions producing refetch storms during high event-interaction volume.
3. Node-side aggregation of ever-growing interaction row sets.
4. Unbounded community reaction retrieval.
5. Synchronous notification fan-out during write requests.
6. Serverless memory and timeout pressure from synchronous image moderation and transformation.

## Suggested implementation order

1. Replace sidebar historical-row retrieval with database-side summary queries.
2. Remove or constrain global home-feed interaction subscriptions.
3. Add aggregate RPCs for thread, event, resource, and showcase list interactions.
4. Add cursor pagination and narrow projections to showcase and events.
5. Consolidate sidebar Realtime subscriptions.
6. Reduce message and community-detail enrichment round trips.
7. Move non-critical notification and upload work off user-facing critical paths.
8. Add production telemetry for query duration, response bytes, Realtime channel count, cache hit rate, and upload-stage timing.
