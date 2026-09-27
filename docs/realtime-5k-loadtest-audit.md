# H-3 — 5K same-community realtime load test

> **Verdict up front:** the load test is now correct and it is *not* faked — but
> **5,000 users in one Community Room did not work** on the staging deployment.
> The largest verified same-room scale is **1,000 users in a single run**, and the
> largest **reproducible** scale is **500 users**. The blocker is a separate
> production bottleneck in the room-wide presence broadcast, reported at the end
> of this document and deliberately left unfixed (out of H-3 scope).

## 1. What was wrong with the old test

`k6/loadtest-5k.mjs` (previous revision) opened every client against
`user:${id}` and then sent:

```js
{ t: "subscribe", room: `chat:${COMMUNITY_ID}`, topic: "chat" }
```

`Room.webSocketMessage` resolves a subscription from the **connection's** room and
ignores the `room` field of a subscribe frame
(`this.handleWsSubscribe(ws, msg.topic)` — see `apps/realtime/src/room.ts`). So:

| Old test did | Actual effect |
|---|---|
| connect to `user:${id}` | 5,000 sockets spread across 5,000 **UserDO** instances, one per user |
| `subscribe room: chat:<id>` | the frame's `room` was ignored → every socket subscribed inside its own user room |
| publish `chat:<id>` topic `chat` | published to a room with no sockets, on a topic no client subscribes to (the community chat topic is `message`) |
| count `{t:"event"}` frames | counted any event, per socket, with no per-event identity → “5,000 connected” looked identical to “5,000 received event X” |
| default `wss://rt.uxcommunity.in` | pointed at **production** |

Net effect: every number it printed could be true while **zero** community fan-out
happened. It was measuring 5,000 user-room sockets sitting idle.

`k6/staging-loadtest-5k.mjs` had the right *direction* (connect straight to
`chat:<id>`) but the same `topic: "chat"` error, the same per-socket
"any event counts" accounting, no server-side verification of subscriptions, and
a hardcoded stale Worker URL plus a report that referenced a branch/commit from a
different era. It was **replaced** (deleted) rather than kept as a second,
diverging copy.

## 2. The realtime path the fixed test exercises

Verified from source, not assumed:

| # | Question | Answer (source) |
|---|---|---|
| 1 | How a client connects to a community room | WebSocket upgrade to `/ws?room=chat:<communityId>` → `COMMUNITY_DO` → `Room` (`apps/realtime/src/index.ts` → `resolveRoomTarget` → `stub.fetch`) |
| 2 | Exact WebSocket URL | `wss://<target>/ws?room=<encodeURIComponent(room)>&token=<jwt>` |
| 3 | Authentication | HS256 session JWT (`{userId}` payload) in `?token=`, or the `uxcommunity_session` cookie; verified with `env.SESSION_SECRET`; failure → HTTP 401 before any DO is touched |
| 4 | Room identifier | `chat:${communityId}` (`lib/realtime/rooms.ts` → `realtimeRooms.chat`) |
| 5 | Subscribe frame | `{ t: "subscribe", room: "chat:<id>", topic: "message" }` (the `room` field is ignored server-side) |
| 6 | Community message topic | **`message`** (`useRealtimeChat.ts` / `useSidebarRealtime.ts` subscribe; `publishChatEvent({ topic: "message" })` publishes) |
| 7 | Legitimate server-side publish | `POST /publish` with `x-realtime-publish-secret`, body `{room, topic, data, exclude_user?}` — the exact call `apps/web/lib/realtime/publish.ts` makes after a message insert; the Worker fans out with `ctx.waitUntil` + a bounded pool |
| 8 | Membership required? | Yes, at **upgrade** time: `Room.checkMembership()` calls `GET ${API_URL}/api/communities/:id/members/:userId/check` (fail-closed) — **unless the deployment has no `API_URL`**, in which case it returns `true` immediately |
| 9 | How the server confirms a subscription | **It does not.** There is no subscribe ACK. The only confirmations are (a) `GET /stats` on the room → `sockets` / `subscriptionRefs` / `topics`, and (b) actually receiving an event |
| 10 | Delivery | `Room.broadcastByTopic()` → `{t:"event", room, topic, data, sender}` to each socket in the topic index; heartbeat `ping` is answered `pong` by the runtime without waking the DO |

Client `publish` frames were **not** used anywhere in this test, so the PR #542
topic allow-list (`typing` only) is untouched.

## 3. Implementation

| File | Change | Why |
|---|---|---|
| `k6/loadtest-5k.mjs` | rewritten | connect every client to `chat:${TEST_COMMUNITY_ID}`, subscribe to `message`, publish only through `POST /publish`, exact per-event delivery accounting, server-side cross-check via `/stats`, staging guard, PASS/FAIL verdict + JSON summary |
| `k6/lib/realtime-fanout.mjs` | new | pure helpers: fixed-size delivery bitmap (exact received/missing/duplicate per event), latency stats/buckets, deterministic distinct UUID identities, event-id parsing, staging-target guard |
| `k6/lib/realtime-fanout.test.mjs` | new | unit tests for that accounting (`npm run test:k6-realtime`) |
| `k6/staging-loadtest-5k.mjs` | **deleted** | 900-line near-duplicate with the wrong topic and no verification; keeping it would guarantee the two copies diverge again |
| `k6/staging-smoke-test.mjs` | fixed | subscribed/published to topic `chat` (the room prefix, not a topic) and claimed delivery was `ctx.getWebSockets()`; now uses `message`, waits for `/stats` to confirm the subscription, and reports the DO's counters |
| `k6/README.md` | updated | documents the corrected script, the ladder, what it does/does not prove, and the control mode |
| `package.json` | +1 script | `test:k6-realtime` (mirrors the existing `test:k6-fixtures` convention) |
| `apps/realtime/**` | **untouched** | no production code, no DO behaviour, no WebSocket security change |

The test prints the target room in the banner, in the pre-flight, and in the final
report, and proves the room set is 1 (`h3_target_rooms`) — the failure mode of the
old script cannot recur silently.

### Per-event accounting (why the numbers are trustworthy)

Each published event carries `data.id = "<testId>#<seq>"`. Every socket keeps a
`Uint8Array(EVENT_COUNT)` row (20 bytes/socket at 20 events), so received,
missing and duplicate counts are **exact and memory-bounded** — no sampling, no
"an event arrived so the socket must have received it". Every event also carries
a test-only `h3` annotation the DO passes through opaquely (it never inspects
`data`), so a receiver can attribute a frame to this run; frames from another room
or topic are counted separately and fail the run.

Two independent checks per event:

1. client-side exact bitmap (`delivered / expected / missing / duplicates`), and
2. the Durable Object's own `deliverAttempts` delta for that event, read from
   `GET /stats` immediately before and after it.

## 4. Test configuration

```text
Environment:        staging Cloudflare Worker `uxcommunity-realtime-staging`
                    https://uxcommunity-realtime-staging.patilsachin1228.workers.dev
                    version 6cd294b2-3c5a-4136-a766-0b613189c690, deployed from main fc90116b
                    (the deployment had been stale since 2026-09-01 and predated /stats;
                     it was redeployed from current main before these runs)
Target community:   one fresh community per stage, a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b*  (see the table)
Target room:        chat:<community id> — every socket of a stage in the SAME room (verified: 1 room)
Users:              20 / 100 / 500 / 1,000 / 1,500 / 2,500 / 5,000 per stage
Community members:  membership was NOT enforced on this deployment (see Limitations);
                    sockets are not database rows
Event type:         topic `message`, payload shaped like publishChatEvent() for a
                    community_messages insert, plus a test-only `h3` annotation
Events published:   20 (smoke 5) at 1 event/second — never a burst
Publish rate:       1 event/s, so a 5,000-socket stage would have been 5,000 sends/event
Test duration:      26s (smoke) … 49-79s (500/1,000) … 206s (5,000 attempt)
```

### How the 5,000 identities were created

Every client gets its **own** deterministic v4-shaped UUID and its **own** JWT
signed with the staging `SESSION_SECRET` (identity uniqueness is asserted before
any socket opens; no token is reused). This is the same mechanism the existing
staging harnesses use (`apps/realtime/__tests__/staging-*.mjs`).

`k6/scripts/seed-users.js` (`npm run k6:seed`) is the repository's real
user+membership seeder, but it needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
for the target project. The only project credentials reachable from this checkout
are production's, and creating 5,000 users + memberships there would violate
“staging only” — so it was **not** used. On a dedicated staging project it should
be used, and this is the one place where the H-3 setup is thinner than production:

* the staging realtime Worker has **no `API_URL`/`API_SECRET`** (`wrangler secret
  list` shows only `REALTIME_PUBLISH_SECRET` and `SESSION_SECRET`, and the DO's
  `/stats` reports `membershipChecks: 0`), so `Room.checkMembership()` returns
  `true` immediately — the **membership gate was not exercised**,
* consequently the test users are not members of anything; they are validly
  authenticated identities that reach the room (nothing was bypassed in the test).

## 5. Results

Only measured values are shown. `Subscribed` is the DO's own
`subscriptionRefs` for the target room (server-side), never an assumed count.
`Errors` = connection failures + unexpected disconnects.

| Users | Ramp | Connected | Subscribed (DO) | Events published | Events received | Delivery % | Errors | p95 | Verdict |
| ----: | ---: | --------: | --------------: | ---------------: | --------------: | ---------: | -----: | --: | ------- |
| 20 (smoke) | 100/50ms | 20/20 | 20 | 5 | 100/100 | 100% | 0 | 204ms | PASS |
| 100 | 100/50ms | 100/100 | 100 | 20 | 2,000/2,000 | 100% | 0 | 312ms | PASS |
| 500 | 100/50ms | 500/500 | 500 | 20 | 10,000/10,000 | 100% | 0 | 268ms | PASS |
| 1,000 (run A) | 250/0ms | 1,000/1,000 | 1,000 | 10 | 10,000/10,000 | 100% | 0 | 412ms | PASS |
| 1,000 (run B, repeat) | 250/0ms | 1,000/1,000 | 1,000 | 18/20 | 17,882/20,000 | 89.41% | 56 disconnects, **DO restarted 6×** | 6,516ms | FAIL |
| 1,000 (slow ramp) | 100/50ms | 897/1,000 | 0 (all sockets lost) | 20 | 0 | n/a | 206 connect failures, 1,000 sockets closed 1006 | n/a | FAIL |
| 1,500 | 250/0ms | 1,394/1,500 | 1,343 of 1,394 live | 0 (aborted) | 0 | n/a | 212 connect failures, hellos stalled (13/1,394) | n/a | FAIL |
| 2,500 | 250/0ms | 2,244/2,500 | 497 of 497 live | 10 | 4,970/4,970 *among survivors* | 100% of survivors | 494 connect failures, 2,003 sockets dropped | 1,100ms | FAIL |
| 5,000 | 250/0ms | 2,558/5,000 | 399 | 0 (aborted) | 0 | n/a | 4,753 connect failures, room collapsed to 399 sockets | n/a | FAIL |
| 1,000 control (`ROOM_MODE=distinct`) | 100/50ms | 1,000/1,000 | 1 (in the target room) | 5 | 5/5 | 100% | 0 | 220ms | PASS |

Per-event detail (exact, not sampled) for the passing stages — every event
delivered to every expected socket, with the DO's own send counter agreeing:

```text
500 users, 20 events:  delivered=500/500 each, missing=0, dups=0,
                       serverDeliverΔ=500 per event, p50≈231ms p99=288ms
1,000 users (run A, 10 events): delivered=1000/1000 each, missing=0, dups=0,
                       serverDeliverΔ=1000 per event, p50≈257ms p99=438ms,
                       one DO instance, sockets after cleanup=0
```

### The control experiment that makes the interpretation possible

`ROOM_MODE=distinct` gives every client its **own** room while keeping everything
else identical (same machine, same account, same JWT path, same 1,000 sockets):

```text
1,000 distinct rooms: 1000/1000 connected, 0 failures, hello 1000/1000,
                      0 unexpected disconnects, 5/5 deliveries in the target room
```

So the failures at 1,000–5,000 sockets are **specific to putting that many sockets
in ONE room**, not a limitation of the harness, the machine or the account.

## 6. Cloudflare observations

Collected with `wrangler tail --config apps/realtime/wrangler.staging.toml
--format json` during every stage, plus the DO's own `GET /stats` counters.
`wrangler tail` is sampled and reports per-invocation numbers only — it does not
expose DO memory — so memory pressure below is **inferred** from the object
restarts, not measured.

| Observation | Result |
|---|---|
| Worker exceptions | **0** in every stage and every attempt (99–834 tail events per stage) |
| DO errors / `console.error` | **0** (no `[realtime] publish fan-out failed`, no logged exceptions) |
| DO CPU per invocation | max **30ms**, sums of 20–80ms per tail window — the failures are **not** CPU-bound |
| Invocation outcomes | `ok` dominant; saturating runs add `canceled` (14 @2,500, 17 @5,000) and `responseStreamDisconnected` (1–3) |
| Wall time per invocation | max 422ms (1,000-user run), 306–308ms in the collapsing attempts |
| DO `sendFailures` | **0** even in the collapse runs — sockets died at the edge/transport, not via a failed `ws.send()` |
| DO instances | exactly **1** in every passing stage; **6** in the failing 1,000-user repeat; the collapsing runs left a migrated instance holding ~399 sockets |
| Hibernation/migration | visible as instance-id changes plus `connectionsOpened: 0` on the new instance while `sockets > 0` (attachments restored) — i.e. the object was restarted/migrated under load |
| `/stats` responsiveness | became unresponsive (>10s timeout) during the 1,000-socket slow-ramp storm — the object was not accepting requests |
| Presence broadcast cost | measured by the harness as received frames: 2.2MB @100, 101.6MB @500, 482.9–564.6MB @1,000, **3,556MB @2,500** |
| Message fan-out cost | ~0.6KB per recipient per event — four orders of magnitude smaller than a single presence snapshot |
| Observed limits | the room stopped accepting/keeping sockets between 1,000 and 1,500; 4,753 of 5,000 upgrades failed at 5,000 and the surviving population collapsed to 399 |

## 7. Bottleneck found (reported separately, NOT fixed)

**The room-wide presence broadcast does not scale with room population.**

`Room` marks presence dirty on every accepted socket and flushes a **full roster
snapshot to every socket in the room** per ~150ms coalescing window
(`markPresenceDirty` → `flushPresence()` → `ctx.getWebSockets()`), and the
snapshot grows linearly with the room:

```text
snapshot size ≈ 57-63KB at 1,000 members (measured: 564.6MB / 8,981 frames)
per flush     ≈ N × snapshot         (1,000 sockets ≈ 57MB of queued writes)
ramp to 1,000 ≈ 10 flushes           (measured 482.9-564.6MB received)
ramp to 2,500 ≈ 3,556MB received     (2,003 of 2,244 sockets dropped)
```

Message fan-out itself is cheap and stays exact when the room is stable — the
stage that failed at 1,000 users delivered 17,882/20,000 with **0 duplicates** and
`serverDeliverΔ` matching receipts until the object restarted. So the failure mode
is: presence traffic saturates the object → the runtime restarts/migrates it →
sockets are terminated (1006) → subscription state is lost mid-run.

Candidate directions (deliberately **not** implemented here — H-3 is a test-correctness
change and #537/#542 are merged): presence only for sockets that subscribed to a
presence/roster topic, delta (`presence_delta`) instead of full snapshots, a
bounded roster size, and/or a slower presence cadence that scales with N.

## 8. Limitations of this measurement

1. **No subscribe ACK exists.** “Subscribed” is `subscriptionRefs` from the DO plus
   proof of delivery; nothing in the protocol confirms a subscription directly.
2. **Membership was not enforced** on this realtime-only staging deployment
   (`API_URL` unset). The gate exists in code and is fail-closed in production, but
   this run does not prove it.
3. **Latency is an upper bound.** It is measured client-side from just before the
   publish HTTP call to frame parsing, so it includes the publisher's round trip;
   the Worker exposes no per-event server-side timing.
4. **No DO memory metric is available.** Cloudflare's observable surface here is
   `wrangler tail` (exceptions, CPU, wall time, outcome) and the DO's `/stats`
   counters. Memory symptoms are inferred from restarts/migrations.
5. **Presence traffic pollutes the latency figures** at large N: the harness waits
   for the room to quiesce before publishing (and reports how long that took), but
   at 2,500 it never really quietened.
6. **Ramp profile matters and is part of the configuration.** 1,000 sockets with a
   100-per-batch/50ms ramp failed; the same 1,000 with a 250-per-batch/0ms ramp
   passed once. The ramp is recorded in the results table for that reason.
7. The local realtime vitest suite could not be fully reproduced on this machine:
   171 of 175 tests passed, and `ws-ownership.test.ts` fails in isolation with
   local miniflare errors (`Web Socket request did not return status 101`,
   `Unexpected server response: 500`, worker exited unexpectedly). `apps/` is
   byte-identical to `main`, so this is an environment/harness failure, not a
   consequence of this change — but it means the unit-suite part of the evidence is
   partial.

## 9. Conclusion

* **5K same-community realtime was NOT successfully tested.** 2,558 of 5,000
  authenticated sockets connected to the same Community Room, only 399 remained
  when the harness checked, and the run aborted before publishing rather than
  reporting a fabricated result.
* **Largest verified scale: 1,000 users in one room, in one run** — 1,000/1,000
  connected, 1,000 DO-reported subscriptions, 10/10 controlled server-published
  events delivered to 10,000/10,000 expected sockets, 0 missing, 0 duplicates,
  0 errors, one DO instance, 0 sockets left behind.
* **Largest reproducible scale: 500 users** — the 1,000-user configuration failed
  on repeat (89.41% delivery, 2,118 missing deliveries, 56 disconnects, the DO
  restarted 6 times), so 1,000 is not a scale anyone should plan on today.
* **Fan-out correctness held wherever the room was stable**: 0 duplicates, 0
  missing, 0 cross-room/cross-topic frames, and the DO's own send counter matched
  the observed receipts event by event.
* **Observed bottleneck:** room-wide presence snapshots (one full roster per
  socket per coalescing window). **Blocker for 5K:** the object does not survive
  ~1,000+ sockets joining one room, so no 5K fan-out measurement exists yet.
* **Recommended next step:** treat presence scaling as its own finding (topic-scoped
  presence or deltas + a bounded roster), fix it, then re-run the same ladder —
  the corrected test is ready and its numbers are trustworthy as long as the room
  survives the ramp.

Factual wording of the result:

> On the staging configuration (`uxcommunity-realtime-staging`, version
> `6cd294b2`, deployed from `main` `fc90116b`), 500 authenticated users connected to
> the same Community Room in one Durable Object, the DO reported 500 subscriptions
> to topic `message`, and all 10,000 expected deliveries of 20 controlled
> server-published events arrived with 0 missing and 0 duplicates. At 5,000 users
> only 2,558/5,000 sockets connected and the room collapsed to 399 sockets before
> any event was published; the test correctly refused to report a fan-out result.

## 10. Re-running

```bash
# staging only — the script refuses a non-staging host unless ALLOW_NON_STAGING=1
export REALTIME_URL=https://uxcommunity-realtime-staging.<account>.workers.dev
export SESSION_SECRET=<staging secret>            # must match the deployment
export REALTIME_PUBLISH_SECRET=<staging secret>
export TEST_COMMUNITY_ID=<uuid>                   # one fresh room per stage

TOTAL_CLIENTS=20  EVENT_COUNT=5 node k6/loadtest-5k.mjs   # smoke
TOTAL_CLIENTS=100 node k6/loadtest-5k.mjs
TOTAL_CLIENTS=500 node k6/loadtest-5k.mjs
TOTAL_CLIENTS=1000 RAMP_BATCH=250 RAMP_DELAY_MS=0 node k6/loadtest-5k.mjs
TOTAL_CLIENTS=2500 RAMP_BATCH=250 RAMP_DELAY_MS=0 node k6/loadtest-5k.mjs
TOTAL_CLIENTS=5000 RAMP_BATCH=250 RAMP_DELAY_MS=0 node k6/loadtest-5k.mjs

JSON_OUT=/tmp/stage-5000.json node k6/loadtest-5k.mjs      # machine-readable summary
ROOM_MODE=distinct TOTAL_CLIENTS=1000 node k6/loadtest-5k.mjs  # control: one room per client
npm run test:k6-realtime                                   # accounting unit tests
```

### Separate, unrelated finding

`apps/realtime/__tests__/staging-test.mjs` and `staging-direct-proof.mjs` contain
**hardcoded staging `SESSION_SECRET` and `REALTIME_PUBLISH_SECRET` values**. They no
longer authenticate against the current staging deployment (verified: 401 on the
WebSocket upgrade, 403 on `/publish`), but they are committed credential material
and should be removed in a dedicated change. H-3 did not touch those files.
