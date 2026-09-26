# FULL PRODUCTION INFRASTRUCTURE AUDIT
## UX Community — Complete Architecture Analysis

> **Revision note (2026-09-26).** First generated 2026-08-31. The structural
> claims below were re-verified against the current tree and corrected where the
> code had moved or changed: the realtime worker now runs **two** Durable Object
> classes (`Room` per community + `UserDO` per user), the **mobile app uses the
> same Cloudflare realtime path as the web app** (Supabase Realtime is gone), a
> chat message publishes **one** room event plus an optional Expo push fan-out,
> notifications are engagement-only and deferred via `after()`, and `lib/` is the
> domain layer (`lib/communities/models/*`, `membership.ts`, `mark-read.ts`).
> Estimates that were not re-measured are still marked ESTIMATE.

---

# EXECUTIVE SUMMARY

## Top 10 Findings

1. **Dual deployment architecture** — The app runs on both Cloudflare Workers (via OpenNext) and Vercel. The current active deployment is Cloudflare Workers. The Vercel dashboard numbers reflect the alternate deployment path.

2. **Chat fan-out is one room event plus push** — Sending ONE chat message triggers 1 database INSERT, 1 realtime publish to the community's `chat:${id}` room (the DO broadcasts to every socket in that room), and a deferred Expo push fan-out to members who are not connected. There is no per-member Durable Object forward or per-member notification row anymore; the cost that remains is the push fan-out, which is chunked and bounded (`PUSH_MAX_DELIVERIES`, `PUSH_TIME_BUDGET_MS`).

3. **Sidebar caps live sockets** — `SIDEBAR_REALTIME_LIMIT` (15) bounds the community chat sockets the sidebar keeps open, most-recently-active first; anything beyond that is caught up by a periodic sidebar refetch. Active chat, presence, typing, and tab rooms add a handful more (typically 3-8 concurrent sockets per user).

4. **One realtime system for web and mobile** — Both clients connect to the Cloudflare Durable Object worker (`apps/realtime`) with the same JWT and room/topic model. Supabase Realtime is not used for chat/content updates on either client; mobile differs only in OS-level socket liveness handling.

5. **Service-role key used for ALL database queries** — Every API route and Server Component uses the Supabase service-role key, bypassing RLS. This is intentional (custom JWT auth, not Supabase Auth) but means database security depends entirely on API route validation.

6. **No Supabase Auth** — Authentication is fully custom (JWT via `jose`, bcrypt password hashing). Supabase Auth is not used.

7. **129 API route handlers** — The web app has 129 Next.js route handlers under `app/api/`, all running as serverless functions on Cloudflare Workers. Each involves a DB query.

8. **Well-implemented caching** — Sophisticated client-side caching: `request-cache.ts`, `cache.ts` (module-level community/message cache), `msgCache`/`metaCache` (bounded LRU maps), `master-data-cache.ts` (1-hour cached master data), `dedupe-fetch.ts`.

9. **Rate limiting is layered** — Global guard: 20 requests/10s burst, 120/60s sustained per user or IP. On top of that, per-route limits cover login (IP + email), applications, password reset, sign-up steps, chat sends (5/10s + 20/60s), content creation, comments, and reactions (`lib/auth/rate-limit.ts`).

10. **Chat messages API has special timeout handling** — `maxDuration: 10` in `vercel.json` for the messages endpoint. It calls the `get_community_message_page` RPC, then publishes one realtime event and the push fan-out from an `after()` block.

---

# CURRENT ARCHITECTURE

```
User (Browser)
  |
  |--- HTTPS ---> Cloudflare CDN/Workers (OpenNext)
  |                  |
  |                  |--- GET/POST ---> ~100 API Route Handlers (Serverless)
  |                  |                      |
  |                  |                      |--- Service-Role ---> Supabase PostgreSQL
  |                  |                      |--- PUT/DELETE -----> Cloudflare R2 (images)
  |                  |                      |--- POST -----------> Resend (email)
  |                  |                      |--- POST -----------> GIPHY API
  |                  |                      |--- POST -----------> Expo Push Service
  |                  |                      |--- POST -----------> Cloudflare Realtime (/publish)
  |                  |
  |                  |--- SSR/ISR ---> Server Components (data fetching)
  |
  |--- WSS ----> Cloudflare Realtime Worker (rt.uxcommunity.in)
                    |
                    |--- WebSocket ---> Room DO (per community: chat, threads, events, …)
                    |--- WebSocket ---> UserDO (per user: notifications, profile)
                                          |
                                          |--- SQLite storage (presence / subscriptions)
                                          |--- Broadcast to subscribed sockets

User (Mobile/Expo)
  |
  |--- HTTPS ---> Same Cloudflare Workers (API routes)
  |--- WSS ----> Same Cloudflare Realtime Worker (Room DO / UserDO)
```

### Deployment Stack
- **Primary**: Cloudflare Workers via OpenNext (`apps/web/wrangler.toml`)
- **Alternate**: Vercel (`apps/web/vercel.json`, region: syd1)
- **Realtime**: Separate Cloudflare Worker (`apps/realtime/wrangler.toml`, root `wrangler.toml` mirrors it)
- **Durable Objects**: `Room` (per community, migration v1) and `UserDO` (per user, migration v2)
- **CI**: GitHub Actions — `ci.yml` (types + unit tests), `preview.yml` (per-PR worker)
- **CD**: `.github/workflows/deploy.yml` on push to `main`

### Technology Inventory

| Component | Technology | Provider | Purpose |
|---|---|---|---|
| Frontend | Next.js 14 (App Router) + React 18 | OpenNext/Cloudflare | Web application |
| Mobile | Expo SDK 54 + React Native | EAS Build | Mobile app |
| Backend | Next.js API Routes (129 handlers) | Cloudflare Workers | Serverless API |
| Database | PostgreSQL | Supabase | Primary data store |
| Realtime (Web) | Cloudflare Durable Objects + WebSocket Hibernation | Cloudflare | Chat, presence, typing |
| Realtime (Mobile) | Same Cloudflare Durable Object worker, via the RN WebSocket client | Cloudflare | Chat, typing, content updates |
| Push | Expo Push Service (+ FCM/APNs) | Expo | Background chat notifications |
| Authentication | Custom JWT (jose) + bcrypt | Application | User sessions |
| Storage | Cloudflare R2 (S3-compatible) | Cloudflare | Image/file storage |
| CDN | Cloudflare | Cloudflare | Static assets, edge |
| Rate Limiting | Upstash Redis | Upstash | Request throttling |
| Email | Resend | Resend | Transactional email |
| Image Processing | Canvas API (web), expo-image-manipulator (mobile) + signature validation (server) | Application | Image compression |
| GIF Search | GIPHY API | GIPHY | GIF search |
| Validation | Zod | Application | Input validation |

### Infrastructure Services Used
- ✅ Vercel (alternate deployment)
- ✅ Supabase (PostgreSQL)
- ✅ Cloudflare (Workers, Durable Objects, R2, CDN)
- ✅ PostgreSQL (via Supabase)
- ✅ Expo Push Service (chat notifications)
- ✅ Vercel Functions (alternate deployment)
- ✅ Vercel Edge Functions (middleware on Vercel)
- ✅ Cloudflare Workers (primary deployment)
- ✅ Cloudflare Durable Objects (realtime: `Room` + `UserDO`)
- ❌ Redis (Upstash used for rate limiting only, not caching)
- ❌ Queues (no job queues)
- ❌ Cron Jobs (only Vercel keep-warm cron)
- ✅ WebSockets (Cloudflare Durable Objects)
- ❌ Server-Sent Events
- ⚠️ Polling (only the sidebar when a user has more communities than the 15 live-socket cap; everything else catches up on reconnect/focus)
- ❌ Webhooks (no inbound webhooks)

---

# COMPLETE REQUEST FLOWS

## A. Login Flow
```
1. POST /api/auth/login              → 1 DB SELECT (users by email)
2. Set session cookie                → 0 DB
Total: 1 HTTP request, 1 DB query
```

## B. Loading Application (Dashboard)
```
1. GET / (redirect)                  → Middleware: JWT verify + global rate limit (no DB)
2. GET /dashboard                    → Server Component: 2 DB SELECT (users, designer_profiles)
3. GET /api/communities              → 1 RPC (get_sidebar_activity) + 3 DB SELECT + cache lookup
4. GET /api/notifications            → 2 DB SELECT (notifications count + list)
5. WebSocket: notifications:${userId} → 1 WSS upgrade to the user's UserDO (shared user socket)
6. WebSocket: chat:${cid}            → 1 WSS per community, capped at SIDEBAR_REALTIME_LIMIT (15)
Total: ~4 HTTP requests, ~7 DB queries, 2-16 WebSocket connections
```

## C. Loading Home/Feed
```
1. GET /api/home/feed                → 1 RPC (get_home_feed_page) + 1 RPC (get_event_attendee_previews)
Total: 1 HTTP request, 2 DB queries
```

## D. Opening a Community
```
1. GET /api/communities/[id]/bootstrap → 1 RPC (get_community_message_page) + 1 RPC (get_sidebar_activity) + 1 DB SELECT
2. GET /api/communities/[id]          → 5+ DB SELECT (read model: membership, community, members, users, profiles)
3. WebSocket: chat:${communityId}     → 1 WSS upgrade (pooled, may already exist)
4. WebSocket: presence:${communityId} → 1 WSS upgrade
5. WebSocket: typing:${communityId}   → 1 WSS upgrade (may already exist from sidebar)
6. WebSocket: threads:${communityId}  → 1 WSS upgrade
7. WebSocket: events:${communityId}   → 1 WSS upgrade
8. WebSocket: resources:${communityId} → 1 WSS upgrade
9. WebSocket: rules:${communityId}    → 1 WSS upgrade
Total: ~2 HTTP requests, ~7-8 DB queries, 4-7 new WebSocket connections
```

## E. Switching Communities (A → B → C → A)
```
Community A → B:
1. Cached message/meta from msgCache/metaCache → 0 DB, 0 HTTP (instant)
2. Bootstrap hydration: 1 HTTP + 2 RPCs (if cache miss)
3. New WebSocket: chat:B (if not pooled) → 1 WSS
4. Presence:B → 1 WSS
5. threads:B, events:B, resources:B, rules:B → up to 4 WSS (if not pooled)
6. typing:B already exists from sidebar → 0 new

Community B → C:
Same pattern. B's connections idle for 5 min before closing.

Community C → A:
1. msgCache/metaCache hit → instant render, 0 HTTP
2. chat:A pool connection still warm (5 min idle) → 0 new WSS
Total per switch: 0-2 HTTP requests, 0-4 DB queries, 0-5 new WebSocket connections
```

## F. Opening Chat
```
(Already covered in D - chat WebSocket established on community open)
If re-entering after cache expiry:
1. Bootstrap fetch → 1 HTTP + 2 RPCs
2. chat:${id} pool acquire → 0 new WSS (if warm)
Total: 0-1 HTTP requests, 0-2 DB queries
```

## G. Sending a Chat Message
```
1. POST /api/communities/[id]/messages
   → DB: 1 SELECT (membership check, lib/communities/membership.ts)
   → DB: 1 INSERT (message row)
2. after() — runs once the response is on the wire:
   → Realtime: publishChatEvent() → ONE event to chat:${id}; the Room DO
     broadcasts to every socket subscribed to that room (no per-member forwards)
   → Push: sendChatMessagePush() → chunked member lookup (500/query) + Expo push;
     audible pushes bounded to 3/minute per member, delivery capped at
     PUSH_MAX_DELIVERIES within PUSH_TIME_BUDGET_MS
3. Optimistic UI: message appears immediately (0 HTTP)
4. Sidebar: the same chat event patches the local sidebar cache (0 HTTP)
Total: 1 HTTP request, 2 DB queries in the request path + deferred publish/push work
```

## H. Receiving a Chat Message
```
1. WebSocket: chat:${id} receives "event" message → 0 HTTP
2. Client: dispatch to useRealtimeChat handlers → 0 HTTP
3. If user unknown: 1 HTTP to resolve profile → 0-1 HTTP
4. Sidebar: the same event updates the cached community preview → 0 HTTP
Total: 0-1 HTTP requests, 0 DB queries (all via realtime)
```

## I. Sending a Post (Thread/Event/Resource)
```
1. POST /api/communities/[id]/threads (or events/resources/showcase)
   → DB: 1 SELECT (membership check)
   → DB: 1 INSERT (new row)
   → Realtime: 1 publish to threads:${id} (events:${id} / resources:${id} / showcase:${postId})
2. Engagement notifications: deferNotification() → after() → createNotification()
   → One row per (user, entity) — re-interactions bump the existing unread row's
     metadata.count instead of inserting again
   → Realtime: 1 publish to notifications:${userId} (UserDO)
Total: 1 HTTP, ~2-3 DB queries, 1 realtime publish
```

## J. Loading Comments
```
1. GET /api/communities/[id]/threads/[threadId]/comments (also resources/[resourceId]/, events/[eventId]/, showcase/[postId]/)
   → DB: 1 SELECT (comments with pagination)
   → DB: 1 SELECT (author info)
   → DB: 1 SELECT (aggregate counts)
Total: 1 HTTP, 3 DB queries
```

## K. Uploading Image/File
```
1. Client-side: compressChatImageClient() → Canvas API (0 HTTP)
2. POST /api/communities/[id]/messages/upload
   → DB: 1 SELECT (membership check)
   → Storage: R2 PutObject → 1 S3 API call
   → DB: 1 INSERT (message with image_url)
   → Realtime: 1 publish (same as G)
Total: 1 HTTP (client), 1 R2 write, 3 DB queries
```

## L. Notifications
```
Loading:
1. GET /api/notifications → 2 DB SELECT (paginated + count)
2. WebSocket: notifications:${userId} → 1 WSS (already connected)

Receiving (realtime):
1. WebSocket event → 0 HTTP
2. Local state update → 0 HTTP

Marking read:
1. PATCH /api/notifications → 1 DB UPDATE
Total: 0-1 HTTP, 0-3 DB queries
```

## M. Search
```
No dedicated search endpoint exists. Community/thread/resource listing uses RPC pagination.
Admin search: GET /api/admin/users?q=... → 1 DB SELECT
Total: 1 HTTP, 1 DB query
```

## N. Profile Loading
```
1. GET /api/profile → 3 DB SELECT (users, designer_profiles, user_interests + design_interests join)
Total: 1 HTTP, 3 DB queries
```

## O. Logout
```
1. POST /api/auth/logout → 0 DB (clear cookie)
2. Client: destroyAll() on realtimePool → closes all WebSockets
3. Client: clearRequestCache() + clearAllUserCaches() → 0 HTTP
Total: 1 HTTP, 0 DB queries
```

---

# REALTIME / WEBSOCKET AUDIT

## Web App: Cloudflare Durable Object System

### Per-User WebSocket Connections

| # | Room Pattern | File | When Created | When Destroyed | Cleanup? |
|---|---|---|---|---|---|
| 1 | `chat:${cid}` | `components/communities/chat/useRealtimeChat.ts` via `realtimePool` | Community open | 5 min idle after last subscriber | ✅ Pool manages lifecycle |
| 2 | `chat:${cid}` (presence handlers) | `chat/useOnlinePresence.ts` | Community open | Community switch (effect cleanup) | ✅ unsubscribes; shares socket #1 |
| 3 | `chat:${cid}` (typing topic) | `chat/useTypingPresence.ts` | Community open | Community switch | ✅ unsubscribes; shares socket #1 |
| 4 | `chat:${cid}` × ≤15 (typing) | `panel/useSidebarTyping.ts` | Dashboard mount | Logout / visibility hidden | ✅ unsubscribes |
| 5 | `chat:${cid}` × ≤15 | `panel/useSidebarRealtime.ts` | Dashboard mount | Logout / list shrinks | ✅ unsubscribes (room ref-counted, shared with #1) |
| 6 | `threads:${cid}` | `threads/ThreadsView.tsx` | Threads tab open | Tab switch / unmount | ✅ unsubscribes |
| 7 | `thread-comments:${tid}` | `threads/ThreadDetailClient.tsx` | Thread detail open | Navigate away | ✅ unsubscribes |
| 8 | `events:${cid}` | `events/EventsView.tsx` | Events tab open | Tab switch | ✅ unsubscribes |
| 9 | `resources:${cid}` | `resources/ResourcesView.tsx` | Resources tab open | Tab switch | ✅ unsubscribes |
| 10 | `resource-comments:${rid}` | `resources/ResourceDetailClient.tsx` | Resource detail open | Navigate away | ✅ unsubscribes |
| 11 | `showcase:${postId}` | `showcase/ShowcaseDetailClient.tsx` | Showcase detail open | Navigate away | ✅ unsubscribes |
| 12 | `rules:${cid}` | `CommunityRightSidebar.tsx` | Right sidebar open | Panel close | ✅ unsubscribes |
| 13 | `notifications:${userId}` | `lib/use-notifications.ts` | Dashboard mount | Logout | ✅ unsubscribes (user socket) |
| 14 | `profile:${userId}` | reserved in `lib/realtime/rooms.ts` | — | — | no current subscriber |

Note: the live hooks above use the community's `chat:${cid}` room (presence via
`onPresence`, typing via the `typing` topic) instead of dedicated per-feature rooms,
so they do not create additional sockets. `realtimeRooms.presence()` remains in
`lib/realtime/rooms.ts` as an unused helper name; the server still understands
`presence:` rooms (`apps/realtime/__tests__/room-routing.test.ts`), but no web hook
subscribes to one today.

**Sockets, not rooms, are the unit of connection**: `realtimeClient` multiplexes every
room over a per-community socket (or the single user socket for `notifications:*` /
`profile:*`), and ref-counts subscriptions, so two hooks on the same room share one
socket. The sidebar's own subscriptions are capped at 15 communities, most-recently
active first.
**Maximum concurrent connections per user**: bounded by open tabs/details plus ≤1 user socket and ≤15 sidebar community sockets; all 15 sidebar sockets only exist when that many distinct communities are active.
**Typical concurrent connections**: 2-6 (user socket + one active community's chat/presence/typing + a tab room).

### Server-Side Presence Tracking
- **Community rooms**: `apps/realtime/src/room.ts` — storage in Durable Object SQLite (MEMBERS_KEY = "members")
- **User rooms**: `apps/realtime/src/user.ts` (`UserDO`) — subscriptions only, routed by `room-routing.ts` (`USER_ROOM_PREFIXES = notifications:`, `profile:`)
- **Mechanism**: `join()` increments `connections` counter, `leave()` decrements. At 0, user removed.
- **Broadcast**: Full member list sent to all sockets on every join/leave.
- **Cleanup**: `webSocketClose` and `webSocketError` handlers call `leave(userId)`.

### Reconnection Behavior
- **Client**: `RealtimeClient` with exponential backoff (1s base, 15s max)
- **Max reconnection delay**: 15 seconds
- **Tab visibility gating**: All realtime hooks check `isVisible` before connecting, tearing down WebSocket when hidden
- **Catch-up on reconnect**: `useRealtimeChat` runs debounced `fetchMessages()` with `?after=` cursor on fresh subscription

## Mobile App: Same Cloudflare Durable Object System

`lib/realtime.ts` is a port of `apps/web/lib/realtime/client.ts`: one multiplexed
`realtimeClient`, ref-counted rooms/topics, community rooms on their own socket to
the community's `Room` DO, user rooms (`notifications:*`, `profile:*`) sharing the
recipient's `UserDO`. See `docs/mobile-architecture.md` for the full design.

### Subscriptions per surface

| Surface | File | Rooms / topics | Cleanup? |
|---|---|---|---|
| Active chat | `hooks/useChatMessages.ts` | `chat:${cid}` — `message`, `message-edit`, `message-delete`, reactions | ✅ unsubscribes on unmount |
| Typing | `hooks/useTypingPresence.ts` | `chat:${cid}` — `typing` topic | ✅ unsubscribes |
| Community list / unread | `hooks/useCommunities.ts` | `chat:${cid}` for the listed communities | ✅ unsubscribes |
| Content tabs | `hooks/useCommunityContent.ts` | `threads:${cid}`, `events:${cid}`, `resources:${cid}`, `showcase:*` | ✅ unsubscribes |
| Notifications | `lib/push.ts` + app screens | `notifications:${userId}` over the user socket | ✅ unsubscribes |

**Liveness is the mobile-specific part**: a 25s heartbeat (`ping`/`pong` auto-response),
an AppState probe on foreground, and 1s→15s reconnect backoff with replayed
subscriptions. None of that exists because the transport differs — it exists because
mobile OSes silently kill sockets while `readyState` still reports OPEN.

### Mobile vs Web Realtime Differences
| Aspect | Web | Mobile |
|---|---|---|
| Transport | Raw WebSocket via Cloudflare DO | Same, via the React Native WebSocket API |
| Auth | JWT in the WS handshake | JWT in the `token` query param (RN cannot set WS headers) |
| Message delivery | Server push via /publish endpoint | Same |
| Typing | Cloudflare room event | Same |
| Presence | Durable Object storage + broadcast | Same rooms; UI surfaces presence where implemented |
| Connection model | 1 socket per community + 1 user socket (multiplexed, ref-counted) | Same |
| Liveness | Tab-visibility gating | Heartbeat + AppState probe + backoff |

---

# CHAT SCALING AUDIT

## What Happens When USER A Sends ONE Message

```
User A types message
  |
  v
[CLIENT] Optimistic UI update (0 HTTP)
  |
  v
[CLIENT] POST /api/communities/[cid]/messages
  |
  v
[SERVER] middleware.ts: JWT verify (no DB), global rate limit (Upstash Redis)
  |
  v
[SERVER] messages/route.ts (request path):
  1. DB: membership check (lib/communities/membership.ts)
  2. DB: INSERT INTO community_messages
  3. response is sent — everything below runs in after()
  |
  v
[SERVER] after() block:
  4. publishChatEvent() → ONE HTTP POST to Cloudflare Realtime /publish:
     room=chat:${cid}, topic=message
  5. sendChatMessagePush() → keyset-paginated member lookup (500/query),
     per-member preference + audible-budget checks, Expo push per device
  |
  v
[CLOUDFLARE WORKER] index.ts + room-routing.ts:
  6. Community-scoped rooms → idFromName(chat:${cid}) → Community Room DO
     User-scoped rooms (notifications:, profile:) → user:${userId} → UserDO
  |
  v
[CLOUDFLARE DO - Room] room.ts publish():
  7. For each socket subscribed to the room's topic:
     ws.send(JSON.stringify({t:"event", room, topic, data}))
  |
  v
[CLIENTS] Receive WebSocket message:
  - Chat window: append to messages[]
  - Sidebar: patch cached community preview + unread count
```

### Operation Count

| Operation | Count | Notes |
|---|---|---|
| HTTP requests (client→server) | 1 | POST /messages |
| DB queries in the request path | 2 | membership check + INSERT |
| DB writes (server) | 1 | INSERT message |
| HTTP requests (server→realtime) | 1 | POST /publish, single room |
| DO forwards (Worker→DO) | 1 | chat room only |
| WebSocket broadcasts | S | S = sockets currently subscribed to the room |
| Deferred push recipients | ≤ N-1, hard-capped | chunked lookups; `PUSH_MAX_DELIVERIES` / `PUSH_TIME_BUDGET_MS` |
| Notification rows | 0 | Chat does not create notification rows |

**Total per message**: 1 HTTP from the sender, 2 DB queries in the request path,
one realtime publish, and a deferred bounded push fan-out. The old revision of this
audit recorded N+1 DO forwards and N notification inserts per message; the fan-out
and broadcast layer has since been collapsed to a single room event, and community
broadcast notifications were removed entirely.

### Scale Model for Chat Messages

| Community Size | Request-path DB ops | DO forwards | WebSocket deliveries | Push recipients (bounded) |
|---|---|---|---|---|
| 10 users | 2 | 1 | ≤ 10 (sockets in the room) | ≤ 9 |
| 100 users | 2 | 1 | ≤ 100 | ≤ 99 |
| 1,000 users | 2 | 1 | ≤ 1,000 online | ≤ 999 |
| 10,000 users | 2 | 1 | ≤ 10,000 online | ≤ 9,999 |
| 100,000 users | 2 | 1 | ≤ 100,000 online | ≤ 10,000 (hard cap) |

**Remaining linear cost**: the Expo push fan-out. It is deferred, chunked, time-boxed,
and capped at 10,000 deliveries per message, and unread counts are derived from the
database on next app open — so a member who misses a push still sees the correct state.

---

# COMMUNITY SWITCH AUDIT

## What Happens When User Switches A → B → C → A

### A → B (first visit to B)
```
1. Check msgCache/metaCache for B → MISS (first visit)
2. fetchAndHydrateCommunityBootstrap(B):
   - GET /api/communities/B/bootstrap → 1 HTTP, 3 DB queries (RPC + RPC + SELECT)
3. fetchMeta(B):
   - GET /api/communities/B → 1 HTTP, 5+ DB queries (read model)
4. WebSocket connections:
   - chat:B → acquire from pool (new connection) → 1 WSS
   - presence:B → new connection → 1 WSS
   - threads:B, events:B, resources:B, rules:B → new connections → up to 4 WSS
5. typing:B already connected from sidebar → 0 new
6. Cleanup from A:
   - chat:A released from pool → stays open for 5 min idle
   - presence:A closed immediately → 0
   - threads:A, events:A, resources:A, rules:A closed → 0
Total: 2 HTTP, 8 DB queries, 5-6 new WebSocket, 5-6 close
```

### B → C (first visit to C)
Same pattern: 2 HTTP, 8 DB queries, 5-6 new WSS, 5-6 close

### C → A (revisit)
```
1. Check msgCache/metaCache for A → HIT (cached from before)
2. Render instantly from cache → 0 HTTP, 0 DB
3. WebSocket connections:
   - chat:A → acquire from pool (still warm, 5 min hasn't elapsed) → 0 new WSS
   - presence:A → new connection → 1 WSS (was closed)
   - threads:A, events:A, resources:A, rules:A → new connections → up to 4 WSS
4. Cleanup from C:
   - chat:C released → idle timer starts
   - presence:C, threads:C, events:C, resources:C, rules:C → close → 0
Total: 0 HTTP, 0 DB queries, 5 new WebSocket, 5 close
```

### Summary
| Switch Type | HTTP | DB Queries | New WSS | Close WSS |
|---|---|---|---|---|
| First visit (cache miss) | 2 | 8 | 5-6 | 5-6 |
| Revisit (cache hit, pool warm) | 0 | 0 | 5 | 5 |
| Revisit (cache hit, pool cold) | 0 | 0 | 6 | 5 |

**Key insight**: The 5-minute idle pool timeout means revisiting a community within 5 minutes requires 0 HTTP requests and 0 DB queries. The `presence`, `threads`, `events`, `resources`, `rules` rooms are NOT pooled — they're always created/destroyed on tab switch.

---

# FRONTEND REQUEST AUDIT

## React Hooks That Trigger Network Requests

### useEffect with API calls
| File | Dependencies | Request | Frequency |
|---|---|---|---|
| `components/communities/chat/useChatData.ts` | `[communityId]` | Bootstrap + messages + meta | Per community switch |
| `components/communities/chat/useRealtimeChat.ts` | `[communityId, debouncedCatchUp]` | Catch-up fetch on reconnect | Per reconnection |
| `components/communities/panel/useSidebarCommunities.ts` | `[load]` | `/api/communities` | On mount + SIDEBAR_CHANGED_EVENT |
| `lib/use-notifications.ts` | `[userId]` | `/api/notifications` | On mount + focus/visibility catch-up |
| `app/dashboard/HomeFeed.tsx` | `[fetchFeed, refreshToken]` | `/api/home/feed` | On mount + focus/visibility |

### useEffect with WebSocket connections
| File | Dependencies | Connection | Frequency |
|---|---|---|---|
| `chat/useRealtimeChat.ts` | `[communityId, ...]` | chat:${cid} via the realtime client/pool | Per community |
| `chat/useOnlinePresence.ts` | `[communityId, ...]` | presence:${cid} | Per community |
| `chat/useTypingPresence.ts` | `[communityId, ...]` | typing:${cid} | Per community |
| `panel/useSidebarRealtime.ts` | `[communityIds, userId]` | chat:${cid} × ≤15 (most-recently active) | On mount / list change |
| `panel/useSidebarTyping.ts` | `[communityIds, ...]` | typing:${cid} × ≤15 | Per sidebar |
| `lib/use-notifications.ts` | `[userId, isVisible]` | notifications:${userId} (user socket) | On mount |
| `threads/ThreadsView.tsx` | `[communityId]` | threads:${cid} | Per tab |
| `events/EventsView.tsx` | `[communityId]` | events:${cid} | Per tab |
| `resources/ResourcesView.tsx` | `[communityId]` | resources:${cid} | Per tab |

### Request Deduplication
- **`dedupe-fetch.ts`**: Client-side in-flight dedup + settle replay. Two modes: `exact` (750ms) and `url` (600ms for toggles).
- **`request-cache.ts`**: Server-side fetch cache with community bootstrap hydration. 15-min stale for bootstrap data.
- **`cache.ts`**: Module-level `msgCache`/`metaCache` with bounded LRU (25 communities max).
- **`realtimePool.ts`**: WebSocket connection pooling with 5-min idle timeout.

### Potential Duplicate Requests
1. **Community bootstrap hydration**: `fetchAndHydrateCommunityBootstrap()` pre-populates the request cache. If a component calls `fetchJsonCached()` for the same URL simultaneously, the dedupe layer collapses them. ✅ Well-handled.
2. **Sidebar fetch on mount + SIDEBAR_CHANGED_EVENT**: Could fire twice on initial mount if the event dispatches during mount. The `load` callback is stable via `useCallback` with `[]` deps. LOW RISK.
3. **Notification fetch + realtime**: Notifications are fetched on mount and updated via WebSocket. The realtime handler patches local state, no refetch needed. ✅ No duplicates.

### Worst Offenders for Unnecessary Requests
1. **`panel/useSidebarTyping.ts` + `panel/useSidebarRealtime.ts`**: Up to 15 communities each hold a live chat socket (typing and message subscriptions share the room via ref-counting), capped by `SIDEBAR_REALTIME_LIMIT` most-recently-active first; beyond the cap a periodic refetch catches the list up. Lowering the cap or multiplexing those community rooms onto fewer sockets is the remaining win.
2. **`components/communities/panel/useSidebarCommunities.ts`**: still the source of the sidebar fetch on mount + `SIDEBAR_CHANGED_EVENT`; the request-cache layer dedupes the overlap.
3. **`chat/useRealtimeChat.ts`**: On reconnection, runs `fetchMessages()` with `?after=` cursor. This is a catch-up mechanism, not a duplicate — it fills gaps from missed realtime events.

---

# MOBILE APP AUDIT

## Architecture
- **Framework**: Expo SDK 54 + React Native 0.81 + expo-router
- **Data fetching**: React Query (`@tanstack/react-query`)
- **Realtime**: Cloudflare Durable Objects via `lib/realtime.ts` — a port of `apps/web/lib/realtime/client.ts`
- **Auth**: Cookie-based via web backend API (HttpOnly JWT captured from `Set-Cookie` and replayed from AsyncStorage)
- **State**: React Context (AuthContext) + React Query cache
- **Push**: Expo push (`lib/push.ts`, `components/PushNotificationsBridge.tsx`)

## API Requests
All mobile API calls go through `lib/api.ts` which wraps `fetch()` with session cookie management.

| Hook | Requests | Trigger |
|---|---|---|
| `hooks/useCommunities.ts` | GET `/api/communities` | Mount + AppState active |
| `hooks/useChatMessages.ts` | GET `/api/communities/:id/messages` | Mount + pagination |
| `hooks/useSendMessage.ts` | POST `/api/communities/:id/messages/upload` + POST `/api/communities/:id/messages` | User sends message |
| `hooks/useCommunityContent.ts` | GET via `lib/communityContent.ts` | Mount + realtime invalidation |
| `hooks/usePushNotifications.ts` | POST/DELETE `/api/push/register`, GET/PATCH `/api/push/settings` | Sign-in, foreground, logout |
| `context/AuthContext.tsx` | GET `/api/auth/me` | Mount |

## Realtime Connections (Mobile)
| Surface | File | Rooms / topics | Trigger |
|---|---|---|---|
| Active chat | `hooks/useChatMessages.ts` | `chat:${cid}` — `message`, `message-edit`, `message-delete`, reactions | Chat open |
| Community list | `hooks/useCommunities.ts` | `chat:${cid}` for listed communities | List mounted |
| Typing | `hooks/useTypingPresence.ts` | `chat:${cid}` — `typing` | Chat open |
| Content tabs | `hooks/useCommunityContent.ts` | `threads:${cid}`, `events:${cid}`, `resources:${cid}`, `showcase:*` | Content tab open |
| Notifications | `lib/push.ts` + screens | `notifications:${userId}` (user socket) | Signed in |

Mobile multiplexes all of these over per-community sockets (or the single user
socket), exactly like the web client — there is no separate channel-per-table layer.

## Mobile vs Web Differences
| Aspect | Web | Mobile |
|---|---|---|
| Realtime transport | Cloudflare Durable Objects | Same (RN WebSocket client) |
| Connection model | 1 socket per community + 1 user socket, ref-counted | Same |
| Caching | Module-level Maps + request-cache | React Query |
| Optimistic UI | Yes (messages, likes, saves) | Yes (messages, reactions) |
| Image compression | Canvas API (client-side WebP) | `expo-image-manipulator` before upload |
| Background behavior | Tab visibility gating | Heartbeat + AppState probe + reconnect backoff |
| Notification delivery | Browser notifications + in-app realtime | Expo push (foreground suppression, per-community mute, quiet hours) |

---

# IMAGE / FILE AUDIT

## Upload Flow
1. **Client compression**: `compressImage()` / `compressAvatarClient()` (`lib/image-client.ts`) → Canvas → WebP, with `MAX_DIMENSION` and `IMAGE_QUALITY` bounds
2. **Upload**: POST multipart to `/api/communities/[id]/messages/upload`
3. **Server**: Membership check → image validation → R2 PutObject → INSERT with image_url
4. **R2 public URL**: `https://pub-xxxx.r2.dev/<key>`

## Storage Locations
| What | Where | Public? |
|---|---|---|
| Chat images | Cloudflare R2 | Yes (public URL) |
| Avatar images | Cloudflare R2 | Yes (public URL) |
| Showcase images | Cloudflare R2 | Yes (public URL) |
| Thread attachments | Cloudflare R2 | Yes (public URL) |
| Event cover images | Cloudflare R2 | Yes (public URL) |
| Master data images | R2 + Supabase Storage (legacy) | Yes |
| Lottie animations | Cloudflare R2 | Yes (fetched server-side) |

## CDN Usage
- **Cloudflare CDN**: Serves R2 public URLs via Cloudflare's edge network.
  Uploads carry `Cache-Control: public, max-age=31536000, immutable` and are
  edge-cached when served through a custom domain attached to the R2 bucket.
- **next/image**: Used sparingly (16 transformations in 30 days). Configured for Supabase Storage + GIPHY CDN remote patterns.

## Media security note
- There is no private media store: everything in the media bucket is public
  with unguessable, versioned keys; access control for community content
  happens at the API layer (membership checks), not the storage layer, so the
  shared public edge cache can never expose one user's media to another.
- After an object is deleted from R2, an already-cached edge copy may stay
  reachable for the rest of the immutable max-age (1 year). For strictly
  time-sensitive removals, purge the URL via the Cloudflare API — this is not
  done automatically because it would require a purge call per deleted object.

## Bandwidth Estimate per Image
- Client compression to WebP: ~60-80% reduction from original
- Average compressed chat image: ASSUMPTION ~100KB
- Avatar: ~20-30KB
- Showcase/event: ~150-300KB

---

# AUTHENTICATION AUDIT

## Auth Flow
```
Login:
1. POST /api/auth/login → bcrypt compare → JWT sign (HS256, 7-day expiry) → Set-Cookie
2. Cookie: uxcommunity_session=<JWT>, httpOnly, secure, sameSite=lax, domain=.uxcommunity.in

Session Verification (every request):
1. Middleware: parse cookie → jwtVerify() → no DB call (stateless JWT)
2. API routes: requireSession() → getSession() → jwtVerify()
3. requireSession() for users: assertUserActive() → 1 DB SELECT (cached 15s per user)

Token Refresh:
None. JWTs are 7-day, no refresh mechanism.

Logout:
1. POST /api/auth/logout → clear cookie
2. Client: destroyAll() on realtimePool, clear caches
```

## Auth Operations Per User Action

| Action | JWT Verify | DB Check | Notes |
|---|---|---|---|
| Page load (middleware) | 1 | 0 | Stateless JWT |
| API route (write) | 1 (via getSession) | 1 (assertUserActive, cached 15s) | Per-user 15s cache |
| API route (read) | 1 | 0-1 | Many skip verifyActive |
| Community switch | 0 | 0 | Cached from previous |
| Chat open | 0 | 0 | JWT from cookie |

## Potential Issues
1. **No token refresh**: 7-day JWTs mean no session expiry until cookie expires. If a user is deleted/blocked, the 15s liveness cache means they retain access for up to 15 seconds.
2. **Service-role key for all DB access**: RLS is enabled but bypassed. Security depends entirely on API route validation.
3. **Cookie domain `.uxcommunity.in`**: Correctly scoped for cross-subdomain (realtime worker).

---

# CACHE AUDIT

## Caching Layers

| Layer | Mechanism | TTL | Scope | Hit Rate Estimate |
|---|---|---|---|---|
| **Browser HTTP cache** | Standard HTTP Cache-Control | Varies | Per browser | Low (most responses no-store) |
| **dedupe-fetch.ts** | In-flight dedup + settle replay | 750ms (exact), 600ms (url) | Per tab | High for rapid clicks |
| **request-cache.ts** | Server-side fetch cache (module-level Map) | 60s default, 15min bootstrap, 60s sidebar | Per serverless instance | HIGH for SPA nav |
| **cache.ts msgCache** | Module-level BoundedCommunityMap (25 entries) | Persistent until eviction | Per tab, SPA lifetime | HIGH for community switching |
| **cache.ts metaCache** | Module-level BoundedCommunityMap (25 entries) | 5 min (META_STALE_MS) | Per tab, SPA lifetime | HIGH for community switching |
| **cache.ts sidebarStore** | Module-level object | 60s (SIDEBAR_STALE_MS) | Per tab | HIGH |
| **master-data-cache.ts** | Next.js unstable_cache | 1 hour | Per serverless instance | VERY HIGH (rarely changes) |
| **Cloudflare CDN** | Edge cache | Default | Global | HIGH for static assets |
| **Cloudflare Workers cache** | ISR | Varies | Per edge location | Medium |
| **Durable Object SQLite** | Presence/members storage | Persistent | Per room | N/A (state, not cache) |

## Data That Should Be Cached But Isn't

1. **Community rules**: Fetched on every community info panel open. Rules change rarely. Could be cached 5-10 min.
2. **Member list**: Fetched fully on community open. Could be cached longer with realtime invalidation.
3. **Profile data**: Fetched on every profile page visit. Could be cached with user-scoped TTL.
4. **GIPHY results**: No caching on GIPHY proxy responses. Same search repeated within seconds hits GIPHY API twice.

---

# CLOUDFLARE AUDIT

## Workers

| Worker | File | Trigger | Purpose |
|---|---|---|---|
| `uxcommunity-web` | `apps/web/wrangler.toml` | All HTTP requests | Next.js app (OpenNext) |
| `uxcommunity-realtime` | `apps/realtime/wrangler.toml` | WebSocket + /publish | Realtime system |

## Durable Objects

| DO Class | Binding | File | Instances | Storage | Purpose |
|---|---|---|---|---|---|
| `Room` | `COMMUNITY_DO` | `apps/realtime/src/room.ts` | 1 per community (`chat:${cid}`, `threads:${cid}`, … rooms share it) | SQLite | Community WebSocket hub + presence |
| `UserDO` | `USER_DO` | `apps/realtime/src/user.ts` | 1 per user (`user:${userId}`) | SQLite | User-scoped rooms (`notifications:*`, `profile:*`) |

Routing between the two is owned by `apps/realtime/src/room-routing.ts`
(`USER_ROOM_PREFIXES`), and the migrations in `wrangler.toml` are `v1` (Room),
`v2` (UserDO), `v3` (no-op compatibility marker).

### Room DO Details
- **WebSocket Hibernation**: Uses `acceptWebSocket()` + `serializeAttachment()` for eviction survival
- **Storage**: `MEMBERS_KEY = "members"` → JSON object in SQLite with `{userId: {name, avatar, connections}}`
- **Message limit**: 8192 bytes per message (MAX_MESSAGE_BYTES)
- **Fan-out**: the Worker resolves each event through `room-routing.ts` and dispatches publishes with bounded concurrency (`FANOUT_CONCURRENCY = 40`, under the subrequest cap)

## R2 Storage
| Bucket | Purpose | Public URL |
|---|---|---|
| `uxcommunity-web-next-cache` (wrangler binding `NEXT_INC_CACHE_R2_BUCKET`) | Next.js incremental cache (ISR / unstable_cache) — REQUIRED by OpenNext; do NOT delete | internal (R2 binding, not public) |
| Media bucket, configured via `R2_BUCKET_NAME` env (prod: `drafthub`) | All uploaded media: images, videos, audio, PDFs, attachments, avatars, master-data images, lottie | `R2_PUBLIC_URL/<key>` |

### Media caching architecture (Cloudflare edge cache)

```
User ──▶ Cloudflare Edge Cache (CDN) ── cache MISS ──▶ R2 media bucket (origin)
            │                                                     ▲
            └──── cache HIT (never touches R2)                   │
```

- **Origin = R2** (single media bucket; no duplicate cache bucket, no Cache Reserve).
- **Delivery = Cloudflare CDN edge**. Every upload is tagged `Cache-Control: public,
  max-age=31536000, immutable` because all object keys are versioned/unique
  (timestamp + random suffix or UUID), so a URL never changes content.
- **Custom domain required**: `R2_PUBLIC_URL` must be a custom domain attached to
  the bucket (e.g. `media.uxcommunity.in`). The `pub-*.r2.dev` dev URL bypasses
  the CDN edge cache; responses still work but are never edge-cached.
- **Videos/audio**: served directly from the R2 custom domain. HTTP Range /
  `206 Partial Content` pass straight through the edge cache, so seeking,
  scrubbing, resume and mobile playback are preserved. Nothing proxies media
  through the Next.js worker except the download helper (`/api/image-download`),
  which is only used for save-to-disk and does not stream video.
- **Deleted objects**: deletion removes the R2 object; an already-cached edge
  copy can remain until its max-age expires. Because keys are unguessable and
  content is public-by-design, no per-object cache purge is issued (see the
  security note below).
- **Media lifecycle**: deleting an entity (post/thread/event/message/community/
  user/master-data row) deletes its R2 objects when nothing else references
  them. See `apps/web/lib/r2-cleanup.ts` (reference lookups shared with the
  admin orphan audit) and `/api/admin/r2-audit` (scan + grace-period
  delete-orphans, default 7 days).
- **Manual cleanup only**: orphan deletion is admin-initiated —
  Admin → Tools → R2 storage health (`/api/admin/r2-audit`) scans the bucket,
  lists confirmed orphans with size/age, and deletes only rows you approve that
  are older than the grace period (default 7 days). Nothing deletes on a
  schedule or automatically. The reference schema (`ALL_MEDIA_LOOKUPS`) lives in
  `packages/shared/src/r2-media.ts`, shared by the runtime cleanup and the
  admin audit so they can never disagree.

## Overlap Between Cloudflare and Vercel
**FACT**: The app has BOTH Cloudflare Workers (primary) and Vercel (alternate) deployment configs. They do NOT overlap in production — only one is active. The Vercel config exists as an alternate deployment path. The CI/CD pipeline (`.github/workflows/deploy.yml`) deploys to Cloudflare.

---

# BANDWIDTH / DATA TRANSFER AUDIT

## Estimated Response Sizes

| Endpoint | Response Size | Notes |
|---|---|---|
| GET `/api/communities` (sidebar) | ~5-15 KB | Depends on community count |
| GET `/api/communities/[id]` (read model) | ~2-5 KB | Community + members |
| GET `/api/communities/[id]/messages` | ~10-30 KB | 50 messages with reactions |
| GET `/api/communities/[id]/threads` | ~5-15 KB | 50 threads with aggregates |
| GET `/api/notifications` | ~2-5 KB | 20 notifications |
| GET `/api/home/feed` | ~10-20 KB | Feed with mixed content |
| WebSocket event (chat message) | ~0.5-2 KB | JSON event payload |
| WebSocket presence update | ~1-5 KB | Full user list |

## Upload Sizes
| Type | Max Size | Compression | Output Size |
|---|---|---|---|
| Chat image | config.images.maxBytes | WebP 0.65 quality, 1200×1200 | ~50-150KB |
| Avatar | config.images.maxBytes | WebP 0.85 quality, 400×400 | ~20-50KB |
| Showcase image | config.images.maxBytes | None (raw upload) | Original size |
| Thread attachment | Unknown | None | Original size |

## Bandwidth Estimate Per Active User Per Day

| Activity | Estimates |
|---|---|
| Page loads (5 pages × 10KB avg) | 50 KB |
| API responses (20 requests × 5KB avg) | 100 KB |
| WebSocket events (50 events × 1KB avg) | 50 KB |
| Images viewed (10 images × 100KB avg) | 1,000 KB |
| Images uploaded (1 image × 100KB) | 100 KB |
| **Total per user per day** | **~1.3 MB** |

---

# REQUEST MULTIPLICATION ANALYSIS

## Per Active User Per Day

### LIGHT USER (browsing, few messages)
| Category | Count/day |
|---|---|
| HTTP requests | ~30 |
| Vercel Edge Requests | ~30 (if on Vercel) |
| Vercel Function Invocations | ~20 |
| Database operations | ~50 |
| Realtime events (received) | ~20 |
| WebSocket connections (peak) | 3-5 |
| Data transfer | ~500 KB |

### NORMAL USER (regular browsing, community switching, chat, posts)
| Category | Count/day |
|---|---|
| HTTP requests | ~100 |
| Vercel Edge Requests | ~100 |
| Vercel Function Invocations | ~60 |
| Database operations | ~200 |
| Realtime events (received) | ~100 |
| WebSocket connections (peak) | 5-8 |
| Data transfer | ~2 MB |

### HEAVY USER (many communities, active chat, posts, image uploads)
| Category | Count/day |
|---|---|
| HTTP requests | ~300 |
| Vercel Edge Requests | ~300 |
| Vercel Function Invocations | ~180 |
| Database operations | ~600 |
| Realtime events (received) | ~500 |
| WebSocket connections (peak) | 10-14 |
| Data transfer | ~10 MB |

---

# REALISTIC USER SCENARIOS

## Light User Profile
- Opens app 1x/day, browses 2 communities, reads 10 messages, sends 0 messages
- **Daily**: 30 HTTP, 50 DB ops, 20 realtime events, 3 WSS, 500 KB

## Normal User Profile
- Opens app 3x/day, active in 5 communities, reads 50 messages, sends 10 messages, creates 1 post
- **Daily**: 100 HTTP, 200 DB ops, 100 realtime events, 5 WSS, 2 MB

## Heavy User Profile
- Opens app 5x/day, active in 15 communities, reads 200 messages, sends 50 messages, creates 5 posts, uploads 3 images
- **Daily**: 300 HTTP, 600 DB ops, 500 realtime events, 12 WSS, 10 MB

---

# SCALE MODEL

## Estimated Usage by User Count

Assumptions:
- 70% of registered users are active monthly
- 30% of active users are active daily
- Average 3 community memberships per user
- Normal user profile used for per-user estimates

| Users | Active/Month | Active/Day | HTTP/day | DB ops/day | Realtime events/day | WSS (concurrent peak) | Data/day |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 700 | 210 | 21,000 | 42,000 | 21,000 | ~600 | 420 MB |
| 10,000 | 7,000 | 2,100 | 210,000 | 420,000 | 210,000 | ~6,000 | 4.2 GB |
| 50,000 | 35,000 | 10,500 | 1,050,000 | 2,100,000 | 1,050,000 | ~30,000 | 21 GB |
| 100,000 | 70,000 | 21,000 | 2,100,000 | 4,200,000 | 2,100,000 | ~60,000 | 42 GB |
| 500,000 | 350,000 | 105,000 | 10,500,000 | 21,000,000 | 10,500,000 | ~300,000 | 210 GB |
| 1,000,000 | 700,000 | 210,000 | 21,000,000 | 42,000,000 | 21,000,000 | ~600,000 | 420 GB |

## Monthly Totals

| Users | HTTP/month | DB ops/month | Realtime events/month | Data/month |
|---:|---:|---:|---:|---:|
| 1,000 | 630,000 | 1,260,000 | 630,000 | 12.6 GB |
| 10,000 | 6,300,000 | 12,600,000 | 6,300,000 | 126 GB |
| 50,000 | 31,500,000 | 63,000,000 | 31,500,000 | 630 GB |
| 100,000 | 63,000,000 | 126,000,000 | 63,000,000 | 1.26 TB |
| 500,000 | 315,000,000 | 630,000,000 | 315,000,000 | 6.3 TB |
| 1,000,000 | 630,000,000 | 1,260,000,000 | 630,000,000 | 12.6 TB |

---

# CONCURRENCY MODEL

## Peak Concurrency Estimates

| Metric | 1K users | 10K users | 50K users | 100K users |
|---|---:|---:|---:|---:|
| Concurrent users (10% peak) | 100 | 1,000 | 5,000 | 10,000 |
| Concurrent WebSockets (3-5 per user) | 300-500 | 3,000-5,000 | 15,000-25,000 | 30,000-50,000 |
| Concurrent DB connections | ~5-10 | ~50-100 | ~250-500 | ~500-1,000 |
| Peak requests/second | ~50 | ~500 | ~2,500 | ~5,000 |
| Peak messages/second (chat) | ~5 | ~50 | ~250 | ~500 |

## Database Connection Pool
**FACT**: Supabase free tier: 60 connections. Pro tier: 200-500 connections.
- Each serverless function invocation uses 1 connection from the pool
- Concurrent function invocations are bounded by the pool size
- At 10K concurrent users, assuming 5% make simultaneous API requests = 500 concurrent requests = 500 DB connections needed

---

# COST MODEL

## Pricing Assumptions
**NOTE**: I am not inventing pricing. These are estimates based on publicly available tier information. Actual costs depend on specific plan details.

### Cloudflare Workers (OpenNext)
- **Free tier**: 100K requests/day, 10ms CPU/request
- **Paid ($5/mo)**: 10M requests/month included, $0.30/10M additional
- **Workers Paid**: Includes Durable Objects at $0.15/million requests

### Supabase
- **Free tier**: 500MB database, 1GB bandwidth, 50K monthly active users
- **Pro ($25/mo)**: 8GB database, 250GB bandwidth, 100K monthly active users
- **Team ($599/mo)**: 8GB database, 250GB bandwidth, unlimited MAU

### Cloudflare R2
- **Free tier**: 10GB storage, 10M Class A ops, 10M Class B ops, 1GB/day egress
- **Paid**: $0.015/GB-month storage, $4.50/million Class A, $0.36/million Class B

### Upstash Redis
- **Free tier**: 10K commands/day
- **Pay-as-you-go**: $0.10/10K commands

## Estimated Monthly Costs

### 1,000 Users
| Service | Estimated Cost |
|---|---|
| Cloudflare Workers (paid) | $5 + ~$0 (under 10M) |
| Supabase (free tier) | $0 (under 500MB, under 50K MAU) |
| Cloudflare R2 | $0.15 (1GB storage) |
| Upstash Redis | $0 (under 10K/day) |
| Resend | $0 (under 100 emails/day) |
| **Total** | **~$5-6/month** |

### 10,000 Users
| Service | Estimated Cost |
|---|---|
| Cloudflare Workers | $5 + ~$0 (under 10M requests) |
| Supabase (pro) | $25 + ~$0 (under 8GB) |
| Cloudflare R2 | $1.50 (10GB storage + egress) |
| Upstash Redis | $5-10 |
| Resend | $0-20 |
| **Total** | **~$35-60/month** |

### 100,000 Users
| Service | Estimated Cost |
|---|---|
| Cloudflare Workers | $5 + ~$15 (under 100M requests) |
| Supabase (team) | $599 + ~$0 (within limits) |
| Cloudflare R2 | $15 (100GB storage) |
| Upstash Redis | $50-100 |
| Resend | $50-100 |
| Bandwidth (CF + Supabase) | $50-100 |
| **Total** | **~$785-930/month** |

### 1,000,000 Users
| Service | Estimated Cost |
|---|---|
| Cloudflare Workers | $5 + ~$180 (1B requests) |
| Supabase (enterprise) | ~$2,000+ |
| Cloudflare R2 | $150 (1TB storage + egress) |
| Upstash Redis | $500-1,000 |
| Resend | $200-500 |
| Bandwidth | $500-1,000 |
| **Total** | **~$3,500-5,000/month** |

## First Service to Become Expensive
**Supabase database** at scale. The database connection pool and storage grow linearly with users. At 100K users, the database will likely need a Team or Enterprise plan ($599-2,000+/month) due to connection limits and storage growth from the 38 tables with extensive relationship data.

---

# VERCEL DASHBOARD CORRELLATION

## Current 30-Day Usage Analysis

The provided Vercel dashboard data shows:

| Metric | Value | Daily Average | Assessment |
|---|---|---|---|
| Edge Requests | 59K | ~1,967/day | Very low traffic |
| Function Invocations | 33K | ~1,100/day | ~56% of edge requests |
| ISR Reads | 15K | ~500/day | ~25% of edge requests are cached |
| Fluid Active CPU | 30m 30s | ~61s/day | Very light CPU usage |
| Edge Request CPU | 14s total | 0.24ms/request | Middleware is very fast |
| Fast Data Transfer | 1.15 GB | ~38 MB/day | Low bandwidth |
| Fast Origin Transfer | 176 MB | ~5.9 MB/day | Very low origin pull |
| Image Transformations | 16 | ~0.5/day | Almost no next/image usage |
| Image Cache Reads | 398 | ~13/day | Images mostly served directly |

## What This Tells Us
1. **The app is in early-stage/beta**: ~1,967 edge requests/day = ~82/hour = ~1.4/minute. This is consistent with a small testing user base of perhaps 10-50 people.
2. **The edge/function ratio is healthy**: 56% function invocations means 44% are served from cache/static. The caching strategy is working.
3. **CPU usage is minimal**: 30 minutes of active CPU over 30 days means the average request uses 0.24ms of CPU. This is extremely fast — the middleware (JWT verify + rate limit check) is lightweight.
4. **Image optimization is barely used**: Only 16 transformations means the app mostly serves images directly from R2/Supabase URLs.
5. **This does NOT represent production traffic**: The Vercel deployment appears to be the alternate/backup deployment. The primary deployment is on Cloudflare Workers, which would have separate metrics.

---

# SECURITY / DATA ACCESS AUDIT

## Authentication Security
- ✅ JWT with HS256 signing (SESSION_SECRET)
- ✅ HttpOnly, Secure, SameSite=Lax cookies
- ✅ Cookie scoped to `.uxcommunity.in` domain
- ✅ 7-day session expiry
- ✅ User liveness check (15s cache) on write operations
- ✅ Rate limiting via Upstash Redis

## Authorization
- ✅ Admin routes require `role === "admin"` in JWT
- ✅ Dashboard routes require authenticated session
- ✅ Community membership verified before data access
- ✅ Resource ownership verified before delete/update
- ⚠️ All DB queries use service-role key (bypasses RLS)
- ⚠️ Authorization logic is in API routes, not in database

## Secrets Exposure
- ⚠️ `apps/realtime/.dev.vars` contains SESSION_SECRET and REALTIME_PUBLISH_SECRET in plaintext (but this is a dev file, not committed to git based on .gitignore patterns)
- ⚠️ `apps/web/.env` and `apps/web/.env.local` contain secrets (standard practice, not committed)
- ✅ `NEXT_PUBLIC_*` vars in `wrangler.toml` are public by design (Supabase anon key)
- ✅ No service-role keys in client-side code
- ✅ No environment variable leakage in error responses

## Potential Security Issues
1. **No CSRF protection**: The app relies on SameSite=Lax cookies + JWT. No CSRF tokens. LOW RISK because Lax prevents cross-site POST.
2. **No request signing on /publish**: The realtime publish endpoint uses a static secret header. If leaked, anyone can inject events.
3. **No brute-force protection on login**: Rate limiting is global (20/10s burst), not endpoint-specific. An attacker could try 20 passwords per 10 seconds.
4. **Admin credentials in env vars**: `ADMIN_EMAIL` and `ADMIN_PASSWORD` are environment variables, not a separate auth system.

---

# CRITICAL ISSUES

## 🔴 CRITICAL

### 1. Chat Push Fan-Out Scales Linearly with Community Size
- **File**: `apps/web/lib/push/chat.ts:sendChatMessagePush()` (called from `app/api/communities/[id]/messages/route.ts`)
- **Problem**: Realtime delivery is now one room event, but the deferred Expo push fan-out still targets every member except the sender. At 10K members, one message can queue ~10K device pushes (chunked 500/query, capped at `PUSH_MAX_DELIVERIES = 10,000` inside `PUSH_TIME_BUDGET_MS = 20s`).
- **Impact**: Expo push quota, deferred CPU on the sending worker, DB reads for member/preference/token lookups
- **Scale at which it matters**: 1,000+ members in a single community

### 2. Notification Work Is Deferred but Still Per-Engagement
- **File**: `apps/web/lib/notifications.ts:deferNotification()` / `createNotification()`
- **Problem**: Community broadcast notifications were removed, so a post no longer inserts N rows. What remains is one deferred create/update per engagement event (comment, reply, like, RSVP), deduped per `(user, entity)` with `metadata.count`.
- **Impact**: Small, bounded DB writes per interaction; realtime publish per notification row
- **Scale at which it matters**: High comment/like volume on popular content

### 3. Supabase Connection Pool Exhaustion Risk
- **Problem**: Every API route and Server Component opens a DB connection via service-role. With ~100 routes each doing 1-5 DB queries, concurrent requests could exhaust the connection pool.
- **Impact**: 503 errors, request failures
- **Scale at which it matters**: 500+ concurrent users (assuming 200 connection pool on Supabase Pro)

## 🟠 HIGH

### 4. No Background Job Processing
- **Problem**: Notifications and fan-out all happen synchronously in the API request path. The `after()` helper defers notification delivery but still executes within the request lifecycle.
- **Impact**: Long API response times for write operations
- **Scale at which it matters**: 10K+ users with active communities

### 5. Socket-per-Community Connection Model
- **Problem**: Both web and mobile use the same Cloudflare DO system now, but each community room still needs its own socket to that community's `Room` DO (multiplexed rooms, ref-counted, sidebar capped at 15). A power user with many communities open keeps one socket per active community.
- **Impact**: DO instance count and per-user socket memory grow with the number of open communities
- **Scale at which it matters**: Users active in dozens of communities simultaneously

### 6. Many WebSocket Connections Per Web User
- **Problem**: The rooms (chat, presence, typing, notifications, threads, thread-comments, events, resources, resource-comments, showcase, rules, profile) are multiplexed over one socket per community plus one user socket — not one socket per room. The sidebar's own chat/typing subscriptions are capped at `SIDEBAR_REALTIME_LIMIT` (15).
- **Impact**: Memory on Cloudflare Workers, DO instance count
- **Scale at which it matters**: 10K+ concurrent users in many distinct communities

### 7. `get_sidebar_activity` RPC Unbounded by Community Count
- **File**: `apps/web/lib/communities/sidebar-server.ts:37`
- **Problem**: The RPC fetches activity for ALL of a user's communities in one query. A user in 50 communities gets 50× more data than a user in 1 community.
- **Impact**: Slow response for power users, high DB read bytes
- **Scale at which it matters**: Users with 20+ community memberships

## 🟡 MEDIUM

### 8. No Connection Pooling for Serverless
- **Problem**: Each serverless function invocation creates a new Supabase client. Module-level singleton reuses the client across warm invocations, but cold starts create new connections.
- **Impact**: Connection pool churn on cold starts
- **Scale at which it matters**: 100+ concurrent requests on cold starts

### 9. Engagement Notifications Are Deduped, Not Batched
- **File**: `apps/web/lib/notifications.ts` (`createNotification`)
- **Problem**: Each engagement event does a lookup for an existing unread row on the same entity, then an UPDATE or INSERT, plus a realtime publish. The lookup is per event, not batched across events.
- **Impact**: A few extra DB round trips per comment/like/RSVP; no O(N) fan-out anymore
- **Scale at which it matters**: Very high interaction volume on one entity

### 10. Image Compression Depends on the Client
- **File**: `apps/web/lib/image-client.ts` + the upload routes
- **Problem**: There is no server-side image processing (Sharp is gone; Cloudflare Workers cannot run it here). The browser compresses before upload and the server validates the signature, but every upload route depends on the client having compressed first.
- **Impact**: Larger uploads, more R2 storage, more bandwidth
- **Scale at which it matters**: Always (cost impact)

### 11. No Pagination on Members Endpoint
- **File**: `apps/web/app/api/communities/[id]/members/route.ts`
- **Problem**: Fetches ALL members without pagination.
- **Impact**: Large response for communities with 1000+ members
- **Scale at which it matters**: Communities with 1,000+ members

## 🟢 LOW

### 12. Typing Sweep Timers Run Per-Community
- **Files**: `components/communities/chat/useTypingPresence.ts`, `components/communities/panel/useSidebarTyping.ts`
- **Problem**: A local sweep timer per subscribed community for stale typing cleanup (sidebar capped at 15). Purely local, no API calls.
- **Impact**: Minimal CPU usage
- **Scale at which it matters**: 50+ communities open simultaneously (unlikely)

### 13. `global-fetch.ts` Patches window.fetch
- **File**: `apps/web/lib/global-fetch.ts`
- **Problem**: Patches the global fetch to route same-origin API calls through dedupe pipeline. Could interfere with third-party fetch calls.
- **Impact**: Potential compatibility issues
- **Scale at which it matters**: N/A (code quality, not scaling)

---

# WHAT WILL BREAK FIRST?

## At 10,000 Users

**First to break: Supabase connection pool**

At 10K registered users with ~2,100 daily active, peak concurrent requests of ~500 could exhaust a 200-connection Supabase pool. This manifests as:
- Increased API response times (connection waiting)
- 503 errors during traffic spikes
- cascading timeouts on dependent requests

**Second to break: Realtime fan-out for large communities**

If any community grows to 1,000+ members, a single chat message still queues a deferred Expo push for every member except the sender. The fan-out is chunked and capped (`PUSH_MAX_DELIVERIES`, `PUSH_TIME_BUDGET_MS`), but it is the remaining size-linear cost per message.

**Third to break: Push quota and deferred work**

At 1,000 members, one message can mean ~999 device pushes. Busy communities multiply that; the audible budget (3/minute/member) protects users, but the delivery quota and the sending worker's deferred CPU are the pressure points, not notification rows — community broadcast notifications were removed and engagement notifications dedupe into one row per entity.

## At 100,000 Users

**First to break: Supabase database size and connections**

100K users with 3 communities each = 300K community_members rows. The `get_sidebar_activity` RPC processes all of a user's communities in one query. Database reads per sidebar load grow linearly. The Supabase Pro tier (200 connections) would be saturated during peak hours.

**Second to break: Cloudflare Durable Object instance count**

Each active community holds one `Room` DO and each signed-in user holds one `UserDO`; the sidebar caps its own community sockets at 15 and idle community sockets close after 5 minutes. Peak concurrent DO instances therefore track *open* communities and users, not users × room count.

**Third to break: R2 storage and bandwidth**

100K users uploading images could consume 100GB+ of R2 storage. Egress at 42GB/month exceeds the free tier.

## At 1,000,000 Users

**First to break: Database write throughput**

At 1M users, the database handles millions of daily writes across messages, notifications, and interactions. Even with RPCs, the write throughput could exceed PostgreSQL limits on a single Supabase instance.

**Second to break: Realtime message throughput**

A community with 10K *connected* members receiving 100 messages/day = 1M WebSocket deliveries/day for that community alone. Delivery is per socket actually subscribed to the room, so offline members cost a (capped) push instead of a socket write.

**Third to break: Supabase plan limits**

The database storage, bandwidth, and compute would exceed any reasonable Supabase plan. A dedicated PostgreSQL cluster would be needed.

---

# OPTIMIZATION PRIORITY

| # | Issue | Impact | Effort | Expected Benefit |
|---|---|---|---|---|
| 1 | Narrow the chat push fan-out (skip members active in the room before pushing) | 🔴 Critical at scale | Medium | Cuts the remaining O(N) work per message |
| 2 | Add background job queue for the deferred publish + push work | 🔴 Critical at scale | Medium | Removes deferred work from the request lifecycle |
| 3 | Consolidate community sockets further (share one socket across communities) | 🟠 High | High | Lower DO instance count per power user |
| 4 | Add connection pooling (PgBouncer or external pooler) | 🟠 High | Medium | Prevent connection exhaustion at 1K+ concurrent |
| 5 | Cache community member/user lists where realtime already invalidates them | 🟡 Medium | Low | Fewer member lookups inside the push fan-out |
| 6 | Add pagination to /members endpoint | 🟡 Medium | Low | Prevent unbounded responses |
| 7 | Implement notification archival/cleanup | 🟡 Medium | Low | Prevent unbounded table growth |
| 8 | Move to Supabase Auth (eliminate custom JWT) | 🟡 Medium | High | Reduce auth code, enable RLS policies |
| 9 | ~~Add per-endpoint rate limiting~~ **Done** | — | — | Login, signup, chat sends, content creation, comments and reactions all have dedicated limits now |
| 10 | Cache GIPHY responses | 🟢 Low | Low | Reduce external API calls |
| 11 | ~~Unify realtime systems (web + mobile)~~ **Done** | — | — | Both clients share the Cloudflare Durable Object worker |
| 12 | Enforce client compression on every upload route (web + mobile) | 🟢 Low | Low | Reduce storage and bandwidth costs without server-side image processing |

---

# FILES REQUIRING ATTENTION

## Critical (scale blockers)
| File | Issue |
|---|---|
| `apps/web/lib/push/chat.ts` | O(N) deferred Expo push fan-out per chat message (capped and chunked) |
| `apps/web/lib/communities/sidebar-server.ts` | Unbounded get_sidebar_activity RPC |
| `apps/web/lib/supabase/service.ts` | No connection pooling strategy |
| `apps/web/app/api/communities/[id]/messages/route.ts` | Push + publish run in `after()`, so failures are only logged |

## High priority
| File | Issue |
|---|---|
| `apps/web/components/communities/panel/useSidebarTyping.ts` | Up to 15 community typing subscriptions (room ref-counted, capped) |
| `apps/web/components/communities/panel/useSidebarRealtime.ts` | Up to 15 community chat sockets; shareable across communities |
| `apps/web/app/api/communities/[id]/members/route.ts` | No pagination |
| `apps/web/lib/auth/session.ts` | 15s liveness cache for blocked users (`lib/auth/user-status-cache.ts`) |

## Medium priority
| File | Issue |
|---|---|
| `apps/web/app/api/giphy/route.ts` | No response caching |
| `apps/web/lib/r2.ts` | No upload size validation at SDK level |
| `apps/web/app/api/communities/[id]/threads/[threadId]/comments/route.ts` | N+1 author lookups (same pattern in resources/events/showcase comment routes) |

---

# UNKNOWN / NEEDS REAL-WORLD METRICS

1. **Actual user count**: Cannot determine from code alone
2. **Actual community sizes**: No way to know largest community without DB access
3. **Supabase plan tier**: Cannot determine from code (free vs pro vs team)
4. **Cloudflare plan tier**: Cannot determine from wrangler.toml
5. **Actual message throughput**: Would need load testing data
6. **Database size**: Grows over time, cannot estimate from code
7. **Cache hit rates**: Telemetry exists (`getDedupeFetchTelemetry`, `getRequestCacheTelemetry`) but actual numbers require runtime observation
8. **Cold start frequency**: Depends on traffic patterns
9. **Mobile app usage**: No analytics to determine mobile vs web split
10. **Image upload frequency**: Cannot estimate without user behavior data

---

# DATABASE AUDIT SUMMARY

## Tables (38)
Well-structured with appropriate constraints, foreign keys (CASCADE), and CHECK constraints.

## Indexes (80+)
Extensive indexing. Key composite indexes support the most common query patterns. Some duplicate indexes exist (e.g., `thread_saves` has both `idx_thread_saves_thread` + `thread_saves_thread_id_idx`).

## RLS
Enabled on all tables. Most use `public_read` (SELECT for all, writes via service-role). Two tables (`event_saves`, `event_likes`) have Supabase Auth INSERT/DELETE policies that appear unused.

## RPCs (16)
Performance-focused PostgreSQL functions that do complex joins/aggregations in the database. This is a good pattern — pushes computation to the database layer.

## Top 20 Potentially Expensive Queries

| # | RPC/Table | Operation | Risk |
|---|---|---|---|
| 1 | `get_sidebar_activity` | Aggregates across ALL user communities | 🔴 Unbounded |
| 2 | `sendChatMessagePush` | Chunked member/preference/token SELECTs + Expo push | 🔴 O(N), deferred and capped |
| 3 | `get_sidebar_activity` + sidebar chat subscriptions | Sidebar RPC + ≤15 live community sockets | 🟠 Bounded by the cap |
| 4 | `get_community_message_page` | Complex multi-join RPC | 🟡 Complex but bounded |
| 5 | `get_home_feed_page` | Cross-community feed query | 🟡 Complex |
| 6 | `get_thread_list_page` | Thread list with aggregates | 🟡 Complex |
| 7 | `get_event_list_page` | Event list with RSVP data | 🟡 Complex |
| 8 | `loadCommunityReadModel` | 5+ parallel SELECTs | 🟡 Multiple queries |
| 9 | `enrichAuthoredRows` | 3 parallel SELECTs + RPC | 🟡 Multiple queries |
| 10-19 | Various CRUD routes | 1-3 SELECTs per route | 🟢 Simple queries |

---

*Report generated by infrastructure audit on 2026-08-31; structure re-verified 2026-09-26.*
*All file paths are relative to the repository root.*
*ESTIMATE = based on code analysis and reasonable assumptions.*
*FACT = directly observable from source code.*
*ASSUMPTION = explicitly noted when code does not provide evidence.*
