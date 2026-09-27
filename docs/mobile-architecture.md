# Mobile app architecture

How the Expo / React Native app in `expo-app-standalone 3/` is wired: routing and
auth gates, the realtime chat layer, and push notifications.

```
expo-app-standalone 3/
├── app/                        Expo Router file tree (see Routing below)
├── components/
│   └── PushNotificationsBridge.tsx   headless mount point for push
├── context/AuthContext.tsx     session state for the whole app
├── lib/
│   ├── api.ts                  REST client — cookie session over fetch
│   ├── realtime.ts             singleton multiplexed WebSocket client
│   ├── realtimeCore.ts         its platform-free lifecycle (socket state machine)
│   ├── realtimeCatchUp.ts      reconnect/foreground gap recovery helpers
│   ├── push.ts                 push registration, channels, badge, diagnostics
│   ├── auth.ts                 login / logout / me endpoints
│   └── communities.ts          REST calls for communities & messages
└── hooks/
    ├── useChatMessages.ts      one community's messages + realtime topics
    ├── useTypingPresence.ts    typing indicator over the chat room
    ├── useCommunities.ts       sidebar list + unread counts
    └── usePushNotifications.ts registration + notification tap routing
```

## Routing

Routing is **Expo Router** (file-based). The root `app/_layout.tsx` renders a
Stack and, alongside it, the app-wide providers:

```
AuthProvider → PushNotificationsBridge → <Stack>
```

Provider order matters: the push hook reads the signed-in member from
`useAuth()`, so `PushNotificationsBridge` (which renders nothing) sits *inside*
`AuthProvider` but *outside* `<Stack>`.

| Route file | Screen |
|---|---|
| `app/index.tsx` | Entry point — redirects based on auth state |
| `app/(tabs)/` | Main app: `index` (Home), `communities`, `explore`, `jobs` |
| `app/(auth)/login.tsx` | Login |
| `app/community/[id].tsx` | Single community chat (slide-in) |
| `app/settings/notifications.tsx` | Notification settings + push diagnostics |
| `app/+not-found.tsx` | 404 fallback |

### Auth gating

There is no middleware on mobile — gating is done by redirect components that
watch `AuthContext`:

1. `app/index.tsx` shows a spinner while `isLoading`, then `<Redirect>` to
   `/(tabs)/communities` if signed in, else `/(auth)/login`.
2. `app/(auth)/_layout.tsx` redirects to `(tabs)` the moment a user appears,
   so a logged-in member never sees the login screen.

`AuthContext` hydrates the session on mount by calling `GET /api/auth/me`.
Deep links and push taps to `/community/[id]` render directly; the API returns
401 and the session state decides where the user lands.

### Sessions over REST

`lib/api.ts` wraps `fetch`. The web backend issues an HttpOnly JWT cookie
(`uxcommunity_session`); React Native can read the `Set-Cookie` response
header, so the client captures that value into AsyncStorage and replays it as
a `Cookie:` header on every request. The same stored token authenticates the
realtime WebSocket (see below).

## Realtime chat

`lib/realtime.ts` is a port of the web client (`apps/web/lib/realtime/client.ts`):
a **singleton `realtimeClient`** that multiplexes WebSockets to the Cloudflare
Durable Objects in `apps/realtime`. The lifecycle itself lives in
`lib/realtimeCore.ts`, which imports nothing from React Native so it can be
tested as a plain state machine (`lib/realtimeCore.test.ts`); `lib/realtime.ts`
supplies the platform pieces (authenticated URL, socket factory, foreground
probe) and exports the singleton the hooks import.

### Connection topology

- **Community-scoped rooms** (`chat:*`, `threads:*`, `events:*`, `resources:*`,
  `showcase:*`, `rules:`, `*-comments:*`) each get **their own WebSocket**
  straight to the `CommunityDO` instance that owns that room —
  `resolveRoomTarget` (`apps/realtime/src/room-routing.ts`) routes by room name,
  so `chat:<id>` and `threads:<id>` are different instances. The community
  *list* keeps a socket only for the most recently active window of them, so the
  count does not grow with membership (see “Socket budget” below).
- **User-scoped rooms** (`notifications:*`, `profile:*`) share one connection
  to the `UserDO`, keyed `user:${userId}` — the same instance
  `resolveRoomTarget` in `apps/realtime/src/room-routing.ts` publishes them to.
  Before an identity exists the socket uses the `user:global` placeholder and is
  re-keyed by `init()`, so a socket opened first still lands on the right DO.
- Message delivery is 0 RPCs — publish/subscribe straight over the socket.

### Socket budget

A phone should not carry one WebSocket per community. `useCommunities` used to
call `realtimeClient.connect(realtimeRooms.chat(cid))` for **every** joined
community, so a member of 30 communities held ~30 sockets: 30 heartbeats, 30
reconnect attempts per network change, 30 DO connections, 30 units of memory the
OS may reclaim. The list now subscribes a bounded window instead —
`selectLiveCommunityIds` in `lib/realtimeWindow.ts` keeps the
`COMMUNITY_REALTIME_LIMIT` (10) most recently active communities, the head of the
list's existing activity order. Web's sidebar applies the same policy with
`SIDEBAR_REALTIME_LIMIT` (15); mobile keeps fewer. Tests:
`lib/realtimeWindow.test.ts` (policy) and `lib/realtimeScale.test.ts` (the real
client against a fake platform: 1/10/50/100 memberships, one socket per live
community, one reconnect per socket, release/logout behaviour).

**Why not one shared socket.** The obvious design — one socket per device
carrying every community as a subscription — cannot be built safely on the
current server, and this PR does not pretend otherwise:

1. **A WebSocket terminates in exactly one Durable Object, and the instance name
   *is* the room identity.** `handleUpgrade`
   (`apps/realtime/src/index.ts`) resolves the `room` query parameter to one DO
   and hands the upgrade to it; `Room.roomName()` (`apps/realtime/src/room.ts`)
   is `ctx.id.name`, and every event and presence frame is stamped with it. The
   socket's room is fixed at upgrade time — there is no “join another room”
   frame to send it to.
2. **Inside a Room DO, subscriptions are keyed by topic alone**
   (`TopicSocketIndex` in `apps/realtime/src/subscriptions.ts`). That is only
   unambiguous because one instance serves one logical room: two communities in
   one instance would collide on `message` / `like` / `save` and merge their
   presence rosters.
3. **Routing community events through `user:${userId}` instead would change the
   fan-out model.** The UserDO already multiplexes logical rooms safely, but
   only user-scoped ones; publishing a community event there means one DO
   request *per online recipient* instead of one request plus local `ws.send()`s
   (`fanOutEvents` with its bounded pool exists precisely to avoid that cost),
   and it would change the protocol web shares.

So the honest guarantee is **bounded**, not multiplexed: a 100-community member
opens exactly as many community sockets as a 10-community member. What is
outside the window is still kept current — the list reconcile in
`useCommunities` runs on foreground, on reconnect and on pull-to-refresh — and a
screen the user actually opens subscribes its own room regardless of the window
(`useChatMessages` for the open chat, `useCommunityContent` for its tabs).
User-scoped rooms already share the single `user:${userId}` socket.

### Room + topic model

```
hook (useChatMessages, useTypingPresence, …)
  └─ realtimeClient.on(room, topic, handler)   → refcount++
       └─ WebSocket  →  wss://rt.uxcommunity.in/ws?room=<room>&token=<jwt>
```

- `on(room, topic, handler)` increments a per-topic refcount and subscribes on
  the first handler; the returned cleanup decrements and unsubscribes on the
  last. `subscribe(room)` works the same way at room level.
- A room is torn down only when topic refs, `subscribe()` refs **and** presence
  handlers are all empty — otherwise one screen's cleanup kills a socket the
  community list still depends on.
- Auth: the session JWT goes in the `token` query parameter, because React
  Native's WebSocket API cannot send custom headers.

### Liveness — the mobile-specific part

Mobile OSes suspend the app and silently kill sockets while `readyState` keeps
reporting OPEN. Without extra care, chat "goes quiet" until an app restart.
Three mechanisms handle this:

1. **Heartbeat** — every open socket sends a `ping` frame every 25 s; the DO
   auto-answers `pong` via `setWebSocketAutoResponse` without waking from
   hibernation. No pong within 6 s → the socket is recycled and reconnected
   immediately.
2. **AppState probe** — returning to the foreground probes every socket at
   once instead of waiting for the backoff timer.
3. **Exponential reconnect backoff** — 1 s base, capped at 15 s; replayed
   subscriptions and queued publishes are flushed on reconnect (local
   refcounts are authoritative, so nothing is lost).

### Reconnect catch-up

A reconnect restores the socket and its subscriptions, but it cannot deliver
what was published while the socket was down — that is a real gap (Wi-Fi → LTE,
a backgrounded app, a half-open socket the heartbeat recycled). Recovery uses
the existing APIs, never a poll loop:

- `onRoomStatus(room, handler)` fires `true` whenever a room's socket comes up
  (a re-open after a drop included) and `false` when it drops. A subscribed
  socket receives everything published after that point, so one catch-up per
  open leaves no window uncovered.
- `useChatMessages` turns that edge — and its own AppState listener — into one
  debounced, single-flight `GET …/messages?after=<newest real message>` and
  merges the page without duplicates (`lib/realtimeCatchUp.ts`). An optimistic
  send whose echo was in the gap is confirmed by the merge rather than
  duplicated, and a send whose POST has not resolved yet is never dropped.
- `useCommunityContent` refetches its tab's React Query data on the same edge,
  and `useCommunities` reconciles the community list, both debounced so a
  single network blip costs one request per surface.

### Logout and account switch

Everything in the client — sockets, subscriptions, queued frames, reconnect
timers, cached presence and the `join` identity — belongs to the signed-in
account, so `AuthContext` calls `resetRealtimeSession()` (a `destroy()`) before
signing in, and on logout / a session that has gone stale. `destroy()` also
bumps an internal session counter, which makes every cleanup closure captured by
that account inert: an unmounting screen from the previous session can no longer
release the next account's rooms. If an identity changes without a logout,
`init()` re-keys the user socket to `user:${userId}`, re-joins the remaining
sockets as the new member and forgets the previous account's user-scoped rooms.

### What flows over the chat room

`useChatMessages` (one community) handles the topics: `message`,
`message-edit`, `message-delete`, and `reaction-insert/update/delete`.
Notable behaviours:

- **Optimistic sends** are confirmed by the fan-out echo — the echo is paired
  with the pending optimistic bubble via `pickOptimisticMatch` rather than
  appended blindly (multiple sends can be in flight and their echoes
  interleave).
- The publish payload is **flat** (`sender_name` instead of a hydrated
  `users` object), so sender/reply previews are rebuilt client-side exactly
  as the web app does.
- Incoming messages from others trigger `markRead` so unread counts stay
  correct while the chat is open.

`useTypingPresence` broadcasts a `typing` topic on the same room: throttled to
1/s, idle-stop after 1.6 s, remote typists expire after 3.5 s. Arrival time is
the only clock used — a skewed device clock once made the indicator stick.

## Push notifications

Realtime only reaches a running app: iOS suspends sockets and Android kills
them, so a message that arrives while the app is closed must arrive as a
**push**. The server (web API) sends one Expo push per member — excluding the
sender, muted communities, and members who disabled chat push.

### Registration flow

`PushNotificationsBridge` (root layout) runs `usePushNotifications`, which:

1. Registers the foreground presentation handler once per process.
2. On sign-in (once per user id): asks for notification permission, mints an
   Expo push token (`getExpoPushTokenAsync` with the EAS `projectId` from
   `app.json`), and POSTs it to `/api/push/register`.
3. On sign-in and every foreground: re-reads notification settings — this
   re-applies the badge from the **server's** unread count (so a badge that
   survived a night of pushes doesn't drift) and hydrates the muted-community
   list.
4. On logout: `DELETE /api/push/register` with the stored token **before** the
   session cookie is cleared, so the next person on the phone doesn't receive
   the previous account's messages.

Every failure is recorded into persisted diagnostics
(`getPushDiagnostics`) rather than thrown — push is a nice-to-have, and the
settings screen surfaces *why* a device isn't receiving notifications
(permission denied, missing FCM setup, no EAS projectId, unreachable Expo
push service…). Android push requires a Firebase (FCM) project wired into the
build via `google-services.json`.

### Android channels

Two channels are created up front (Android channel settings are immutable, and
a notification targeting a missing channel is dropped):

| Channel | Purpose |
|---|---|
| `messages` | Audible chat notification (HIGH importance, vibrate) |
| `messages-silent` | Silent update to an existing notification (quiet hours, per-minute budget) |

### Presentation and tap routing

- **Foreground**: the handler suppresses banner/sound only when the push is
  from the community the member is *already reading* (`communityStore.
  activeCommunityId`) or a muted one — everything else still banners, like
  WhatsApp. The badge is applied even for suppressed pushes (muting stops the
  interruption, not the unread count).
- **Tap while running**: `addNotificationResponseReceivedListener` reads the
  `community_message` payload and `router.push('/community/<id>')`.
- **Tap from cold start**: `getLastNotificationResponseAsync` handles the
  response that arrives before any screen mounts.

### Local vs server test pushes

The settings screen has two tests that fail independently — telling them apart
is the difference between "my phone is broken" and "the project has no FCM
key":

- `sendTestNotificationAsync` posts a **local** notification, proving the
  device half (permission, channel, presentation).
- `sendServerPushTestAsync` asks the API for a **server** push, proving the
  sending half (tokens registered, Expo credentials, FCM/APNs keys).
