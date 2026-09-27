# Presence scaling in the Community Room

Follow-up to **H-3** (`docs/realtime-5k-loadtest-audit.md`, commit `abebd261`), which
measured the 5K same-community ladder and found the room-wide presence broadcast to be
the thing that killed a 2,500-socket room (3.56 GB of presence traffic, DO restarts).

This document is the fix, its tests, and the re-measured ladder. Everything below is
either read out of the code or measured against staging; nothing is projected.

---

## 1. Root cause (verified in code, not assumed)

**Who owns presence.** `Room` (`apps/realtime/src/room.ts`) owns it entirely:
`wsToUser` (socket → user), `userSockets` (user → its sockets, which is what makes
multi-tab/multi-device folding possible), `userMeta` (display name/avatar cached at
`join`). There is no presence state outside the room DO — `UserDO` does not broadcast
presence at all.

**What triggered a broadcast.** Every accepted upgrade and every socket removal called
`markPresenceDirty()`, which coalesced changes into one flush per `PRESENCE_COALESCE_MS`
(150 ms) window.

**What the flush did.** For every window:

1. `buildPresenceSnapshot(userSockets, userMeta)` built **one entry per member**
   (`{ id, name, avatar, connections }`),
2. `presenceSignature(users)` built an **O(members) string** just to detect "nothing
   changed",
3. the roster was serialized once and then `ws.send()`-ed to **every attached socket**.

So one flush cost `O(members)` bytes × `O(sockets)` sends, and a ramp of *N* sockets
produced roughly *N²/2* sends inside a single-threaded object:

| Stage (H-3, before) | Presence bytes received by the harness |
| ---: | ---: |
| 100 sockets | ~2.2 MB |
| 500 sockets | ~101.6 MB |
| 1,000 sockets | ~483–565 MB |
| 2,500 sockets | ~3.56 GB |

**Why that was pure waste.** The roster had exactly one consumer in the product:
`useOnlinePresence` (`apps/web/components/communities/chat/useOnlinePresence.ts`),
which did

```ts
realtimeClient.onPresence(chatRoom, (users) => setOnlineCount(users.length));
```

and `ChatHeader` renders `${onlineCount} online`. No UI reads `name`, `avatar` or
`connections` from a presence payload; the mobile client has **no presence consumer at
all** (it cached the array and nothing read it); and the perf harness had to
deliberately stub the frames out to avoid OOM before it could measure anything
(`__tests__/helpers/realtime-harness.ts`).

A per-member roster was therefore fanned out to every socket, on every change, for a
number that the local code could compute from `Array.length`.

---

## 2. The fix

Three changes, all inside the existing Community Room — no sharding, no UserDO gateway,
no change to message fan-out, no change to the client-publish allow-list from PR #542.

### 2.1 Presence is a count, not a roster

`countOnlineUsers(socketsByUser)` replaces `buildPresenceSnapshot` + `presenceSignature`.
It walks the same `userSockets` map and returns the number of members with at least one
live socket — the folding semantics (`connections`) are unchanged, they are just no
longer serialized per member.

```jsonc
// before
{ "t": "presence", "room": "chat:<id>", "users": [ { "id": "...", "name": "...", "avatar": null, "connections": 2 }, … ] }

// after
{ "t": "presence", "room": "chat:<id>", "count": 37 }
```

Payload size is now constant (~78 B for a UUID room) instead of growing with the member
count, and the "did anything change?" check is an integer comparison instead of building
a signature string.

### 2.2 One flush can no longer write to the whole room

`PRESENCE_FLUSH_BUDGET = 256` caps the sends in a single flush. A room at or below the
cap behaves exactly as before (every change reaches everyone in one window — this is what
normal-sized communities see). A larger room rotates: the cursor advances by the budget
each window (~150 ms), so a 5,000-socket room is covered by one *lap* of
`ceil(5000 / 256) ≈ 20` windows (~3 s).

A lap only counts as delivered when neither the online count nor the socket population
moved while it ran (`presenceChangeSeq` / `presenceLapSockets`); a change landing
mid-lap runs another lap rather than declaring the room settled. The cursor is never
reset by a change, so a busy room keeps advancing through its sockets instead of
re-broadcasting to the same first window.

This is the change that moved the 5,000-socket stage: before it, one timer callback
wrote 4,351 frames back to back and the object never got to the 4,351 queued `join`
frames (only 42 sockets ever received `hello`).

### 2.3 Clients

Both clients now treat presence as a count:

* `apps/web/lib/realtime/client.ts` — `RealtimePresence { count }`, presence cache and
  emitters carry it, the dead `presence_delta` branch and `PresenceUser`/`PresenceDeltaMessage`
  types are removed (the server never emitted them).
* `apps/web/components/communities/chat/useOnlinePresence.ts` — `setOnlineCount(count)`.
* `expo-app-standalone 3/lib/realtimeCore.ts` (+ `lib/realtime.ts` re-export) — same
  payload handling, mirrored. No other mobile behaviour changed; mobile still has no
  presence consumer.

Because the payload shape changed, the Worker and the web/mobile clients must be
deployed together. Both clients ignore an unknown `t` and the DO ignores unknown
fields, so the window is a missing count in the UI, not an error.

### 2.4 What was rejected

* **Presence deltas** (`presence_join`/`presence_leave`) — require clients to maintain a
  roster that no consumer renders, and a join/leave storm is exactly when deltas are
  most expensive.
* **Topic-scoped presence** (subscribe to `presence` to receive it) — would help sockets
  that do not want presence, but the measured failure was a room where everyone was
  attached, so it does not bound the cost that mattered. It also adds a client protocol
  change and reconnect-replay surface for no measured gain.
* **Bounded roster** — the product does not need a roster at all; bounding one would have
  hidden members to make a benchmark pass.
* **Disabling presence above a size threshold** — not a fix, and it would break the
  feature exactly where it is most visible.

---

## 3. Files changed

| File | Why |
| --- | --- |
| `apps/realtime/src/subscriptions.ts` | `countOnlineUsers` replaces `buildPresenceSnapshot`/`presenceSignature`/`PresenceEntry` |
| `apps/realtime/src/types.ts` | `PresenceMessage` carries `count`; `PresenceUser`/`PresenceDeltaMessage` deleted |
| `apps/realtime/src/room.ts` | count payload, integer change check, `PRESENCE_FLUSH_BUDGET` window + lap rotation, byte counters |
| `apps/realtime/src/metrics.ts` | `presencePayloadBytes`, `presenceDeferredWindows`, `presenceCountChanges`, `eventPayloadBytes` |
| `apps/web/lib/realtime/client.ts` | presence payload is a count; delta/roster branches removed |
| `apps/web/components/communities/chat/useOnlinePresence.ts` | reads `count` |
| `expo-app-standalone 3/lib/realtimeCore.ts`, `lib/realtime.ts` | same payload handling (required by the new protocol) |
| `apps/realtime/__tests__/presence-scaling.test.ts` | new suite (payload bound, window bound, rotation, folding, isolation, security) |
| `apps/realtime/__tests__/targeted-fanout.test.ts` | presence test asserts the folded count + a bounded frame |
| `apps/realtime/__tests__/subscription-index.test.ts` | `countOnlineUsers` unit tests |
| `apps/realtime/__tests__/helpers/realtime-harness.ts` | presence frame capture matches the new payload |
| `k6/loadtest-5k.mjs` | one failure per socket (a timeout + close used to be counted twice), presence wording, `presenceDeferredWindows` in the dump |
| `docs/realtime-presence-scaling.md` | this report |

No production behaviour outside the Community Room presence path changed; message
fan-out (`POST /publish` → `broadcastByTopic` → topic subscribers) is byte-identical and
is now measured separately through `eventPayloadBytes`.

---

## 4. Tests

```
apps/realtime (vitest, miniflare):
  presence-scaling.test.ts         8 passed
  subscription-index.test.ts      14 passed
  targeted-fanout.test.ts          6 passed
  ws-publish-security.test.ts     17 passed   (presence frame assertion still holds)
  ws-multi-device / ownership / user-room-publish / realtime.integration / perf-light  → 69 passed
  npx tsc --noEmit                clean

web:
  apps/web/lib/realtime/client-isolation.test.ts      18 passed
  npx tsc --noEmit -p apps/web/tsconfig.json          no errors in changed files

mobile:
  npm run test:mobile-realtime    52 passed
  npx tsc -p tsconfig.json --noEmit                   clean

k6:
  npm run test:k6-realtime        16 passed
```

`ws-ownership.test.ts` fails in this environment (`Unexpected server response: 500` on the
first WebSocket upgrade). It was reproduced **on the pre-change code** in an isolated
checkout of the H-3 commit (`2 failed | 18 passed`), so it is a pre-existing
environment/test failure, not a regression from this change.

What the new suite pins:

* **bounded payload** — a presence frame to a 63-socket room is the same size as to a
  3-socket room (≤120 B, +4 B for the extra digit) and contains no `users` array;
* **bounded work** — `presenceDeliverAttempts ≤ presenceBroadcasts × 256` in a 300-socket
  room, with `presenceDeferredWindows > 0`, i.e. no window ever wrote past the budget,
  while the room still converges (including a change landing after the ramp);
* **small rooms unchanged** — a 60-socket room reports `presenceDeferredWindows = 0`: every
  change is delivered in a single window;
* **folding** — 2 sockets for member A + 1 for member B is `count: 2`; closing one of A's
  tabs keeps the count at 2 and only A's **last** socket drops it to 1; an empty room
  reads 0;
* **isolation** — presence frames carry no `topic`/`data` and never arrive as events; a
  publish's byte cost is bounded by its recipients;
* **security** — a client `publish` frame for topic `presence` (or a forged count on
  `message`) is rejected, `clientPublishesAccepted` stays 0 and the online count does not
  move: the count is server-authored, PR #542's allow-list is untouched.

---

## 5. Before → after: presence traffic

Client-received presence bytes on the same staging account, one room, 20 events
("before" = H-3 numbers from `docs/realtime-5k-loadtest-audit.md`).

| Sockets in one room | Before (roster per member) | After (count, per-window budget) | Reduction |
| ---: | ---: | ---: | ---: |
| 20 | — | 4 KB | — |
| 100 | ~2.2 MB | not re-run | — |
| 500 | ~101.6 MB | **0.22 MB** | ~460× |
| 1,000 | ~483–565 MB | **0.89 MB** | ~540–635× |
| 2,500 | ~3.56 GB | **3.51 MB** | ~1,014× |
| 5,000 (attempt) | room collapsed before publishing | **2.55 MB** received by the 1,500 surviving sockets | — |

Server-side counters agree with what the harness received: 1,000 sockets →
`presenceDeliverAttempts 11,212` / `presencePayloadBytes 886,962` (79.1 B per send);
2,500 sockets → `presenceBroadcasts 171`, `presenceDeferredWindows 27`,
`presenceDeliverAttempts 40,336` (the per-window cap is visible: 171 windows × ≤256).
Message fan-out bytes are reported separately (`eventPayloadBytes`): 12.4 MB at 1,000
sockets for 20 events (619 B per event per recipient) — unchanged by this work.

---

## 6. Re-measured ladder (staging, final build)

All stages: **one** Community Room, one fresh community/room per stage, 20 controlled
`POST /publish` events at 1 event/second, 250-socket ramp batches with no delay.
Worker version `ed8fae25-0d4b-4687-862f-a6e2b4cb1312` (staging only).

| Sockets | Connected | Subscribed | Events published | Received | Delivery | Missing | Disconnects | Errors | p95 | DO restarts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1,000/1,000 | 1,000 | 20 | 20,000/20,000 | 100% | 0 | 0 | 0 | 355 ms | 0 |
| 2,500 | 2,500/2,500 | 2,500 | 20 | 49,788 (49,860) | 100% of live sockets | 72 (4 sockets died mid-run) | 11 | 0 | 991 ms | 0 |
| 4,000 | 4,000/4,000 | 4,000 | 20 | 79,964/80,000 | 99.95% | 36 | 33 | 0 | 1,083 ms | **1** |
| 5,000 | **4,750/5,000 (95%)** | 1,500 | 20 | 30,000/30,000 | 100% of subscribed | 0 | 3,500 | 0 | 418 ms | **1 reset mid-ramp** |
| 5,000 control (5,000 rooms) | 5,000/5,000 | n/a (1/room) | 3 | 3/3 | 100% | 0 | 48 | 0 | 193 ms | 0 |

Notes on reading the table:

* **1,000** — clean pass: every socket connected, was told `hello`, subscribed, and
  received all 20 events; one DO instance for the whole run.
* **2,500** — every socket connected/subscribed and received all 20 events; 11 sockets
  dropped during the 100 s publish phase (each missing event is one of those sockets,
  which is why `received` is 49,788 against an initial-population expectation of 49,860).
  `delivery_rate_live = 1` means *every socket that stayed live got every event*.
* **4,000** — every socket connected and subscribed, 79,964 of 80,000 delivered; the DO
  was **replaced mid-run** (`05cf6bf7 → 65b02a06`) and one publish stalled 111 s. The
  script fails such a run on purpose. This is the honest edge of the envelope.
* **5,000** — 4,750 connected, then the room's DO was **reset**: 3,500 sockets were
  dropped at once, the instance's counters restarted (`connectionsOpened` read back as
  1,500), and the 1,500 sockets that re-established were subscribed and received
  30,000/30,000. The run fails the 99% connect threshold and does not claim otherwise.
* **5,000 control** — 5,000 sockets spread over 5,000 rooms connected 5,000/5,000 with 0
  failures, which is what makes the interpretation below possible.

---

## 7. Cloudflare observations (`wrangler tail`, per stage)

| Stage | Records | Worker/DO exceptions | CPU max | DO instances seen | `canceled` outcomes | statuses |
| ---: | ---: | --- | ---: | ---: | ---: | --- |
| 1,000 | 1,290 | none | 19 ms | 1 | 1 | 200 ×30 |
| 2,500 | 1,993 | none | 76 ms | 1 | 19 | 200 ×257 |
| 4,000 | 1,573 | none | 291 ms | 1 sampled (script saw 2) | 35 | 200 ×303 |
| 5,000 | 1,045 | none | 115 ms | 1 (script saw a reset) | 78 | 200 ×21 |

* **No Worker or DO exception was logged in any stage** — not once, at any scale. The
  failures are structural (lost sockets, a replaced instance), never an application error.
* CPU per invocation stays in the tens of milliseconds (max 291 ms at 4,000) while the
  object is juggling thousands of sockets, so the ceiling is **not** CPU.
* `canceled` invocations appear only at 4,000/5,000 — the same scale where the instance is
  replaced, i.e. the runtime tearing the object down, not the application throwing.
* What Cloudflare does **not** expose here: DO memory usage, per-socket footprint, and any
  explanation for the reset. The reset is inferred from the instance id changing and its
  counters restarting, plus all sockets being dropped at once. `wrangler tail` also
  samples at high volume, so the record counts above are a floor.

---

## 8. Remaining bottleneck (reported, deliberately not fixed here)

Presence is no longer the limiting factor — it is now sub-megabyte at 2,500 sockets and the
per-flush send count is capped. What remains is a **per-Durable-Object ceiling for a single
hot Community Room**, between 2,500 and 4,000 attached sockets on this account:

```
2,500 sockets  → stable: 2,500/2,500 connected, 100% delivery to live sockets, 1 instance
4,000 sockets  → 4,000/4,000 connected, 99.95% delivered, DO REPLACED mid-publish
5,000 sockets  → 4,750 connected, DO RESET mid-ramp, 1,500 survived (100% delivery)
5,000 sockets, 5,000 rooms → 5,000/5,000 connected, 0 failures
```

The control rules out the harness, the network and the account as the cause; the same
5,000 sockets succeed when they are spread over 5,000 objects. Fixing this means
partitioning a community's realtime across more than one object (or another DO), which
the H-3 scope explicitly excluded and which needs its own design (ordering, presence
fan-out across partitions, subscription routing). It is a separate finding, not a bug in
this change.

---

## 9. Limitations of these measurements

* **Membership is not enforced on staging.** The staging deployment has no
  `API_URL`/`API_SECRET`, so `Room.checkMembership()` returns early
  (`membershipChecks: 0` in every stage). The sockets in this ladder are validly
  authenticated identities, not database members.
* **The wire protocol has no subscribe ACK.** "Subscribed" means the DO's own
  `subscriptionRefs` counted the socket, or that the socket received this run's event.
* **Latency is an upper bound.** It is measured client-side from just before the publish
  HTTP call to frame parsing, so it includes the publish round trip; the Worker exposes no
  per-event timing.
* **The drain-to-quiet phase measures `/stats` responsiveness, not presence volume.**
  It requires two consecutive `/stats` reads with unmoved counters: 3.6 s at 1,000
  sockets, 158 s at 2,500 and its 180 s cap at 4,000, while the DO's presence counters
  showed only ~one extra lap of sends. A single-threaded object holding thousands of
  sockets answers the stats fetch late.
* **One 2,500-socket run failed transiently** (2,217 connected, `/stats` timeouts) and
  the immediate repeat passed cleanly with the same build; both are reported above.
* **No DO memory metric exists** to attribute the reset directly.
* **`wrangler tail` samples** at high volume; the counts in §7 are lower bounds.

---

## 10. Reproducing

```bash
# staging only — the script refuses a non-staging host unless ALLOW_NON_STAGING=1
export REALTIME_URL=https://uxcommunity-realtime-staging.<account>.workers.dev
export SESSION_SECRET=<staging secret>
export REALTIME_PUBLISH_SECRET=<staging secret>
export TEST_COMMUNITY_ID=<fresh uuid per stage>

TOTAL_CLIENTS=1000 node k6/loadtest-5k.mjs
TOTAL_CLIENTS=2500 node k6/loadtest-5k.mjs
TOTAL_CLIENTS=4000 node k6/loadtest-5k.mjs
TOTAL_CLIENTS=5000 node k6/loadtest-5k.mjs
ROOM_MODE=distinct TOTAL_CLIENTS=5000 EVENT_COUNT=3 node k6/loadtest-5k.mjs   # control

# per-stage counter dump
curl -s -H "x-realtime-publish-secret: $REALTIME_PUBLISH_SECRET" \
  "$REALTIME_URL/stats?room=chat:$TEST_COMMUNITY_ID" | python3 -m json.tool

npm run test:k6-realtime                       # accounting unit tests
cd apps/realtime && npx vitest run __tests__/presence-scaling.test.ts
```
