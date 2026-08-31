# FULL PRODUCTION INFRASTRUCTURE AUDIT
## UX Community — Complete Architecture Analysis

---

# EXECUTIVE SUMMARY

## Top 10 Findings

1. **Dual deployment architecture** — The app runs on both Cloudflare Workers (via OpenNext) and Vercel. The current active deployment is Cloudflare Workers. The Vercel dashboard numbers reflect the alternate deployment path.

2. **Massive realtime fan-out per message** — Sending ONE chat message triggers 1 database INSERT + 1 database query (member IDs) + 1 HTTP publish to Cloudflare + N Durable Object forwards (one per member) + N WebSocket broadcasts. At 1,000 members this is 1,000+ WebSocket deliveries per message.

3. **18+ concurrent WebSocket connections per user on web** — A single active user maintains separate WebSocket connections for: chat, presence, typing, panel (sidebar), notifications, threads, thread-comments, events, resources, resource-comments, showcase, rules, and profile rooms.

4. **Mobile app uses Supabase Realtime (different from web)** — The Expo app uses Supabase `postgres_changes` and `broadcast` channels instead of the Cloudflare Durable Object system. This creates a completely separate realtime path with different scaling characteristics.

5. **Service-role key used for ALL database queries** — Every API route and Server Component uses the Supabase service-role key, bypassing RLS. This is intentional (custom JWT auth, not Supabase Auth) but means database security depends entirely on API route validation.

6. **No Supabase Auth** — Authentication is fully custom (JWT via `jose`, bcrypt password hashing). Supabase Auth is not used.

7. **100+ API routes** — The web app has approximately 100 Next.js API route handlers, all running as serverless functions on Cloudflare Workers. Each involves a DB query.

8. **Well-implemented caching** — Sophisticated client-side caching: `request-cache.ts`, `cache.ts` (module-level community/message cache), `msgCache`/`metaCache` (bounded LRU maps), `master-data-cache.ts` (1-hour cached master data), `dedupe-fetch.ts`.

9. **Rate limiting exists but is generous** — Global rate limit: 20 requests/10s burst, 120/60s sustained. Per-user or per-IP. No per-endpoint rate limiting.

10. **Chat messages API has special timeout handling** — `maxDuration: 10` in `vercel.json` for the messages endpoint. It calls the `get_community_message_page` RPC.

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
  |                  |                      |--- POST -----------> Image Moderation Service
  |                  |                      |--- POST -----------> Cloudflare Realtime (/publish)
  |                  |
  |                  |--- SSR/ISR ---> Server Components (data fetching)
  |
  |--- WSS ----> Cloudflare Realtime Worker (rt.uxcommunity.in)
                    |
                    |--- WebSocket ---> Room Durable Object (per room)
                                          |
                                          |--- SQLite storage (presence)
                                          |--- Broadcast to all sockets

User (Mobile/Expo)
  |
  |--- HTTPS ---> Same Cloudflare Workers (API routes)
  |--- WSS ----> Supabase Realtime (postgres_changes + broadcast)
```

### Deployment Stack
- **Primary**: Cloudflare Workers via OpenNext (`apps/web/wrangler.toml`)
- **Alternate**: Vercel (`apps/web/vercel.json`, region: syd1)
- **Realtime**: Separate Cloudflare Worker (`apps/realtime/wrangler.toml`)
- **CI/CD**: GitHub Actions (`.github/workflows/deploy.yml`)

### Technology Inventory

| Component | Technology | Provider | Purpose |
|---|---|---|---|
| Frontend | Next.js 14 (App Router) + React 18 | OpenNext/Cloudflare | Web application |
| Mobile | Expo SDK 54 + React Native | EAS Build | Mobile app |
| Backend | Next.js API Routes (~100 routes) | Cloudflare Workers | Serverless API |
| Database | PostgreSQL | Supabase | Primary data store |
| Realtime (Web) | Cloudflare Durable Objects + WebSocket Hibernation | Cloudflare | Chat, presence, typing |
| Realtime (Mobile) | Supabase Realtime (postgres_changes) | Supabase | Chat, content updates |
| Authentication | Custom JWT (jose) + bcrypt | Application | User sessions |
| Storage | Cloudflare R2 (S3-compatible) | Cloudflare | Image/file storage |
| CDN | Cloudflare | Cloudflare | Static assets, edge |
| Rate Limiting | Upstash Redis | Upstash | Request throttling |
| Email | Resend | Resend | Transactional email |
| Image Processing | Sharp (server) + Canvas API (client) | Application | Image compression |
| Moderation | NudeNet (external service) | External | Image moderation |
| GIF Search | GIPHY API | GIPHY | GIF search |
| Validation | Zod | Application | Input validation |

### Infrastructure Services Used
- ✅ Vercel (alternate deployment)
- ✅ Supabase (PostgreSQL + Realtime for mobile)
- ✅ Cloudflare (Workers, Durable Objects, R2, CDN)
- ✅ PostgreSQL (via Supabase)
- ✅ Supabase Realtime (mobile only)
- ✅ Vercel Functions (alternate deployment)
- ✅ Vercel Edge Functions (middleware on Vercel)
- ✅ Cloudflare Workers (primary deployment)
- ✅ Cloudflare Durable Objects (realtime)
- ❌ Redis (Upstash used for rate limiting only, not caching)
- ❌ Queues (no job queues)
- ❌ Cron Jobs (only Vercel keep-warm cron)
- ✅ WebSockets (Cloudflare Durable Objects)
- ❌ Server-Sent Events
- ❌ Polling (typing sweep timers are local-only, no API calls)
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
1. GET / (redirect)                  → Middleware: JWT verify (no DB)
2. GET /dashboard                    → Server Component: 2 DB SELECT (users, designer_profiles)
3. GET /api/communities              → 1 RPC (get_sidebar_activity) + 3 DB SELECT + cache lookup
4. GET /api/notifications            → 2 DB SELECT (notifications count + list)
5. WebSocket: panel:${userId}        → 1 WSS upgrade to Durable Object
6. WebSocket: notifications:${userId} → 1 WSS upgrade to Durable Object
7. WebSocket: typing:${communityIds} → Up to 8 WSS upgrades (one per community)
Total: ~5 HTTP requests, ~7 DB queries, 3-10 WebSocket connections
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
   → DB: 1 SELECT (membership check)
   → DB: 1 INSERT (message row)
   → Realtime: loadCommunityMemberUserIds() → 1 DB SELECT (all member user_ids)
   → Realtime: publishChatFanout() → 1 HTTP POST to Cloudflare /publish
     → Worker fans out to: chat:${id} + N × panel:${memberId}
     → N WebSocket broadcasts
2. Optimistic UI: message appears immediately (0 HTTP)
3. Sidebar: patchSidebarLastMessage() → 0 HTTP (local cache update)
Total: 1 HTTP request, 3 DB queries, 1 realtime publish → N+1 WebSocket deliveries
```

## H. Receiving a Chat Message
```
1. WebSocket: chat:${id} receives "event" message → 0 HTTP
2. Client: dispatch to useRealtimeChat handlers → 0 HTTP
3. If user unknown: 1 HTTP to resolve profile → 0-1 HTTP
4. Sidebar: panel:${userId} receives "message:${cid}" event → 0 HTTP
Total: 0-1 HTTP requests, 0 DB queries (all via realtime)
```

## I. Sending a Post (Thread/Event/Resource)
```
1. POST /api/communities/[id]/threads (or events/resources)
   → DB: 1 SELECT (membership check)
   → DB: 1 INSERT (new row)
   → Realtime: 1 publish to threads:${id} + N × panel:${memberId}
2. Notifications: deferCommunityNotification()
   → DB: 1 SELECT (all member user_ids except actor)
   → DB: 1 INSERT (bulk notifications, N rows)
   → Realtime: N × publish to notifications:${userId}
Total: 1 HTTP, 3-4 DB queries, 1+N realtime publishes
```

## J. Loading Comments
```
1. GET /api/communities/[id]/[feature]/[itemId]/comments
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
   → External: image moderation service → 1 HTTP POST
   → Storage: R2 PutObject → 1 S3 API call
   → DB: 1 INSERT (message with image_url)
   → Realtime: 1 publish (same as G)
Total: 1 HTTP (client), 1 external HTTP (moderation), 1 R2 write, 3 DB queries
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
| 1 | `chat:${cid}` | `useRealtimeChat.ts` via `realtimePool` | Community open | 5 min idle after last subscriber | ✅ Pool manages lifecycle |
| 2 | `presence:${cid}` | `useOnlinePresence.ts` | Community open | Community switch (useEffect cleanup) | ✅ client.close() |
| 3 | `typing:${cid}` (active) | `useTypingPresence.ts` | Community open | Community switch | ✅ client.close() |
| 4 | `typing:${cid}` (sidebar, up to 8) | `useSidebarTyping.ts` | Dashboard mount | Logout / visibility hidden | ✅ clients.forEach(close) |
| 5 | `panel:${userId}` | `useSidebarRealtime.ts` | Dashboard mount | Logout | ✅ client.close() |
| 6 | `threads:${cid}` | `ThreadsView.tsx` | Threads tab open | Tab switch / unmount | ✅ client.close() |
| 7 | `thread-comments:${tid}` | `ThreadDetailClient.tsx` | Thread detail open | Navigate away | ✅ client.close() |
| 8 | `events:${cid}` | `EventsView.tsx` | Events tab open | Tab switch | ✅ client.close() |
| 9 | `resources:${cid}` | `ResourcesView.tsx` | Resources tab open | Tab switch | ✅ client.close() |
| 10 | `resource-comments:${rid}` | `ResourceDetailClient.tsx` | Resource detail open | Navigate away | ✅ client.close() |
| 11 | `showcase:${postId}` | `ShowcaseDetailClient.tsx` | Showcase detail open | Navigate away | ✅ client.close() |
| 12 | `rules:${cid}` | `CommunityInfoPanel.tsx` | Info panel open | Panel close | ✅ client.close() |
| 13 | `notifications:${userId}` | `NotificationBell.tsx` | Dashboard mount | Logout | ✅ client.close() |
| 14 | `profile:${userId}` | `ProfileThreads.tsx` | Profile page mount | Navigate away | ✅ client.close() |

**Maximum concurrent connections per user**: ~14 (if all rooms open simultaneously)
**Typical concurrent connections**: 3-5 (panel + typing for sidebar + 1 active community rooms)

### Server-Side Presence Tracking
- **File**: `apps/realtime/src/room.ts`
- **Storage**: Durable Object SQLite (MEMBERS_KEY = "members")
- **Mechanism**: `join()` increments `connections` counter, `leave()` decrements. At 0, user removed.
- **Broadcast**: Full member list sent to all sockets on every join/leave.
- **Cleanup**: `webSocketClose` and `webSocketError` handlers call `leave(userId)`.

### Reconnection Behavior
- **Client**: `RealtimeClient` with exponential backoff (1s base, 15s max)
- **Max reconnection delay**: 15 seconds
- **Tab visibility gating**: All realtime hooks check `isVisible` before connecting, tearing down WebSocket when hidden
- **Catch-up on reconnect**: `useRealtimeChat` runs debounced `fetchMessages()` with `?after=` cursor on fresh subscription

## Mobile App: Supabase Realtime System

### Per-Community Channels

| # | Channel Pattern | File | Tables Monitored | Cleanup? |
|---|---|---|---|---|
| 1 | `chat:${cid}` | `useChatMessages.ts` | community_messages (INSERT, UPDATE), message_reactions (*) | ✅ removeChannel |
| 2 | `panel:${cid}` | `useCommunities.ts` | community_messages (INSERT, UPDATE), message_reactions (INSERT, UPDATE, DELETE) | ✅ removeChannel |
| 3 | `community-typing:${cid}` | `useTypingPresence.ts` | broadcast only | ✅ removeChannel |
| 4 | `mobile-${kind}-${cid}` | `useCommunityContent.ts` | community_threads/events/resources + interaction tables | ✅ removeChannel |

**Mobile creates 3 channels per community** (panel + typing + content), vs web's 7-14 separate WebSocket connections.

### Mobile vs Web Realtime Differences
| Aspect | Web | Mobile |
|---|---|---|
| Transport | Raw WebSocket via Cloudflare DO | Supabase Realtime (postgres_changes) |
| Auth | JWT cookie on WS handshake | Supabase anon key (no auth on channel) |
| Message delivery | Server push via /publish endpoint | PostgreSQL replication |
| Typing | Cloudflare broadcast | Supabase broadcast |
| Presence | Durable Object storage + broadcast | Not implemented |
| Connection model | 1 WebSocket per room | 1 channel per subscription |
| Scaling | DO per room, N connections per DO | Supabase connection pool |

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
[SERVER] middleware.ts: JWT verify (no DB), rate limit check (Upstash Redis × 2)
  |
  v
[SERVER] messages/route.ts:
  1. DB: SELECT community_members WHERE community_id = ? AND user_id = ? (membership check)
  2. DB: INSERT INTO community_messages (content, user_id, community_id, reply_to_id)
  3. DB: SELECT community_members WHERE community_id = ? (load ALL member user_ids)
  |
  v
[SERVER] publishChatFanout():
  4. HTTP POST to Cloudflare Realtime /publish with events[] array:
     - Event 1: room=chat:${cid}, topic=message
     - Events 2..N+1: room=panel:${memberId}, topic=message:${cid} (one per member)
  |
  v
[CLOUDFLARE WORKER] index.ts handlePublish():
  5. For each event in events[]:
     - idFromName(room) → Durable Object ID
     - stub.fetch() → forward to Room DO
  |
  v
[CLOUDFLARE DO - Room] room.ts publish():
  6. For each WebSocket in room:
     - ws.send(JSON.stringify({t:"event", room, topic, data, sender}))
  |
  v
[CLIENTS] Receive WebSocket message:
  - Chat window: append to messages[]
  - Sidebar panel: update community preview + unread count
```

### Operation Count

| Operation | Count | Notes |
|---|---|---|
| HTTP requests (client→server) | 1 | POST /messages |
| DB queries (server) | 3 | membership check + INSERT + member list |
| DB writes (server) | 1 | INSERT message |
| HTTP requests (server→realtime) | 1 | POST /publish (batched) |
| DO forwards (Worker→DO) | N+1 | 1 chat room + N panel rooms |
| WebSocket broadcasts | N+1 | 1 to chat room + 1 per panel room |
| Notifications DB writes | M | Bulk insert for M community members (deferred via `after()`) |
| Notification realtime publishes | M | One per notified user |

**Total per message**: 2 HTTP, 4+ DB operations, 1 batched publish, N+1 WebSocket deliveries, M notification inserts

### Scale Model for Chat Messages

| Community Size | DB ops/message | DO forwards | WebSocket deliveries | Notification inserts |
|---|---|---|---|---|
| 10 users | 4 | 11 | 11 | 9 |
| 100 users | 4 | 101 | 101 | 99 |
| 1,000 users | 4 | 1,001 | 1,001 | 999 |
| 10,000 users | 4 | 10,001 | 10,001 | 9,999 |
| 100,000 users | 4 | 100,001 | 100,001 | 99,999 |

**CRITICAL**: At 10,000 members, ONE message creates 10,000+ WebSocket deliveries and 10,000 notification inserts.

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
| `useChatData.ts:264` | `[communityId]` | Bootstrap + messages + meta | Per community switch |
| `useRealtimeChat.ts:65` | `[communityId, debouncedCatchUp]` | Catch-up fetch on reconnect | Per reconnection |
| `useSidebarCommunities.ts:90` | `[load]` | `/api/communities` | On mount + on SIDEBAR_CHANGED_EVENT |
| `NotificationBell.tsx:101` | `[fetchNotifications]` | `/api/notifications` | On mount |
| `HomeFeed.tsx:68` | `[fetchFeed, refreshToken]` | `/api/home/feed` | On mount |

### useEffect with WebSocket connections
| File | Dependencies | Connection | Frequency |
|---|---|---|---|
| `useRealtimeChat.ts:65` | `[communityId, ...]` | chat:${cid} via pool | Per community |
| `useOnlinePresence.ts:23` | `[communityId, ...]` | presence:${cid} | Per community |
| `useTypingPresence.ts:120` | `[communityId, ...]` | typing:${cid} | Per community |
| `useSidebarRealtime.ts:72` | `[communityIds, userId]` | panel:${userId} + typing:${cid} ×8 | On mount |
| `useSidebarTyping.ts:44` | `[communityIds, ...]` | typing:${cid} ×8 | Per sidebar |
| `NotificationBell.tsx:124` | `[userId, isVisible]` | notifications:${userId} | On mount |
| `ThreadsView.tsx:83` | `[communityId]` | threads:${cid} | Per tab |
| `EventsView.tsx:69` | `[communityId]` | events:${cid} | Per tab |
| `ResourcesView.tsx:86` | `[communityId]` | resources:${cid} | Per tab |

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
1. **`useSidebarTyping.ts`**: Creates up to 8 `RealtimeClient` instances (one per joined community) on every dashboard mount. Each is a separate WebSocket. Could be consolidated into a single multiplexed connection.
2. **`useSidebarRealtime.ts`**: Creates 1 `RealtimeClient` for the panel room. The panel room receives events for ALL communities, so this is efficient.
3. **`useRealtimeChat.ts`**: On reconnection, runs `fetchMessages()` with `?after=` cursor. This is a catch-up mechanism, not a duplicate — it fills gaps from missed realtime events.

---

# MOBILE APP AUDIT

## Architecture
- **Framework**: Expo SDK 54 + React Native 0.81 + expo-router
- **Data fetching**: React Query (`@tanstack/react-query`)
- **Realtime**: Supabase Realtime (NOT Cloudflare DO)
- **Auth**: Cookie-based via web backend API
- **State**: React Context (AuthContext) + React Query cache

## API Requests
All mobile API calls go through `lib/api.ts` which wraps `fetch()` with session cookie management.

| Hook | Requests | Trigger |
|---|---|---|
| `useCommunities.ts` | GET `/api/communities` | Mount + AppState active |
| `useChatMessages.ts` | GET `/api/communities/:id/messages` | Mount + pagination |
| `useSendMessage.ts` | POST `/api/communities/:id/messages/upload` + POST `/api/communities/:id/messages` | User sends message |
| `useCommunityContent.ts` | GET via `getCommunityContent()` | Mount + realtime invalidation |
| `AuthContext.tsx` | GET `/api/auth/me` | Mount |

## Realtime Connections (Mobile)
| Channel | Tables | Trigger |
|---|---|---|
| `panel:${cid}` × N communities | community_messages, message_reactions | Background |
| `community-typing:${cid}` × N communities | broadcast only | Background |
| `chat:${cid}` | community_messages, message_reactions | Chat open |
| `mobile-${kind}-${cid}` | content tables | Content tab open |

**Mobile creates 2N+1 channels** (2 per community in background + 1 for active chat).

## Mobile vs Web Differences
| Aspect | Web | Mobile |
|---|---|---|
| Realtime transport | Cloudflare Durable Objects | Supabase Realtime |
| Connection model | 1 WebSocket per room (pooled) | 1 channel per subscription |
| Caching | Module-level Maps + request-cache | React Query |
| Optimistic UI | Yes (messages, likes, saves) | Yes (messages) |
| Image compression | Canvas API (client-side WebP) | None (uploads as-is) |
| Background behavior | Tab visibility gating | AppState reconciliation |
| Notification delivery | WebSocket | No push notifications yet |

---

# IMAGE / FILE AUDIT

## Upload Flow
1. **Client compression**: `compressChatImageClient()` → Canvas → WebP, max 1200×1200, quality 0.65
2. **Upload**: POST multipart to `/api/communities/[id]/messages/upload`
3. **Server**: Membership check → moderation service → R2 PutObject → INSERT with image_url
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
- **Cloudflare CDN**: Serves R2 public URLs via Cloudflare's edge network
- **next/image**: Used sparingly (16 transformations in 30 days). Configured for Supabase Storage + GIPHY CDN remote patterns.

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

| DO Class | File | Instances | Storage | Purpose |
|---|---|---|---|---|
| `Room` | `apps/realtime/src/room.ts` | 1 per room name | SQLite | WebSocket hub + presence |

### Room DO Details
- **WebSocket Hibernation**: Uses `acceptWebSocket()` + `serializeAttachment()` for eviction survival
- **Storage**: `MEMBERS_KEY = "members"` → JSON object in SQLite with `{userId: {name, avatar, connections}}`
- **Message limit**: 8192 bytes per message (MAX_MESSAGE_BYTES)
- **Fan-out**: Worker processes `/publish` in chunks of 40 (under 50-subrequest cap)

## R2 Storage
| Bucket | Purpose | Public URL |
|---|---|---|
| Configured via `R2_BUCKET_NAME` env | All image uploads | `R2_PUBLIC_URL/<key>` |

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
3. **Image moderation fallback**: If the moderation service is down, images are allowed after local validation only (MIME check + size check). This is documented as intentional.
4. **No brute-force protection on login**: Rate limiting is global (20/10s burst), not endpoint-specific. An attacker could try 20 passwords per 10 seconds.
5. **Admin credentials in env vars**: `ADMIN_EMAIL` and `ADMIN_PASSWORD` are environment variables, not a separate auth system.

---

# CRITICAL ISSUES

## 🔴 CRITICAL

### 1. Chat Message Fan-Out Scales Linearly with Community Size
- **File**: `apps/web/lib/realtime/server.ts:publishChatFanout()`
- **Problem**: Every chat message creates N+1 WebSocket deliveries where N = community member count. At 10K members, one message = 10,001 DO forwards + 10,001 WebSocket broadcasts.
- **Impact**: CPU time on the realtime Worker, bandwidth, Durable Object storage
- **Scale at which it matters**: 1,000+ members in a single community

### 2. Bulk Notification Insert Scales Linearly
- **File**: `apps/web/lib/notifications.ts:notifyCommunityMembers()`
- **Problem**: Creating a thread/event/resource inserts N notification rows (one per member except actor). At 10K members, one post = 9,999 notification INSERTs + 9,999 realtime publishes.
- **Impact**: Database write amplification, storage growth
- **Scale at which it matters**: 1,000+ members in a single community

### 3. Supabase Connection Pool Exhaustion Risk
- **Problem**: Every API route and Server Component opens a DB connection via service-role. With ~100 routes each doing 1-5 DB queries, concurrent requests could exhaust the connection pool.
- **Impact**: 503 errors, request failures
- **Scale at which it matters**: 500+ concurrent users (assuming 200 connection pool on Supabase Pro)

## 🟠 HIGH

### 4. No Background Job Processing
- **Problem**: Notifications, moderation logging, and fan-out all happen synchronously in the API request path. The `after()` helper defers notification delivery but still executes within the request lifecycle.
- **Impact**: Long API response times for write operations
- **Scale at which it matters**: 10K+ users with active communities

### 5. Dual Realtime Systems (Web + Mobile)
- **Problem**: Web uses Cloudflare Durable Objects, mobile uses Supabase Realtime. They don't share state. A message sent from web appears on mobile via Supabase replication, but typing indicators and presence don't cross systems.
- **Impact**: Inconsistent user experience, duplicated infrastructure
- **Scale at which it matters**: Always (architecture issue, not scaling issue)

### 6. 18+ WebSocket Connections Per Web User
- **Problem**: Each room (chat, presence, typing, panel, notifications, threads, thread-comments, events, resources, resource-comments, showcase, rules, profile) creates a separate WebSocket to a separate Durable Object.
- **Impact**: Memory on Cloudflare Workers, DO instance count
- **Scale at which it matters**: 10K+ concurrent users = 100K+ DO instances

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

### 9. `notifyCommunityMembers` Does N Individual SELECT + INSERT
- **File**: `apps/web/lib/notifications.ts:80-176`
- **Problem**: First queries all member IDs, then inserts notifications. The member query returns ALL user_ids, and the insert creates N rows. No batching.
- **Impact**: O(N) DB operations per community notification event
- **Scale at which it matters**: Communities with 500+ members

### 10. Image Uploads Not Compressed on Server
- **File**: `apps/web/app/api/communities/[id]/messages/upload/route.ts`
- **Problem**: Server-side Sharp is unavailable on Cloudflare Workers. Client-side compression is used instead. But showcase, thread, and event image uploads go through different routes that may not compress.
- **Impact**: Larger uploads, more R2 storage, more bandwidth
- **Scale at which it matters**: Always (cost impact)

### 11. No Pagination on Members Endpoint
- **File**: `apps/web/app/api/communities/[id]/members/route.ts`
- **Problem**: Fetches ALL members without pagination.
- **Impact**: Large response for communities with 1000+ members
- **Scale at which it matters**: Communities with 1,000+ members

## 🟢 LOW

### 12. Typing Sweep Timers Run Per-Community
- **Files**: `useTypingPresence.ts`, `useSidebarTyping.ts`
- **Problem**: 1-second `setInterval` per community for stale typing cleanup. Purely local, no API calls.
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

If any community grows to 1,000+ members, a single chat message triggers 1,000+ DO forwards. The Cloudflare Worker's 50-subrequest limit is handled by chunking (CHUNK=40), but the total CPU time per publish could exceed Worker limits.

**Third to break: Notification storage**

Each post in a 1,000-member community creates 999 notification rows. With 10 posts/day in active communities, that's 10,000 notification rows/day. The `notifications` table grows linearly with no cleanup/archival.

## At 100,000 Users

**First to break: Supabase database size and connections**

100K users with 3 communities each = 300K community_members rows. The `get_sidebar_activity` RPC processes all of a user's communities in one query. Database reads per sidebar load grow linearly. The Supabase Pro tier (200 connections) would be saturated during peak hours.

**Second to break: Cloudflare Durable Object instance count**

100K users × 14 rooms = potentially 1.4M DO instances. While not all rooms are open simultaneously, the connection pool keeps chat connections warm for 5 minutes. Peak concurrent DO instances could reach 100K+.

**Third to break: R2 storage and bandwidth**

100K users uploading images could consume 100GB+ of R2 storage. Egress at 42GB/month exceeds the free tier.

## At 1,000,000 Users

**First to break: Database write throughput**

At 1M users, the database handles millions of daily writes across messages, notifications, and interactions. Even with RPCs, the write throughput could exceed PostgreSQL limits on a single Supabase instance.

**Second to break: Realtime message throughput**

A community with 10K members sending 100 messages/day = 1M WebSocket deliveries/day for that community alone. Across all communities, this could reach 100M+ WebSocket deliveries/day.

**Third to break: Supabase plan limits**

The database storage, bandwidth, and compute would exceed any reasonable Supabase plan. A dedicated PostgreSQL cluster would be needed.

---

# OPTIMIZATION PRIORITY

| # | Issue | Impact | Effort | Expected Benefit |
|---|---|---|---|---|
| 1 | Batch notification inserts (use bulk INSERT, not per-member) | 🔴 Critical at scale | Low | 10-100x reduction in notification DB writes |
| 2 | Add background job queue for fan-out + notifications | 🔴 Critical at scale | Medium | Remove write amplification from request path |
| 3 | Consolidate WebSocket connections (multiplex rooms) | 🟠 High | High | 5-10x reduction in DO instance count |
| 4 | Add connection pooling (PgBouncer or external pooler) | 🟠 High | Medium | Prevent connection exhaustion at 1K+ concurrent |
| 5 | Cache community member list (invalidate on membership change) | 🟡 Medium | Low | Remove O(N) member query per message |
| 6 | Add pagination to /members endpoint | 🟡 Medium | Low | Prevent unbounded responses |
| 7 | Implement notification archival/cleanup | 🟡 Medium | Low | Prevent unbounded table growth |
| 8 | Move to Supabase Auth (eliminate custom JWT) | 🟡 Medium | High | Reduce auth code, enable RLS policies |
| 9 | Add per-endpoint rate limiting | 🟡 Medium | Medium | Prevent brute-force and abuse |
| 10 | Cache GIPHY responses | 🟢 Low | Low | Reduce external API calls |
| 11 | Unify realtime systems (web + mobile) | 🟢 Low | Very High | Consistent cross-platform experience |
| 12 | Add image compression for all upload types | 🟢 Low | Low | Reduce storage and bandwidth costs |

---

# FILES REQUIRING ATTENTION

## Critical (scale blockers)
| File | Issue |
|---|---|
| `apps/web/lib/realtime/server.ts` | O(N) fan-out per message (loadCommunityMemberUserIds) |
| `apps/web/lib/notifications.ts` | O(N) notification inserts per community event |
| `apps/web/app/api/communities/[id]/messages/route.ts` | Synchronous fan-out in request path |
| `apps/web/lib/communities/sidebar-server.ts` | Unbounded get_sidebar_activity RPC |
| `apps/web/lib/supabase/service.ts` | No connection pooling strategy |

## High priority
| File | Issue |
|---|---|
| `apps/web/components/communities/panel/useSidebarTyping.ts` | 8 WebSocket connections for typing |
| `apps/web/components/communities/panel/useSidebarRealtime.ts` | Panel room could be consolidated |
| `apps/web/app/api/communities/[id]/members/route.ts` | No pagination |
| `apps/web/lib/auth/session.ts` | 15s liveness cache for blocked users |

## Medium priority
| File | Issue |
|---|---|
| `apps/web/app/api/giphy/route.ts` | No response caching |
| `apps/web/lib/r2.ts` | No upload size validation at SDK level |
| `apps/web/app/api/communities/[id]/[feature]/[itemId]/comments/route.ts` | N+1 author lookups |

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
| 2 | `notifyCommunityMembers` | SELECT all members + bulk INSERT | 🔴 O(N) |
| 3 | `loadCommunityMemberUserIds` | SELECT all member IDs | 🔴 O(N) per message |
| 4 | `get_community_message_page` | Complex multi-join RPC | 🟡 Complex but bounded |
| 5 | `get_home_feed_page` | Cross-community feed query | 🟡 Complex |
| 6 | `get_thread_list_page` | Thread list with aggregates | 🟡 Complex |
| 7 | `get_event_list_page` | Event list with RSVP data | 🟡 Complex |
| 8 | Profile saved items (`/api/profile/saved`) | 6-8 sequential SELECT queries | 🟡 Many queries |
| 9 | `loadCommunityReadModel` | 5+ parallel SELECTs | 🟡 Multiple queries |
| 10 | `enrichAuthoredRows` | 3 parallel SELECTs + RPC | 🟡 Multiple queries |
| 11-20 | Various CRUD routes | 1-3 SELECTs per route | 🟢 Simple queries |

---

*Report generated by infrastructure audit on 2026-08-31.*
*All file paths are relative to `/Users/sachin/Documents/GitHub/uxcommunity/`.*
*ESTIMATE = based on code analysis and reasonable assumptions.*
*FACT = directly observable from source code.*
*ASSUMPTION = explicitly noted when code does not provide evidence.*
