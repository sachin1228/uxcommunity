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
Durable Objects in `apps/realtime`.

### Connection topology

- **Community-scoped rooms** (`chat:*`, `threads:*`, `events:*`, `resources:*`,
  `showcase:*`, `rules:`, `*-comments:*`) each get **their own WebSocket**
  straight to that community's `CommunityDO`.
- **User-scoped rooms** (`notifications:*`, `profile:*`) share one connection
  to the `UserDO` (`user:global`).
- Message delivery is 0 RPCs — publish/subscribe straight over the socket.

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
