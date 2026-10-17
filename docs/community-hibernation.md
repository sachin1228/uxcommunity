# Community hibernation — the live socket window

Why a member of 25 communities sees some communities update live and others
"after a while": every community chat is its own WebSocket, clients keep a
bounded **live window** of them, and everything outside the window is
**hibernated** — no socket, so its list row moves only when the client
reconciles from the server. This is by design (server architecture + phone
battery), and this document is the full map: caps, triggers, cadences, and the
exact behaviour of every surface.

Companion reading: `mobile-architecture.md` §Realtime chat (transport and
socket budget), `performance-audit.md`, `infrastructure-cost-audit.md`.

## TL;DR

- Each community's realtime runs on **its own WebSocket** straight to that
  community's Durable Object. The server cannot safely multiplex several
  communities over one socket (see below).
- Clients therefore keep sockets only for the **most recently active window**:
  **10 communities on mobile** (`COMMUNITY_REALTIME_LIMIT`), **15 on web**
  (`SIDEBAR_REALTIME_LIMIT`). Everything else is hibernated.
- A hibernated row's preview, unread count and bubble-to-top position move only
  when a **reconcile** (`GET /api/communities`) runs. A community you *open* is
  always live, regardless of the window.
- **Push notifications are unaffected** — the server pushes per message per
  member whether or not the community holds a socket.
- Mobile now also reconciles **on every real return to the list and once a
  minute while the list is on screen** (`HIBERNATED_LIST_REFRESH_MS`), matching
  the poll the web sidebar always had (`SIDEBAR_STALE_MS`).

## Why one socket per community (why not multiplex)

`lib/realtimeWindow.ts` documents the three server facts; the short version:

1. A WebSocket terminates in exactly one Durable Object, and the DO instance
   name **is** the room identity (`Room.roomName()` in `apps/realtime/src/room.ts`,
   stamped on every event and presence frame). The socket's room is fixed at
   upgrade time — there is no "join another room" frame.
2. Inside a Room DO, subscriptions are keyed by **topic alone**
   (`apps/realtime/src/subscriptions.ts`). That is only unambiguous because one
   instance serves one logical room: two communities in one instance would
   collide on `message` / `like` / `save` and merge their presence rosters.
3. Routing community events through a `user:${userId}` gateway instead would
   turn one publish into **one DO request per online recipient** instead of one
   request plus local `ws.send()`s — the fan-out cost the realtime worker was
   specifically hardened to avoid (`fanOutEvents`).

So the client bounds the socket count instead of pretending to multiplex.

## The window: who is live, who hibernates

| | Cap | Constant | Applied by |
|---|---|---|---|
| Mobile | 10 communities | `COMMUNITY_REALTIME_LIMIT` (`lib/realtimeWindow.ts`) | `useCommunities` (the list) |
| Web | 15 communities | `SIDEBAR_REALTIME_LIMIT` (`useSidebarRealtime.ts`) | the sidebar |

- The window is the **head of the activity-sorted list** — pinned event chats
  first, then most recent message/join (`sortByLastActivity` /
  `compareByRecentActivity`). It is **not the viewport**: a row at position 3
  scrolled off screen is live; a row at position 25 visible on screen is
  hibernated.
- The window **recomputes whenever the list order changes**. A new message
  bubbles its community to the top; at the next reconcile that community is
  inside the head, so it opens a socket — and the community that fell out
  closes theirs. From that point its later messages are realtime.
- Pinned event chats hold window slots for as long as their event is ahead.
- **A community you open is always live**, whatever its position:
  `useChatMessages` subscribes its own room (messages, edits, deletes,
  reactions, typing and presence all share that one socket). Content tabs a
  member browses add their own rooms (`useCommunityContent`: threads, events,
  resources). A deep-linked community outside the window therefore runs one
  socket *above* the budget while it is on screen.

## What hibernation affects — and what it does not

| Surface | Hibernated community |
|---|---|
| List preview / unread / bubble-to-top | **Frozen until the next reconcile.** No socket patch. |
| Open chat | **Always live**, plus an on-open catch-up (cached window patched instantly, `?after=<newest>` closes the gap — `useChatMessages`, `communityBootstrap.ts`). |
| Push notifications | **Unaffected.** Server-sent per member (sender, muted communities and members who disabled chat push excluded). The app-icon badge is a server count. |
| Typing indicators | None — typing rides the chat room socket. |
| Content-tab dots | `useCommunityTabDots` reads a `/content-latest` baseline every 60 s while a community chat screen is open. |

## Cadences and timing knobs

| Thing | Value | Where |
|---|---|---|
| Socket heartbeat | `ping` every 25 s per socket | `realtimeCore.ts` |
| Heartbeat timeout | no `pong` within 6 s → recycle + reconnect now | `realtimeCore.ts` |
| Reconnect backoff | 1 s base, ×2, capped at 15 s | `realtimeCore.ts` |
| Foreground probe | returning to foreground probes every socket immediately | `realtimeCore.ts`, AppState listeners |
| List catch-up | debounced 1000 ms, single-flight | `useCommunities` (`listCatchUp`) |
| Chat catch-up | debounced 300 ms, single-flight (`?after=`) | `useChatMessages` |
| Chat bootstrap cache | 15 min fresh (`COMMUNITY_BOOTSTRAP_STALE_MS`) | `communityBootstrap.ts` |
| Mobile list beat | 60 s while focused, foreground only, and > 10 rows (`HIBERNATED_LIST_REFRESH_MS`) + immediate catch-up on returns ≥ 5 s | communities screen |
| Web sidebar poll | 60 s while > 15 communities (`SIDEBAR_STALE_MS`) | `useSidebarCommunities` |
| Web hidden-tab return | ≥ 5 s hidden → forced refetch (`useHiddenCatchUp`); subscriptions are torn down while hidden (`useDocumentVisible`) | `apps/web/lib` |

## Wake-up triggers

### Mobile, list rows (`useCommunities` + the communities screen)

1. **Screen focus** — arriving at the Communities tab (or popping back from a
   chat) after ≥ 5 s away schedules an immediate catch-up; shorter hops are
   skipped because the rows are only seconds old.
2. **Slow beat** — while the list is focused, over the cap, and the app is
   foregrounded: one catch-up per 60 s.
3. **Foreground** — AppState `active` reconciles (1 s debounce).
4. **Reconnect** — any live socket re-opening (network switch, heartbeat
   recycle, foreground probe) reconciles (1 s debounce).
5. **Pull-to-refresh**.
6. **Mount / membership churn** — cold start, join/create/leave/archive
   (`communityStore` events).

### Web, sidebar (`useSidebarCommunities`)

1. **Poll** — every 60 s while the sidebar holds more than 15 communities.
2. **Hidden-tab return** — after ≥ 5 s hidden, a forced refetch; hook
   subscriptions are torn down while the tab is hidden (`useDocumentVisible`)
   and every socket is probed on focus/visibility/online/pageshow
   (`lib/realtime/client.ts`).
3. Mount and join/leave/archive events, same as mobile.

A hibernated community that receives a message **enters the window at the next
reconcile**: the reconcile bubbles it to the top, the window recomputes, and it
opens a socket. Only the first message (and anything sent before the next
reconcile) waits; everything after that is realtime.

## Timelines

Message to a **live** community, any platform: instant on list and chat (socket
fan-out).

Message to a **hibernated** community:

| Surface | When it updates |
|---|---|
| Push | Immediately (unless muted / opted out; sender excluded). |
| Mobile list row | On the next trigger above — ≤ 60 s while the member stares at the list, ~1–2 s after a return ≥ 5 s / foreground / reconnect; then bubbles to top and opens a socket. |
| Web sidebar row | ≤ 60 s (poll), ~immediately after a hidden-tab return. |
| Chat | Instantly on open — patched bootstrap window + `?after=` catch-up, whenever it is opened. |
| App badge | Server-driven (push / read state), not socket-driven. |

## Why the budget exists

Before the window, `useCommunities` opened one socket per membership: a member
of 30 communities carried ~30 sockets — 30 heartbeats every 25 s, 30 reconnect
attempts on every network change, 30 Durable Object connections, presence work,
and OS-reclaimable memory. The window caps that at 10 (`lib/realtimeWindow.ts`:
"Ten sockets is ~one heartbeat frame every 2.5 s and at most ten reconnect
attempts per network change"). Web keeps 15 because desktop resources are
cheaper than a phone radio.

The cost is not only the phone: each socket is a DO connection with latency
billing, plus presence bookkeeping. The infra audit measured ~5 concurrent
sockets per peak user with the current caps and lists "lowering the cap or
multiplexing those community rooms onto fewer sockets" as the remaining win —
multiplexing is blocked by the DO model described above, so any change there
is a server change.

## Code map

| Concern | Mobile | Web |
|---|---|---|
| Window policy | `lib/realtimeWindow.ts` (+ `.test.ts`) | `useSidebarRealtime.ts` (`SIDEBAR_REALTIME_LIMIT`) |
| List sockets + reconcile | `hooks/useCommunities.ts` | `useSidebarCommunities.ts` + `useSidebarRealtime.ts` |
| Focus/arrival beat + poll | `app/(tabs)/communities.tsx` | `useSidebarCommunities.ts` (poll), `use-hidden-catchup.ts` |
| Socket lifecycle | `lib/realtimeCore.ts` (`realtimeScale.test.ts`) | `lib/realtime/client.ts` |
| Chat catch-up | `hooks/useChatMessages.ts`, `lib/realtimeCatchUp.ts` | chat room hooks + mount catch-up |
| Ordering | `lib/sidebarOrder.ts` | `sidebar-order.ts` |

## Out of scope / possible follow-ups

- **Push-driven row patches**: a foreground push could move a hibernated row
  instantly instead of waiting for the beat. Not implemented — it would
  duplicate the realtime patch logic and must be careful not to double-count
  with a socket that is also live.
- **Raising the caps**: costs sockets linearly; the budget is deliberate.
- **Multiplexing** communities onto fewer sockets: needs the server model
  above to change first.
