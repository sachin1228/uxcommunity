# Production-Readiness Audit — uxcommunity

**Date:** 2026-09-27 · **HEAD audited:** `f89dc8f7` · **Type:** audit only (no code changes)

All findings verified against the *current* working tree, not prior audit docs, PR descriptions, or comments. Where an old audit claim was checked and disproven, it is called out explicitly. This document is the deliverable of the audit; it changes no behavior.

---

## Table of contents

- [Phase 1 — Repository architecture](#phase-1--repository-architecture-as-actually-built)
- [Phase 2 — Realtime audit](#phase-2--realtime-audit)
- [Phase 3 — Mobile realtime](#phase-3--mobile-realtime-actual-implementation)
- [Phases 4–5 — Database audit & scaling](#phases-45--database--postgres-audit--scaling)
- [Phase 6 — Push notifications](#phase-6--push-notifications-traced-end-to-end)
- [Phase 7 — Cache audit](#phase-7--cache-audit)
- [Phase 8 — API performance](#phase-8--api-performance)
- [Phase 9 — Cloudflare / Durable Objects](#phase-9--cloudflare--durable-objects)
- [Phase 10 — R2 / uploads](#phase-10--r2--uploads)
- [Phase 11 — Video pipeline](#phase-11--video-pipeline)
- [Phase 12 — Concurrency / races](#phase-12--concurrency--race-conditions)
- [Phase 13 — Frontend performance](#phase-13--frontend-performance-web)
- [Phase 14 — Mobile performance](#phase-14--mobile-performance)
- [Phase 15 — Security × performance](#phase-15--security--performance-interactions)
- [Phase 16 — Observability](#phase-16--observability)
- [Phase 17 — Load-test correctness](#phase-17--load-test-correctness)
- [Phase 18 — Failure / recovery](#phase-18--failure--recovery)
- [Phase 19 — Platform limits](#phase-19--platform-limits-verified-official-docs--repo-config)
- [Phase 20 — Final risk report](#phase-20--final-risk-report)
- [Final summary & roadmap](#final-summary)

---

## Phase 1 — Repository architecture (as actually built)

```
 Web (Next.js 14 App Router, apps/web — deployed as OpenNext Cloudflare Worker "uxcommunity-web")
 │     129 route handlers, middleware (JWT verify + Upstash global rate limit)
 │     Service-role Supabase client for ALL DB access (RLS bypasses; anon/auth revoked since 2026-09-26)
 │
 ├── Mobile (Expo SDK 54 / RN 0.81, "expo-app-standalone 3")  → same Next.js API over HTTPS (cookie replayed from AsyncStorage)
 │
 ├── REALTIME (apps/realtime — Worker "uxcommunity-realtime", root wrangler.toml)
 │     GET /ws       → JWT (cookie or ?token=) → resolveRoomTarget() → DO stub
 │     POST /publish → shared secret → ctx.waitUntil(fanOutEvents, bounded pool 40) → per-room DO POST
 │     GET /stats    → secret-gated aggregate counters
 │     Room DO  (Room class, SQLite-backed)  — ONE per community room (chat:*, threads:*, events:*,
 │             resources:*, showcase:*, rules:*, thread-comments:*, resource-comments:*). OWNS the WebSocket.
 │     UserDO  (UserDO class, SQLite-backed) — ONE per user (`user:${userId}`), multiplexes notifications:/profile: rooms
 │     Hibernation API + auto ping/pong; targeted fan-out via TopicSocketIndex; presence coalesced 150 ms
 │     Membership authz via internal API GET /api/communities/:id/members/:uid/check (Bearer API_SECRET,
 │             60 s in-memory LRU ≤500 entries, DO-storage mirror, pruned)
 │
 ├── Supabase Postgres (134 migrations) — data + perf RPCs (get_sidebar_activity,
 │     get_community_message_page, get_home_feed_page, get_unread_message_totals, …)
 ├── Cloudflare R2 — media bucket via aws-sdk S3 client (lib/r2.ts); presigned PUT for direct video
 │     upload; separate NEXT_INC_CACHE_R2_BUCKET for the Next.js incremental cache
 ├── Upstash Redis — sliding-window rate limits (FAIL-OPEN on outage)
 ├── Expo Push (exp.host) — server→device chat pushes; browser notifications are client-local
 ├── Resend (email), GIPHY (proxy)
 └── NO queues, NO cron jobs, NO video transcoder (video_media table DROPPED in 20260911020000;
       videos are plain R2 uploads with client-side faststart remux + first-frame poster)
```

### Mobile realtime — verified facts (not assumed)

- **Technology:** the SAME Cloudflare DO WebSocket system as web — `expo-app-standalone 3/lib/realtime.ts` is a hand-port of `apps/web/lib/realtime/client.ts`. **It does NOT use Supabase Realtime** (no `@supabase/supabase-js` realtime anywhere in the mobile app).
- **Sockets:** one WebSocket per community room (`chat:${id}` via `connect(room)` in `useChatMessages`, `useCommunities.subscribeAll`, `useCommunityContent`), plus a lazily created `user:global` socket for user rooms.
- **Auth:** JWT read from AsyncStorage, appended as `?token=` query param (React Native WebSocket cannot set custom headers).
- **Rooms:** community rooms keyed 1:1 to sockets; refcounted `subscribe()` / `on()`.
- **Reconnect:** exponential backoff 1 s → 15 s cap; heartbeat ping every 25 s, pong deadline 6 s (auto-answered by the DO without waking it); `AppState → active` probes every socket.
- **Subscriptions:** refcounted; replayed from local refcounts on open (`resubscribeConnection`).

---

## Phase 2 — Realtime audit

### Fan-out — ✅ GOOD (verified current, not the old O(N) scan)

`Room.broadcastByTopic` (`apps/realtime/src/room.ts`) reads `TopicSocketIndex.subscribers(topic)` and sends only to those sockets; the payload is serialized once per broadcast. Cost is **O(recipients)**, not O(sockets-in-room). `UserDO.deliver()` uses the same index pattern. The old "iterate every socket" revision is gone; the perf suites assert `deliverAttempts == recipients`.

### Socket lifecycle — ✅ solid

- Failed `ws.send()` → `removeSocket(ws, "send-failed")` evicts from every index AND calls `ws.close(1011)` — a dead socket cannot linger in the fan-out path. `UserDO.evictSocket` does the same.
- `webSocketClose` / `webSocketError` → removal; idempotent (double-callback safe).
- Post-hibernation reconstruction: `blockConcurrencyWhile(ensureSubscribers)` in the constructor plus per-frame `adoptSocket` fallback from attachments.
- Web client: `pongTimer` detects half-open sockets; `probeAll` on visibility/focus/online/pageshow; `detachSocket` prevents zombie handlers; `maybeRemoveConnection` marks `manuallyClosed` *before* closing so a late `onclose` cannot schedule a rogue reconnect.

### Subscription lifecycle — ✅ mostly

Per-socket topic sets (multi-tab safe); duplicate subscribe absorbed by the index; refcounted client rooms prevent one hook's cleanup from killing another's socket. Remount/reconnect replays subscriptions from refcounts.

### Presence — good at small N, structurally capped at large N

- ✅ 150 ms coalescing (`presenceCoalesced`), snapshot-signature skip, metadata cached at `join` (zero `deserializeAttachment` per flush), tabs folded into `connections`.
- ❌ `flushPresence()` iterates `ctx.getWebSockets()` and sends the **full roster to every socket** → one flush is O(N) CPU + O(N) messages with an O(N)-sized payload. See 🔴 C-2.

### Client publish path (WS `publish` frames) — ❌ under-authorized

`Room.handleWsPublish` only checks "is this socket subscribed to the topic". Any member can publish **any topic** with **any payload** at **any rate** (no Redis limiter on the WS path — the `chat:send` limits only guard the HTTP POST route). Fake `message`, `thread`, `comment`, `rule` events can be injected into peers' UIs (clients trust payload shape; `ThreadDetailClient` even refetches on injected `comment` events → amplification into DB load).

### Realtime→database refetch coupling — mostly tamed

Server publishes carry `sender_name` / `sender_avatar_url` / `reply_sender_name` (the "Someone: …" flicker fix is present). Client `thread-comments` / `showcase` handlers do a **full `fetchComments()` per event** with no debounce and no payload content — N comment events = N refetches. Chat catch-up (`?after=`) is debounced 300 ms and force-bypasses cache — correct.

### Realtime memory

- DO: all Maps bounded by live sockets/subscription pairs (`removeSocket` cleans both `byTopic` and `bySocket`); `membershipCache` hard-capped at 500; `auth:*` storage keys TTL'd and swept every 64 writes (256-key page). ✅
- Web client: `presenceCache` / `rooms` / `connections` cleaned together with rooms. ✅
- **Mobile: `conn.pending` is unbounded** — every offline publish/typing frame queues forever until reconnect. `resolvedNames` grows unbounded per session. Small but real.

---

## Phase 3 — Mobile realtime (actual implementation)

Conceptual test, 1 → 50 communities (from `useCommunities.subscribeAll`):

| Dimension | Finding |
|---|---|
| **Connections** | 1 WS per community, nothing user-scoped → 50 communities = 50 sockets. Web caps the sidebar at 15 live rooms (`SIDEBAR_REALTIME_LIMIT`) and polls the rest; **mobile has NO cap** — 50 permanent sockets from one phone, each with 25 s heartbeats (battery/cell-radio cost). |
| **Duplicate subscriptions** | None (refcounts + Set on server). |
| **Reconnect storm** | Each socket reconnects independently, no global jitter — 50 sockets can all retry at t+1 s on network recovery. |
| **Background→foreground** | `AppState` probe reconnects all; `reconcile()` re-fetches communities and takes `max(server, local)` unread. ✅ for sidebar. |
| **Missed events while foregrounded** | ❌ **mobile has no `onStatus` catch-up** (web's `useRealtimeChat` runs `debouncedCatchUp` on reconnect; the mobile port dropped it). A brief WiFi→LTE dropout in an open chat silently loses messages until the user leaves the screen or backgrounds the app. |
| **`user:global` latent defect** | Server routes user rooms to `user:${userId}` (`room-routing.ts`); mobile keys the user socket `user:global` and its `init()` lacks the web client's `migrateConnection` re-key. Today nothing subscribes user rooms on mobile (push covers notifications), so nothing breaks — the moment a notifications room is ported, events land in a DO nobody publishes to (the exact bug class `user-room-publish.test.ts` locks down for web). |
| **Logout** | `AuthContext.logout` unregisters push but **never calls `realtimeClient.close()/destroy()` and never clears client caches** (web has `resetClientSessionCaches()`; mobile has no equivalent). The old account's sockets stay open (JWT valid 7 days) and its community caches survive a user switch. |
| **Replay filter** | Mobile `isSubscriptionFrame` filters only `"subscribe"` from replayed `pending`; web filters subscribe **and** unsubscribe. A queued unsubscribe replayed after reconnect can silently unsubscribe the room. |

---

## Phases 4–5 — Database / Postgres audit & scaling

### Verified-good

- All list/read paths use keyset-paginated RPCs with `LIMIT` and `(community_id, created_at, id)` indexes.
- `20260926120000_sidebar_scan_bounds` really did bound unread counts by `greatest(last_read_at, joined_at)` and replaced `DISTINCT ON` scans with LIMIT-1 laterals plus three new `(community_id, created_at desc)` indexes. ✅ Verified in current SQL, not just docs.
- Push recipient reads: keyset-paged at 500; token/preference/throttle reads chunked; `get_unread_message_totals` chunked at 300; `push_throttle` / `push_tokens` / reactions protected by PK/unique constraints.
- No `SELECT *` outside 3 occurrences; no giant unchunked `IN` in hot paths.

### Verified problems

| # | Query / file | Problem | Growth |
|---|---|---|---|
| D1 | `get_sidebar_activity` → `member_counts` CTE (`20260926120000`, L38-41) | `SELECT count(*) … GROUP BY community_id` over **every membership row of every community the user is in**, executed on **every** `GET /api/communities` (web sidebar) and every mobile foreground `reconcile()`. No cap, no cache. A user in 30 communities of 100k members = 3M index rows counted per request. | O(total membership of user's communities) per request |
| D2 | `get_all_communities` → `membership_aggregates` (`20260924130000`, L119-124) | `count(*) … GROUP BY cm.community_id` over the **entire `community_members` table** (no WHERE) on every explore/all-communities load. | O(all memberships in DB) per request |
| D3 | `loadCommunityMembersPage` (`lib/communities/read-models.ts` L375-390) | `select(...).eq(community_id)` with **no limit in SQL**, then `slice(0, 30)` in JS. A 50k-member community transfers 50k rows to render 30. | O(community size) per page view |
| D4 | `loadContentEventIds` (`app/api/communities/[id]/messages/route.ts` L18-29) | 4 extra queries (threads/showcase/resources/events LIMIT 50) on **every** chat page fetch (`withContentReactions=1` is always set by `useChatData`) — not cached, not needed by mobile callers. | +4 queries/chat fetch |
| D5 | Push fan-out per message (`lib/push/chat.ts`) | 10k members = 20 chunks × (members+tokens+prefs+throttle+unread RPC) ≈ **100 sequential Supabase queries + 100 sequential Expo HTTP batches** inside the route's `after()`. The 20 s budget truncates at ~2–3k deliveries; the rest get **no push, no retry, no record**. | O(members/chunk) queries; hard ceiling ~3k pushes/message |
| D6 | `get_community_message_page` content-reactions lateral | `content_reactions` is attached **identically to every row** of the 50-row page (the route deletes the copies *after* transfer — wire cost remains 50×). | 50× duplicate JSON per page |
| D7 | `createNotification` dedupe (`lib/notifications.ts` L70-115) | read-then-insert/update with **no unique constraint** on `(user_id, entity_type, entity_id, read_at)` → concurrent events create duplicate rows. | race, not scale |

### Scaling classification (100 → 100k users; 10k → 10M messages)

- Messages growth: **acceptable** — every message query is watermark- or cursor-bounded; 10M rows would not change page/unread behavior.
- Member-count queries D1/D2: **critical** at ≥10k-member communities × ≥1k users.
- Presence/roster: **critical** at ≥10k members in one room (see Phase 9).
- Push fan-out D5: **needs optimization** beyond ~1–2k members; **critical** beyond ~5k.
- D3 / D4 / D6: **needs optimization** (cheap fixes).

---

## Phase 6 — Push notifications (traced end-to-end)

`POST /messages` → `after()` → `sendChatMessagePush` (`lib/push/chat.ts`): community name → keyset member pages (muted excluded in SQL) → tokens → prefs + throttle + unread totals (parallel) → per-user audible budget (`nextPushBudget`, 3/min/community), quiet hours in the user's timezone, badge = server unread total → Expo batches of 100 (sequential) → dead-token (`DeviceNotRegistered`) deletion in 200-token batches.

- ✅ Non-blocking (`after()`), chunked, budget-capped, dead-token cleanup, silent-channel design, collapse-id per community, `push_throttle` PK upsert (atomic). `after()` + the 20 s/10k bounds mean the platform *cannot* kill it silently mid-way without a record — truncation is detected and logged once.
- ❌ **No durable queue.** Process death / Expo outage / budget expiry = permanent loss for un-reached recipients for that message (mitigated only by app-open badge resync). No job table, no retries, no idempotency key — a retried HTTP request would double-push, but clients don't retry POST /messages automatically, so observed duplicate risk is low.
- ❌ `sendExpoPushDetailed` has **no 429 / `MessageRateExceeded` backoff** — at Expo's 600 notif/s project limit, two busy communities can trip it and the affected chunk is just logged.
- Capacity: 100 recipients fine · 1,000 fine (~10 s) · 10,000 truncated ~70% · 50,000 truncated ~95% (and D1/D5 DB load beforehand).

---

## Phase 7 — Cache audit

| Cache | File | Size/TTL | Verdict |
|---|---|---|---|
| `request-cache` | `lib/request-cache.ts` | 100 entries, per-user keys, 30 s–15 min, in-flight dedupe, cleared on session change | ✅ |
| Master-data maps | `lib/master-data-cache.ts` | `unstable_cache` 1 h, tag-invalidated, R2-backed via NEXT_INC_CACHE_R2_BUCKET | ✅ |
| Home feed | `app/api/home/feed/route.ts` | `unstable_cache` 10 s per (user, cursor, scope) | ✅ (10 s cross-isolate stampede possible but bounded by page limit 30) |
| DO membership | `apps/realtime/src/room.ts` | 500-entry LRU, 60 s TTL, fail-closed on API error | ✅ |
| `getUserStatusCached` | `lib/auth/user-status-cache.ts` | 15 s TTL, in-flight dedupe — **Map unbounded** across users per isolate | 🟡 minor |
| Web client msg/meta caches | `lib/communities/cache.ts` | `BoundedCommunityMap` 25 + eviction of satellite maps | ✅ |
| Link previews | `lib/communities/linkPreviewCache.ts` | capped, 10 min fresh / 60 s negative | ✅ |
| Mobile `resolvedNames` / `conn.pending` | `expo-app-standalone 3/lib/realtime.ts` | **unbounded** | 🟡 |
| DO metrics | `apps/realtime/src/metrics.ts` | in-memory, reset on DO eviction (observability only) | — |

No cache was found that can serve *cross-user* stale data (all keyed by user or by ephemeral room state).

---

## Phase 8 — API performance

- Auth + rate-limit + membership parallelized in the chat POST; sender profile fetched once and published with the event; the response returns only the inserted row (2–3 round trips removed — verified in code). ✅
- `publishRealtime*` aborts at 1.5 s / 3 s; the DO membership check at 3 s — no unbounded waits. ✅
- **`createServerTimer` is dead instrumentation**: `finish()` stores details that no code path ever emits (no `Server-Timing` header, no log). Routes are "measured" invisibly.
- Global middleware = 1 Redis roundtrip on every request; fail-open (documented risk).
- Long-running work is properly `after()`-deferred in 7 routes (chat, reactions, comments, notifications); 32 routes publish realtime (`void` fire-and-forget — deliberate).
- No HTTP caching on per-user endpoints (correct); master-data/feed cached server-side (correct).

---

## Phase 9 — Cloudflare / Durable Objects

- Both DO classes use hibernation + auto ping/pong → idle rooms cost ~nothing. ✅
- **Hot-room ceiling:** one Room DO is single-threaded (soft ~1,000 req/s), 128 MB isolate, ≤32,768 hibernating WebSockets per DO. Presence makes every join/close O(N) messages with an O(N) payload; typing (a topic everyone in chat subscribes to) is O(N) per keystroke-burst. A **10k-member** room produces multi-MB presence snapshots per 150 ms window under churn; **50k is impossible** (payload alone approaches message/memory limits; fan-out alone exceeds 1k req/s). Practical design ceiling ≈ **2–5k members/community** without sharding — no sharding exists.
- WS-client publish path (Phase 2) bypasses all rate limits → one member can load their own Room DO (blast radius contained by 1-DO-per-community).
- DO storage: only `auth:*` keys; bounded + pruned. ✅
- No alarms, no DO→DO RPC on the delivery path. ✅

---

## Phase 10 — R2 / uploads

- Images: client-compressed (Canvas / expo-image-manipulator), server sniffs the signature, buffers ≤20 MB in memory (`Buffer.from(await file.arrayBuffer())` in 14 routes) — a 128 MB isolate tolerates a few concurrent; a burst can 1102.
- Videos: **direct presigned PUT** (10-min ticket, pinned content-type, server HEAD-verify) — bytes never flow through the app on the default path. ✅
- **Proxy fallback** buffers the whole ≤50 MB video in Worker memory + multipart parse ≈ 2× → 2–3 concurrent fallback uploads can OOM the isolate. 🟠
- Orphans: reference-aware cleanup (`lib/r2-cleanup.ts`), failed-insert compensation in community create, admin R2 audit, grace period. Direct-upload-then-abandoned-post orphans are caught only by the next manual audit — no scheduled scan (no cron exists). 🟡
- CDN: uploads tagged immutable 1y; `wrangler.toml` correctly notes `pub-*.r2.dev` bypasses the edge cache and a custom domain is required. ✅

---

## Phase 11 — Video pipeline

**There is no transcoder.** `20260911020000_drop_video_media.sql` removed the lifecycle table; today: client faststart remux + first-frame poster → R2 (direct PUT preferred) → plain playback. No job claiming, stuck jobs, crash recovery, or duplicate-job surface exists *because the pipeline doesn't exist*. Residual risks: MOV/WebM stored as-is (browser compatibility unmanaged); proxy fallback memory (above); no server-side codec validation. Older audit docs describing FFmpeg / `video_media` are **obsolete**.

---

## Phase 12 — Concurrency / race conditions

| Site | Protection | Verdict |
|---|---|---|
| Membership rows | PK `(community_id, user_id)` | ✅ atomic |
| Reactions (message/content) | `unique` constraints | ✅ |
| `push_throttle` budget | PK upsert `onConflict` | ✅ |
| `push_tokens` re-point | PK `token` upsert | ✅ |
| WS duplicate subscribe/unsub | Set semantics; idempotent `removeSocket` | ✅ |
| Double-submit chat | global fetch dedupe (2 s mutation cooldown) + Redis limits | ✅ |
| **Notification dedupe** | read-then-write, **no unique constraint** | ❌ duplicates possible |
| Community create (community→member→rules) | compensating deletes, non-transactional | 🟡 bounded (owner is actor) |
| `last_read_at` | read-then-write, benign race (by design — needs the previous value) | ✅ |
| Concurrent DO publish + hibernation reconstruct | `blockConcurrencyWhile` + shared promise | ✅ |

---

## Phase 13 — Frontend performance (web)

- `MessageList` is memoized; sidebar caps live sockets (15) and only polls when over the cap; global fetch dedupe + request cache eliminate duplicate fetch storms; optimistic replies matched by `pickOptimisticMatch` (no duplicate bubbles); unread dividers driven by the server watermark.
- Chat renders **every loaded message** (no windowing on web; 50/page grows unbounded with scrolling) — heavy sessions accrue DOM nodes. 🟡
- `CommunityChat.tsx` is 1,220 lines with many interacting effects (chat, timeline, typing, presence, mentions) — correctness is handled (refcounts + cache mirrors), but it is the app's render-hotspot.
- `loadCommunityMembersPage` (D3) is the only server-driven list perf cliff found.

---

## Phase 14 — Mobile performance

- Chat uses `FlatList` with `keyExtractor`, `maintainVisibleContentPosition`, `onEndReached`, `onScrollToIndexFailed` recovery — 100 / 1,000 / 10,000 messages virtualize fine. ✅
- 50 uncapped sockets (one per community) with 25 s heartbeats — battery/radio cost grows linearly with membership; web solved this with `SIDEBAR_REALTIME_LIMIT`, mobile didn't. 🟠
- `useCommunities` typing timers are cleaned per key; `flushTyping` is O(communities×users) per typing event — fine at current scale.
- No offline queue for chat sends (send fails → user retries); acceptable.

---

## Phase 15 — Security × performance interactions

- ✅ Caches never cross users (`canonicalRequestKey` includes userId; `initRequestCache` clears on change; `resetClientSessionCaches` on web session boundaries). Public-read exposure closed by `20260926000000` (policies dropped, grants revoked, RLS default-deny) — verified.
- ❌ **Mobile logout/session-switch leak** (Phase 3): sockets + module caches from the previous account survive on-device — a privacy bug in a shared-device scenario, *and* a perf liability (ghost sockets).
- ❌ WS publish spoofing (Phase 2) — the "fast path" skips every validation the HTTP path has.
- 🟡 JWT in URL (`?token=`) for mobile (and web fallback) — a 7-day credential in any intermediary/query log.
- 🟡 `checkMembership` returns **true (fail-open) when `API_URL` is unset** — one missing env var silently disables room authorization (JWT still required, so still authenticated-only).
- ✅ `push_tokens` locked to service role; `get_unread_message_totals` / `get_sidebar_activity` revoked from anon/authenticated.

---

## Phase 16 — Observability

Can production answer the audit's questions today?

| Question | Answerable? |
|---|---|
| Realtime connections per room / hottest communities | ⚠️ `/stats` exists (secret-gated, aggregate-only, per-DO `instanceId`) but **nothing scrapes it** — no cron, no dashboard; metrics are in-memory and reset on DO eviction |
| Failed WS sends / reconnects / presence skips | Same — counters exist (`sendFailures`, `presenceCoalesced`, …), never collected |
| Push job duration / failures | ⚠️ `ChatPushReport` returned + one aggregate warn on truncation; not persisted |
| Slow API routes | ❌ `createServerTimer` records into an object that is never emitted — dead code |
| Slow DB queries | ❌ no `pg_stat_statements` wiring, no slow-query logging |
| Worker CPU / DO storage | ❌ nothing consumes the `[observability]` logs |
| Stuck video jobs | N/A (no pipeline) |
| Errors/uptime | ❌ no error tracking anywhere |

Missing-but-cheap: scrape `/stats` on an interval, emit `Server-Timing`, persist push reports, enable Supabase query insights. The codebase *deliberately* avoids per-message logs (good) — the gap is collectors, not hygiene.

---

## Phase 17 — Load-test correctness

- ✅ `apps/realtime/__tests__/perf-fanout-final.test.ts` (fixed in f49c2224): subscribers connect **to the room under test**, wait for the DO's own `subscriptionRefs`, assert `delivered == recipients`, `duplicates == 0`, leaked 0. Meaningful. `perf-hot-communities` asserts per-community delivery **and cross-leakage == 0** via `countForeignEvents`. `user-room-publish.test.ts` locks the routing bug. These pass *and* prove the right thing.
- ❌ **`k6/loadtest-5k.mjs` (the production 5k test) is stale and invalid for the current architecture**: it connects every client to `user:${id}` (`buildWsUrl`, L78) but subscribes to `chat:${COMMUNITY_ID}` (L275). Under the current routing those sockets live in 5,000 different UserDOs while the publish goes to the community Room DO → the script measures an **empty room** and its ≥99% delivery gate can never pass. Only `staging-loadtest-5k.mjs` connects `chat:` directly. The exact failure mode the vitest suites were repaired for was **not** repaired here.
- ✅ k6 HTTP scenarios hit real endpoints with seeded users (`seed-users.js`); fixture shape guarded by `test:k6-fixtures`.
- Gap: no soak test for DO memory/hibernation churn; no load test of the push path's chunking.

---

## Phase 18 — Failure / recovery

| Failure | Behavior today | Verdict |
|---|---|---|
| Supabase outage | Routes 500; DO membership check fails → **fail-closed** (new connections denied); existing sockets keep working | ✅ |
| Redis/Upstash outage | Rate limits fail-open (documented) | 🟡 known |
| DO eviction/restart | Hibernation preserves sockets+subscriptions via attachments; in-memory counters reset (`instanceId` exposes this) | ✅ |
| Worker drop of a `/publish` fan-out | Fire-and-forget; loss recovered only by client catch-up triggers (reconnect/visibility/subscribe). A connected, healthy client that never refocuses never resyncs | 🟠 partial |
| Push provider outage / budget expiry | Chunk failure or 20 s expiry → remaining recipients silently skipped, no retry, no queue | 🟠 |
| Expo 429 | No backoff; chunk logged, loop continues | 🟡 |
| R2 outage | Upload 500; client XHR has no retry (manual) | ✅ acceptable |
| Mobile network switch in foreground | Dead socket detected by heartbeat within ≤31 s; **no chat catch-up after reconnect** | 🟠 |
| Mobile logout | Ghost sockets + stale caches (Phase 15) | 🟠 |
| Reconnect storm | Client backoff 1→15 s; server presence coalesced 150 ms; no jitter on mobile's 50-socket reconnect | 🟡 |

---

## Phase 19 — Platform limits (verified: official docs + repo config)

| Service | Limit (source) | Current usage | Risk |
|---|---|---|---|
| Cloudflare Workers | 128 MB isolate; 30 s CPU/request (configurable); **50 subrequests/req free, 10,000 paid**; 100 k req/day free (Workers limits docs, Sep 2026) | Fan-out pool 40/req; ≤6 simultaneous conns respected | 🟡 if free plan: 50-subrequest cap interacts with per-request DB-call fan-outs |
| Durable Objects (SQLite, both classes per wrangler.toml migrations) | ≤32,768 hibernating WS/DO; 32 MiB inbound message; 30 s CPU per request *per WS message*; 10 GB storage/DO; soft 1,000 req/s/DO (DO limits docs) | 1 Room per community; presence O(N)/flush | 🔴 hot-room ceiling ~2–5k members (presence), not 32 k |
| Cloudflare R2 | Free 10 GB total; Class A/B ops; CDN only via custom domain (docs + wrangler comment) | Immutable cache-control set; NEXT_INC cache bucket separate | 🟢 |
| Expo Push | **600 notifications/s/project**; 100 messages/request (Expo docs) | 100/request, sequential, no 429 backoff | 🟠 >600/s aggregate |
| Supabase (free/micro per INFRASTRUCTURE-AUDIT) | ~500 MB DB, 5 GB egress/mo, small connection cap; service-role client per request (no pooler in app code) | hottest endpoint = sidebar (D1) | 🔴 D1/D2 at scale |
| Upstash REST | Per-request latency ~10–50 ms; account rate limits | 1 middleware check + per-route limits, fail-open | 🟢 |
| Mobile OS | Sockets killed in background (handled by probe+push); query-param tokens unavoidable on RN | heartbeat 25 s / 6 s | 🟡 |

---

## Phase 20 — Final risk report

### 🔴 CRITICAL

**C-1. Sidebar unread/member-count aggregation scales with total memberships, per request**

1. `get_sidebar_activity`'s `member_counts` CTE counts every membership of every community the caller belongs to; `get_all_communities` counts the entire `community_members` table.
2. `supabase/migrations/20260926120000_sidebar_scan_bounds.sql` (member_counts CTE); `supabase/migrations/20260924130000_event_chat_communities.sql` (membership_aggregates); hot paths `GET /api/communities` (`lib/communities/sidebar-server.ts`) and `GET /api/communities/all`.
3. Every sidebar load, every mobile foreground reconcile, every explore view runs unbounded `COUNT(*)` aggregation.
4. Real-world: a user in 30 communities × 10k members = 300k counted rows per request; 500 users refreshing over a minute ≈ 150M row-counts/min on micro compute.
5. At 100k users the DB saturates before any other subsystem; latency degrades globally because it is the first request every client makes.
6. O(Σ community sizes of user) per request — linear in dataset, executed at request rate.
7. Production outage-grade DB load.
8. Verified in the current SQL files; `supabase/tests/performance_rpcs.test.sql` asserts *function existence*, never cost.
9. Maintain `member_count` on `communities` (trigger or periodic), or replace with a bounded estimate; expose real counts only on the members page.
10. Medium (SQL + backfill + trigger). **Fix before production.**

**C-2. Hot-room architecture ceiling: presence/typing are O(N)-message broadcasts with O(N) payloads from a single-threaded DO**

1. `Room.flushPresence()` sends the full roster to every socket; the typing topic is subscribed by every chat participant; one Room DO serves the whole community.
2. `apps/realtime/src/room.ts` (`flushPresence`, `broadcastByTopic`); mobile/web typing publishes.
3. One join/close → a coalesced snapshot of N entries × M sockets within 150 ms.
4. Real-world: a 10k-member community's reconnect wave (app release, network blip) produces ~10k × 10k sends ≈ 100M frames; the DO hits CPU/1k-req-s/overload and every member's chat stalls, not just the churning users.
5. Growth in community size is multiplied into every membership event.
6. O(N²) per churn window; O(N) per presence flush even when idle.
7. Room-wide realtime collapse at ≥~5–10k members; memory (128 MB) threatened by snapshot strings before that.
8. Fan-out *per publish* is already O(recipients) (perf suites prove it) — presence/roster is the residual O(N) path, confirmed at `flushPresence`.
9. Shard hot communities across N Room DOs behind a coordinator (directory DO); switch presence to deltas (`presence_delta` already exists server→client, unused); cap roster size (top-K + count).
10. Large (architecture change). **Gate for "large communities" — before scaling marketing, not before first production users.**

**C-3. WebSocket publish path is unvalidated and unthrottled — client-injected events + amplification**

1. Any member can publish any topic/any payload at any rate; peers' handlers then fetch (amplification into DB) or render spoofed content.
2. `apps/realtime/src/room.ts` `handleWsPublish`; consumers e.g. `ThreadDetailClient.tsx` L116-122.
3. `{t:"publish", topic:"message", data:{…fake}}` from a member socket broadcasts to the whole chat room, bypassing the Redis limits, content validation, and mention validation that the HTTP POST route enforces.
4. Real-world: one member in a 500-member community sends 50 spoofed "message" events/s → every client renders garbage and (for comment topics) refetches comments 50×/s → self-inflicted DB DoS.
5. Cost grows linearly with room size for one attacker; requires no auth beyond membership.
6. O(recipients) per injected frame, attacker-controlled rate.
7. Integrity + resource exhaustion.
8. No per-topic authz, no rate limit, no schema validation on the WS publish path (verified; the HTTP path has all three).
9. Rate-limit publishes per socket in the DO; restrict client publish to an allow-list of topics (`typing`); validate shape; drop server-owned topics (`message`, `thread`, `rule`, …) from client publish.
10. Small. **Fix before production.**

### 🟠 HIGH

**H-1. Mobile loses chat messages after foreground reconnect; ghost sessions after logout**

1. No `onStatus` catch-up on mobile (web has it); logout doesn't close sockets or clear caches; `user:global` key mismatched to server routing (`user:${userId}`).
2. `expo-app-standalone 3/lib/realtime.ts` (`resubscribeConnection`, `getRoomConnection`, missing `migrateConnection`); `expo-app-standalone 3/context/AuthContext.tsx` `logout`.
3. A brief network loss in an open chat → resubscribe happens, missed messages never fetched; logout → the previous account's sockets stay live (7-day JWT) and caches persist for the next user.
4. Real-world: two people sharing a phone; the second login shows the first account's community previews and its sockets still receive its groups.
5. Correctness + privacy; grows with JWT lifetime (7 days).
6. Constant per incident; unbounded cache growth per long session.
7. Silent data loss / cross-account data exposure on device.
8. Verified: no `onStatus` usage in mobile hooks; no `realtimeClient.close` in logout; `room-routing.ts` has no `user:global` handling.
9. Port web's `debouncedCatchUp`-on-status, `migrateConnection`, and a mobile `resetClientSessionCaches()` called at logout/login.
10. Small-medium. **Fix before production (mobile release).**

**H-2. Push fan-out silently truncated beyond ~2–3k recipients; no retry/durable queue**

1. The 20 s budget + sequential Expo batches + ~100 DB queries per 10k members; failure = permanent loss for the rest.
2. `apps/web/lib/push/chat.ts` (PUSH_TIME_BUDGET_MS, sequential chunk loop); `lib/push/expo.ts` (no 429 backoff).
3. A 10k-member community message → ~70% of devices get nothing; nothing records which.
4. At scale, "push is unreliable" becomes the default experience for large communities.
5. Linear in members; Expo's 600/s project cap is shared by all communities.
6. O(members/chunk) queries + O(members/100) HTTP roundtrips.
7. Silent partial delivery of the primary background channel.
8. Constants + loop verified; the report is only logged on truncation.
9. Near-term: raise the budget inside `after()` cautiously, parallelize Expo batches (respecting 600/s), persist a `ChatPushReport`. Proper: Cloudflare Queue or a `push_jobs` table + worker. Existing infra (after() + budget) is *sufficient ≤1–2k members* — a queue is not yet mandatory.
10. Medium. **Fix soon** (before communities >1k members).

**H-3. `k6/loadtest-5k.mjs` tests an empty room (stale architecture)**

1. Connects `user:${id}` sockets but subscribes/publishes `chat:*`; under current routing those never meet.
2. `k6/loadtest-5k.mjs` L78 vs L275.
3. A "5,000-socket production load test passed" claim cannot be produced by this script; it fails its own ≥99% gate or, worse, reads against the old RPC fan-out.
4. The team believes the production realtime tier was 5k-validated when only the *staging* variant (direct `chat:` sockets) measures the real path.
5. Test debt compounds with C-2 (even a fixed script hasn't been run against a sharded design).
6. n/a (correctness of verification, not runtime).
7. False confidence at exactly the scale that matters.
8. Contrast with `k6/staging-loadtest-5k.mjs` L93-96 and commit f49c2224, which fixed the identical bug in the vitest suites but not here.
9. Port the staging script's room handling into the production script; assert foreign-event isolation; run it pre-GA.
10. Small. **Fix soon.**

**H-4. Video proxy fallback buffers ≤50 MB per upload in a 128 MB Worker**

1. `Buffer.from(await file.arrayBuffer())` on the multipart video path; 2–3 concurrent → 1102 memory errors; images ≤20 MB share the exposure.
2. `apps/web/app/api/communities/[id]/showcase/upload/route.ts`; the same pattern in 13 other upload routes (images).
3. Real-world: two members upload videos while ticketing fails (presign outage) → both fail with opaque 1102s.
4. Rare path, but fails exactly when the direct path is already broken.
5. Memory limit. Evidence: verified code path.
9. Stream to R2 (S3 multipart streaming) or reject proxy video when presign is down (fail loudly).
10. Small. **Fix soon.**

### 🟡 MEDIUM

| # | Finding | Where |
|---|---|---|
| M-1 | No durable retry for realtime publishes — a lost event survives until the client's next focus/visibility trigger; connected kiosk-like clients never resync (fire-and-forget by design; DB is source of truth). Fix later: short-TTL event cursor + `?after=` on subscribe ack. | `lib/realtime/publish.ts` |
| M-2 | Members page fetches all members then slices 30 — add SQL `limit`/`range`. | `lib/communities/read-models.ts` L375 |
| M-3 | `content_reactions` shipped 50× per message page (RPC design; route de-dupes post-transfer) — restructure RPC to return it once. | `20260923210000_message_page_content_reactions.sql` |
| M-4 | Notification dedupe race — add a unique partial index `(user_id, entity_type, entity_id) WHERE read_at IS NULL`. | `lib/notifications.ts` |
| M-5 | `createServerTimer` is never emitted — wire `Server-Timing` or drop it. | `lib/server-timing.ts` |
| M-6 | `/stats` never scraped; no error tracking; no DB slow-query visibility — one scheduled scraper + Sentry closes most of Phase 16. | repo-wide |
| M-7 | JWT as URL query param (mobile, web fallback) — short-lived realtime tickets preferred. | `expo-app-standalone 3/lib/realtime.ts` |
| M-8 | DO membership fail-open when `API_URL` unset — make misconfiguration fail closed/log once. | `apps/realtime/src/room.ts` `checkMembership` |
| M-9 | Mobile uncapped per-community sockets — port web's top-N + polling cap. | `expo-app-standalone 3/lib/realtime.ts` |
| M-10 | Mobile `isSubscriptionFrame` misses `unsubscribe` — parity bug; queued unsubscribe can unsync a room after reconnect. | `expo-app-standalone 3/lib/realtime.ts` |
| M-11 | `loadContentEventIds`: 4 queries per chat fetch — cache per community 60 s. | `app/api/communities/[id]/messages/route.ts` |

### 🟢 LOW / don't worry about

`push_throttle` growth (bounded by memberships) · `getUserStatusCache` unbounded-but-tiny Map · link-preview cache (capped) · presence metadata caching (correct) · DO storage `auth:*` sweep (bounded) · R2 orphan window (manual audit acceptable at current scale) · missing `getItemLayout` (variable heights — correctly avoided) · video transcoder absence (simpler architecture is fine for ≤50 MB MP4-first uploads) · Upstash fail-open (documented tradeoff).

---

## Final summary

### 🔴 Fix before production

1. **C-1** — Sidebar/all-communities `COUNT(*)` aggregation (materialize member counts)
2. **C-3** — WS publish path: rate-limit + topic allow-list + payload validation
3. **H-1** — Mobile reconnect catch-up + logout session wipe (privacy + correctness)

### 🟠 Fix soon

4. **C-2** — Presence/typing sharding plan for hot communities (deltas + top-K first; shard later)
5. **H-2** — Push fan-out parallelization + persisted reports; queue only if >1–2k-member communities are real
6. **H-3** — Replace/rebuild `k6/loadtest-5k.mjs` for current room routing
7. **H-4** — Stop buffering proxy video uploads in Worker memory

### 🟡 Later

M-1 event cursor/resync · M-2 members page SQL pagination · M-3 content_reactions wire dedupe · M-4 notification unique index · M-5 Server-Timing · M-6 stats scraper + error tracking · M-7 realtime tickets · M-8 fail-closed membership config · M-9 mobile socket cap · M-10 unsubscribe replay parity · M-11 content-ids cache

### 🟢 Don't worry about

Everything in the LOW list above — deliberate, documented, or bounded tradeoffs. Several current design choices are genuinely good: the targeted fan-out index, watermark-bounded unread counts, bounded client caches, WebSocket hibernation with auto ping/pong, presigned direct video upload, and the no-transcoder video path.

### Recommended engineering roadmap

**PR 1 — Realtime hardening (small, high value)**
DO-side publish rate limit + topic allow-list + payload validation (C-3); mobile `onStatus` catch-up + `migrateConnection` + logout cache/socket wipe (H-1); mobile unsubscribe-replay parity (M-10). No DB change, no flags.

**PR 2 — DB scale fixes**
Materialized `member_count` on `communities` (+ trigger + backfill) consumed by `get_sidebar_activity` and `get_all_communities`; SQL-limit `loadCommunityMembersPage`; unique partial index for notification dedupe; members-page + content-ids caching (C-1, M-2, M-4, M-11). Includes pgTAP cost assertions.

**PR 3 — Push & observability**
Parallelize Expo batches with 600/s pacing, raise the per-message ceiling, persist `ChatPushReport`; scrape `/stats` into a metrics endpoint; emit `Server-Timing`; add Sentry; rebuild the 5k load test for current routing and record a baseline (H-2, M-5, M-6, H-3).

**PR 4 — Hot-community readiness (design spike → PR)**
Presence deltas + roster top-K, then Room sharding with a directory DO for communities above a size threshold (C-2).
