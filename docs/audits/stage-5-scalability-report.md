# Stage 5 — Realtime Scalability Audit, Load Testing & Architecture Design

**Date:** 2026-11-06  
**Scope:** current `apps/realtime` Worker + Durable Objects, current docs, local load tests, staging verification, future architecture design.  
**Status:** investigation only. No production code, production routing, production schema, or production deployment was changed. No sharding was implemented.

## Labels used in this report

| Label | Meaning |
|---|---|
| **VERIFIED IN CODE** | Read from the current source/config in this worktree. |
| **MEASURED IN LOCAL WORKERD** | Produced by the local `workerd`/Wrangler harness against the real Worker/DO code and a local mock web API. Not staging. |
| **MEASURED IN STAGING — HISTORICAL** | A figure copied from an older committed report. It was not re-measured in Stage 5. |
| **INFERRED** | A conclusion drawn from code + measurements, but not directly observed. |
| **PROPOSED** | A design/threshold recommendation, not an implemented or measured behavior. |
| **NOT VERIFIED** | Could not be established with the available environment/credentials. |

---

## 1. Executive verdict

**The current architecture is not the “CommunityDO forwards to every UserDO” design described in the Stage 5 brief.** The current Room Durable Object owns community WebSockets directly and performs local `ws.send()` fan-out. There is no per-message DO-to-DO RPC. **VERIFIED IN CODE.**

**Highest fully successful test in Stage 5: 1,000 concurrent sockets in one `chat:` room.** At 1,000: 1,000/1,000 connected, 1,000/1,000 subscribed, 60,000/60,000 high-fan-out deliveries, P50 27 ms / P95 64 ms / P99 85 ms, zero missing, zero duplicates, zero unexpected disconnects. **MEASURED IN LOCAL WORKERD.**

**The local 1,500-socket attempt did not pass.** Best local attempt opened 1,468/1,500 (97.9%), left 1,317 subscribed, and closed 151 sockets with `4001 session revoked` before publishing; all 26,340 expected deliveries to the survivors were exact. A **distinct-room control** also failed at 1,461/1,500, so the local 1,500 failure cannot be attributed to one Room DO. **MEASURED IN LOCAL WORKERD.** The local workerd/harness/handshake path is the observed ceiling; the production Cloudflare ceiling was not reached.

**The old 2,500–4,000 estimate is not a verified current limit.** It comes from a historical staging report (`docs/realtime-presence-scaling.md`) measured on an older build. Stage 5 could not run authenticated staging tests, and the current local rig tops out below 1,500. **MEASURED IN STAGING — HISTORICAL / NOT VERIFIED.** It may be a useful conservative planning memory, but it must not be used as a capacity guarantee or as a reason to shard now.

**Main bottleneck found in Stage 5:** at moderate scale, the local **connection handshake/control plane** (two session validations + membership check + registration per socket, plus local workerd saturation) fails before message fan-out does. At 1,000 sockets, steady-state fan-out was cheap and exact. The production per-DO hot-room ceiling remains **NOT VERIFIED**; the historical reports point to a runtime-level reset between 2,500 and 4,000 sockets, not CPU. **INFERRED / HISTORICAL.**

**Recommendation:** **do not shard now.** Keep the single-Room architecture, fix staging test access and observability, re-run the ladder on staging, and use the measured per-room capacity to decide when Option C (community coordinator + delivery shards) is justified. **PROPOSED.**

---

## 2. Current realtime architecture

### 2.1 Diagram

```text
Browser / Expo client
   │
   │ WSS /ws?room=chat:<communityId>
   ▼
Cloudflare Realtime Worker (apps/realtime/src/index.ts)
   │  1. verify HS256 JWT (SESSION_SECRET)
   │  2. POST /api/internal/session/validate (API_SECRET)  [pre-upgrade]
   │  3. resolve room name → COMMUNITY_DO.idFromName(room)
   ▼
Room Durable Object  (one instance per LOGICAL ROOM NAME)
   │  owns the WebSocket
   │  in-memory: userId attachment, topic indexes, presence
   │  membership check → web API /members/:userId/check
   │  accept upgrade
   │  RPC register-room → UserDO (user:<userId>)
   │  4. POST /api/internal/session/validate  [post-upgrade]
   │  on failure: close 4001
   ▼
topic subscriber set ──► ws.send(event frame)   [direct; no DO-to-DO RPC]

Web app / API route
   │ POST /publish (x-realtime-publish-secret)
   ▼
Realtime Worker ── one fetch per event+room ──► Room DO
   (ctx.waitUntil + bounded pool, FANOUT_CONCURRENCY = 40)

User-scoped rooms:
WSS /ws?room=notifications:<userId> ──► UserDO (user:<userId>)
   UserDO owns those sockets; also stores registered community rooms
   and fans revocation to Room DOs with Promise.all.
```

**VERIFIED IN CODE:** `apps/realtime/src/room.ts`, `apps/realtime/src/user.ts`, `apps/realtime/src/index.ts`, `apps/realtime/src/room-routing.ts`.

### 2.2 Ownership model

| Question | Answer | Basis |
|---|---|---|
| Which DO owns a community WebSocket? | The **Room DO** for that logical room name. | VERIFIED IN CODE |
| Is there one Room DO per community? | No. There is one per **logical room**: `chat:<cid>`, `threads:<cid>`, `events:<cid>`, etc. are different DO instances. | VERIFIED IN CODE |
| Can two communities share a Room DO? | No. The community id is part of the room name. | VERIFIED IN CODE |
| Which DO handles community fan-out? | The Room DO for that room, directly to its attached sockets. | VERIFIED IN CODE |
| Does UserDO deliver community messages? | No. UserDO owns user-scoped sockets (notifications/profile and other user-scoped rooms) and tracks room registration/revocation. It is not on the message-delivery path. | VERIFIED IN CODE |
| How many DOs are involved per community connection? | One Room DO owns the socket; one UserDO participates in registration and can close it on revocation. Message delivery involves only the Room DO. | VERIFIED IN CODE |
| Can one user have multiple connections? | Yes. Limits: 12 sockets/user, 8 per session per room; oldest sockets are evicted. | VERIFIED IN CODE |
| Are community sockets multiplexed through UserDO? | No. A community socket terminates in its Room DO. The client opens one socket per logical room it needs. | VERIFIED IN CODE |
| Is message delivery sequential or parallel? | Direct, synchronous loop over the topic's subscribers in the Room DO; no RPC per recipient. `/publish` fan-out to separate rooms uses a bounded parallel pool. | VERIFIED IN CODE |
| Can one slow client delay others? | Not measurably at the tested scale. `ws.send()` is not awaited; a throwing socket is evicted. A paused client buffered its own frames and did not delay fast clients. | MEASURED IN LOCAL WORKERD + VERIFIED IN CODE |
| Is there message persistence in the DO? | No. The database is the source of truth; the Room keeps in-memory socket/subscription/presence state. Persisted `auth:*` keys are membership cache, and UserDO keeps revocation keys. | VERIFIED IN CODE |

### 2.3 Ten requested flows

| # | Flow | Current behavior | Basis |
|---:|---|---|---|
| 1 | User connects | `GET /ws?room=...&token=...` (or cookie); Worker verifies JWT. | VERIFIED IN CODE |
| 2 | Authenticates / registers with UserDO | Pre-upgrade session validation, then Room membership check, then `register-room` RPC to `user:<userId>`, then a second session validation. | VERIFIED IN CODE |
| 3 | User joins a community | Client connects to `chat:<communityId>`; the DO does not accept a “join another room” frame. | VERIFIED IN CODE |
| 4 | Room receives subscription | Client sends `{t:"subscribe", topic}`; the Room adds the socket to its topic index. The frame’s `room` field is ignored; the connection’s room is authoritative. | VERIFIED IN CODE |
| 5 | A message is published | API route calls `POST /publish` with `{room, topic, data}` and the publish secret. | VERIFIED IN CODE |
| 6 | Room fans out | Room resolves the topic’s subscribers and sends the event frame to each; no per-recipient RPC. | VERIFIED IN CODE |
| 7 | User receives | The same Room-owned WebSocket receives `{t:"event", room, topic, data}`. There is no UserDO hop. | VERIFIED IN CODE |
| 8 | Disconnect / loss | WebSocket closes; Room removes attachment and subscription refs; UserDO unregisters the room via `ctx.waitUntil(unregisterRoom)`. | VERIFIED IN CODE |
| 9 | Membership revoked while connected | UserDO closes matching sockets with `4001`; Room revocation removes the user's sockets and subscription refs. | VERIFIED IN CODE |
| 10 | Reconnect | New JWT/session validation, membership check, Room accept, register-room, subscribe. Reconnect storms repeat the full handshake cost. | VERIFIED IN CODE |

### 2.4 Limits and control-plane costs

| Item | Current value/behavior | Basis |
|---|---|---|
| Session validation | Two calls per community handshake: pre-upgrade and post-upgrade; 2.5 s timeout; fail-closed. | VERIFIED IN CODE |
| Membership check | One web-API call per Room accept; cache 500 entries / 60 s; persisted `auth:*` keys; pruned. | VERIFIED IN CODE |
| Upgrade rate limit | 30 burst / 5 per second per user per room. | VERIFIED IN CODE |
| Socket caps | 12/user; 8/session/room; oldest eviction. | VERIFIED IN CODE |
| Client publish | Only `typing`; 12 burst / 4 per second per socket; 24 burst / 8 per second per user. | VERIFIED IN CODE |
| Presence | Constant `{count}` payload (~78 B); 150 ms coalescing; 256 sends per flush; lap rotation. | VERIFIED IN CODE |
| Publish fan-out | One HTTP fetch per event+room from Worker; bounded pool of 40; no DO-to-DO message RPC. | VERIFIED IN CODE |
| Revocation fan-out | UserDO `Promise.all` to registered Room DOs. | VERIFIED IN CODE |
| Room storage/alarms | No message persistence/alarm for message delivery; DB is source of truth. | VERIFIED IN CODE |
| Heartbeat | `setWebSocketAutoResponse("ping","pong")`; answered without waking the DO. | VERIFIED IN CODE |

---

## 3. Existing documentation audit

| Document | Old claim | Current finding | Action |
|---|---|---|---|
| `docs/realtime-5k-loadtest-audit.md` | 500 reproducible; 1,000 in one run; 5K failed; presence roster was the blocker. | Historical, pre-presence-fix. The fix replaced roster presence with a bounded count. | Marked **historical/superseded** at the top; preserved. |
| `docs/realtime-presence-scaling.md` | 2,500 passes; 4,000 is the edge with one DO replacement; 5,000 drops to 4,750 and resets. | Historical staging ladder on build `ed8fae25`, not re-run in Stage 5. It is the source of the 2,500–4,000 estimate. | Marked **historical** at the top and in the threshold section; preserved. |
| `INFRASTRUCTURE-AUDIT.md` | “Room per community”; “SQLite storage (presence / subscriptions)”. | The first is imprecise (per logical room); the second is false (presence/subscriptions are in memory; SQLite holds auth/revocation keys). | Corrected. |
| `README.md` | “one `Room` DO per community.” | Same imprecision. | Corrected to per logical room. |
| `apps/web/README.md` | “one `Room` Durable Object per community.” | Same imprecision; each `chat:*`, `threads:*`, etc. is separate. | Corrected. |
| `docs/community-hibernation.md` | “Each community's realtime runs on its own WebSocket straight to that community's Durable Object.” | Mostly correct for community chat, but the DO is the `chat:<id>` logical room; other room types are separate. | Clarified. |
| `k6/README.md` | Describes the 5K harness and staging ladder. | The harness is current; staging results referenced there are historical. | The Stage 5 report is the current dated record; no ladder rewrite. |

**VERIFIED IN CODE / HISTORICAL:** the old reports are preserved; no historical figure was silently deleted.

---

## 4. Staging environment verification

| Check | Result | Basis |
|---|---|---|
| Staging Worker URL | `https://uxcommunity-realtime-staging.patilsachin1228.workers.dev` responds. | VERIFIED (live HTTP) |
| Root route | `GET /` → HTTP 404 “Not found”. | VERIFIED (live HTTP) |
| WebSocket route | `GET /ws` → HTTP 400 “Missing room”. | VERIFIED (live HTTP) |
| Stats gate | `GET /stats` → HTTP 403 “Forbidden” without the publish secret. | VERIFIED (live HTTP) |
| Latest deployment observed | Version `8b2b1fa0-1bbc-4467-b7ae-90f6b1527aaf`, created 2026-11-06T07:30:27Z. | VERIFIED via `wrangler deployments list` |
| Staging bindings | `ROOM`/`COMMUNITY_DO` class `Room`, `USER_DO` class `UserDO`, `ALERT_MONITOR` class `AlertMonitor`; `WEB_SERVICE=uxcommunity-web-staging`; `APP_ENV=staging`; migrations v1–v4. | VERIFIED IN CODE (`wrangler.staging.toml`) |
| Staging secrets | Names visible: `API_SECRET`, `API_URL`, `REALTIME_PUBLISH_SECRET`, `SESSION_SECRET`, `STAGING_ALLOWED_ORIGINS`. Values are not exposed. | VERIFIED (names only) |
| Database isolation | Cannot verify the staging database, test users, memberships, or cleanup. There is no `.local/staging/environment.json`, no staging test-user manifest, and secret values are unavailable. | NOT VERIFIED |
| Account/Worker usage limits | `wrangler` can list deployments, but no account analytics/usage data was available; Cloudflare account limits were not verified. | NOT VERIFIED |
| Production isolation | All tests in this stage ran against `127.0.0.1`; no production endpoint was used. | VERIFIED |

**Blocker:** authenticated staging load testing is blocked by missing staging credentials/test identity/manifest and unverified database isolation. No staging connection, publish, revocation, or membership test was run. This report does **not** claim any staging measurement. **NOT VERIFIED.**

The current secret list includes `API_URL`/`API_SECRET`, so the older statement that staging had no membership gate is itself outdated; the actual membership behavior and database isolation remain unverified. **NOT VERIFIED.**

---

## 5. Load-test methodology and environment

### 5.1 Why local workerd

The staging Worker is live but cannot be authenticated from this checkout. Running an unauthenticated aggressive test would not exercise the real socket/DO path and could create unintended load; running against production is forbidden. The only defensible option was to run the current Worker/DO code locally.

### 5.2 Environment

| Item | Value | Basis |
|---|---|---|
| Host | Darwin arm64, Apple M1 | MEASURED (host) |
| Node | v24.18.0 | MEASURED (host) |
| Wrangler | 4.152.0 | MEASURED (host) |
| Worker | `wrangler dev --config wrangler.development.toml --local`, port 8797 | MEASURED |
| DO code | Current worktree `apps/realtime` source, actual `Room`/`UserDO`/`AlertMonitor` classes | VERIFIED |
| Web API | Local mock on 127.0.0.1:8799 implementing `/api/internal/session/validate` and membership `/check` | MEASURED (local test rig only) |
| Auth | HS256 JWT signed with local `SESSION_SECRET`, unique `userId`/`sid`, `sv=1` per socket | VERIFIED (harness) |
| Rooms | One fresh `chat:<uuid>` per run | VERIFIED (harness) |
| Publish | Real secret-authenticated `POST /publish` | VERIFIED |
| Delivery accounting | Per-event id + per-socket bitmap; exact delivered/missing/duplicate; server `deliverAttempts` cross-check | VERIFIED (harness) |
| Staging | **Not used** | VERIFIED |

### 5.3 Harness changes

| File | Change | Basis |
|---|---|---|
| `k6/loadtest-5k.mjs` | Added required `sid`/`sv` claims to the test JWT; fixed membership preflight counter comparison. | VERIFIED (diff) |
| `k6/staging-smoke-test.mjs` | Added required `sid`/`sv` claims. | VERIFIED (diff) |
| `.local/stage5/mock-api.mjs` | Local-only mock API; not committed. | MEASURED |
| `.local/stage5/workloads.mjs` | Local-only A/D/E/F driver; not committed. | MEASURED |

### 5.4 Test workloads

| Workload | What ran | Scale |
|---|---|---|
| A — connection-only | Connect, join, subscribe, heartbeat, hold 60 s | 1,000 |
| B — normal chat | 20 controlled server publishes at 1/s | 1,000 |
| C — high fan-out | 60 controlled server publishes at 10/s | 1,000 |
| D — churn | 5 cycles of 500 connect/subscribe/close | 500 per cycle |
| E — mixed | 60 messages, 10 typing publishes/s, presence joins/leaves, 5 reconnects every 2 s | 500 |
| F — slow client | 10 clients paused their TCP reads; 20 × 16 KB messages at 10/s | 200 |

### 5.5 What the measurements do and do not prove

- **Directly measured:** connection success/failure, connection time, close codes/reasons, heartbeat pongs, subscription refs from `/stats`, exact event delivery/missing/duplicates/order, client-measured publish-to-frame latency, DO counters (`connectionsOpened`, `sendFailures`, `eventsPublished`, `deliverAttempts`, `presenceDeliverAttempts`, `membershipChecks`, evictions, revocations), cleanup.
- **Not directly measured:** per-DO CPU time, per-DO memory, DO wall-clock execution, Cloudflare account limits, RPC latency, production network path, production database latency, real membership/DB state.
- **Latency is an upper bound:** it starts before the publisher's HTTP `POST /publish` and ends at frame parsing, so it includes the publish round trip. The Worker exposes no per-event server-side timing. **MEASURED IN LOCAL WORKERD.**
- **Local workerd is not Cloudflare:** the local runner shares one machine and one local process; its ~1,500-socket failure is not evidence of the production per-DO ceiling. **INFERRED.**

---

## 6. Results

### 6.1 Same-room ladder (normal chat, 20 events at 1/s)

| Sockets | Connected | Subscribed (DO) | Deliveries | Missing | Dups | Connect P50/P95/P99 | Delivery P50/P95/P99 | Unexpected disconnects | Result |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 100 | 100/100 | 100 | 2,000/2,000 | 0 | 0 | 1,550 / 1,777 / 1,778 ms | 15 / 35 / 50 ms | 0 | PASS |
| 250 | 250/250 | 250 | 5,000/5,000 | 0 | 0 | 515 / 786 / 786 ms | 64 / 197 / 358 ms | 0 | PASS |
| 500 | 500/500 | 500 | 10,000/10,000 | 0 | 0 | 417 / 566 / 575 ms | 29 / 78 / 199 ms | 0 | PASS |
| 1,000 | 1,000/1,000 | 1,000 | 20,000/20,000 | 0 | 0 | 809 / 1,465 / 1,481 ms | 106 / 270 / 351 ms | 0 | PASS |

**MEASURED IN LOCAL WORKERD.** Connection times include the ramp and local harness scheduling; they are not a production connection-time SLO. The 500/1,000 close codes `1006` shown by the harness are cleanup closes, not disconnects during the run.

### 6.2 The 1,500 boundary

| Run | Connected | Subscribed | Deliveries | Missing/Dups | Delivery P50/P95/P99 | Failures / closes | Result |
|---|---:|---:|---:|---|---:|---|---|
| 1,500 same room, normal ramp | 1,313/1,500 (87.53%) | 1,063 | 21,260/21,260 among survivors | 0 / 0 | 115 / 375 / 427 ms | 187 connect failures; 250 × `4001 session revoked` | FAIL |
| 1,500 same room, slow ramp (50/50 ms) | 1,468/1,500 (97.87%) | 1,317 | 26,340/26,340 among survivors | 0 / 0 | 867 / 2,455 / 2,970 ms | 32 failures; 151 × `4001` | FAIL |
| 1,500 distinct rooms (control) | 1,461/1,500 (97.40%) | 1,402 (across rooms; 1 in target) | 3/3 in target | 0 / 0 | 7 / 12 / 12 ms | 39 connect failures (37 HTTP 500, 2 timeouts); 59 × `4001` | FAIL |

**MEASURED IN LOCAL WORKERD.** The local 1,500 runs are not a production capacity result.

What this means:

- **VERIFIED:** in the 1,500 same-room slow run, every surviving subscribed socket received every event, with zero missing/duplicates; the DO’s `sendFailures` was 0. Message fan-out was not what failed.
- **VERIFIED:** the distinct-room control also failed (1,461/1,500), so one hot Room DO is not the sole local cause.
- **INFERRED:** the local ceiling is in the shared handshake/control path or local workerd, not in per-room fan-out. The same-room logs showed `[session] isolated validation could not complete ... timeout`, and the post-upgrade validation closes with `4001`; the distinct run also produced 37 HTTP 500 upgrades. The exact component behind the 500s was not captured. **NOT VERIFIED.**
- **NOT VERIFIED:** the production failure point. No staging test was possible.

The 1,500-local result is therefore evidence of **handshake fragility under a 1,500-socket ramp**, but not evidence that a production Room DO cannot hold 1,500 sockets.

### 6.3 Workload A — connection-only (1,000 sockets, 60 s hold)

| Metric | Result |
|---|---|
| Connected | 1,000/1,000 (100%) |
| Connection P50/P95/P99 | 420 / 565 / 617 ms |
| Live after 60 s | 1,000 |
| Subscriptions at settle | 1,000/1,000 |
| Heartbeat pongs | 2,601 |
| WebSocket errors | 0 |
| Cleanup | 1,220 ms; sockets 0 / refs 0 |
| Presence during ramp | 4,095 sends / 0.323 MB; 11 deferred windows |
| Membership checks | 1,000; failures 0; cache evictions 500 |

**MEASURED IN LOCAL WORKERD.** The `/stats` in-memory counters reset after a long idle/hibernation period while the 1,000 sockets remained attached; this is hibernation, not a socket loss. **VERIFIED** by `sockets=1,000` at the same time the instance counters read 0.

### 6.4 Workload B — normal chat (1,000 sockets, 20 events at 1/s)

| Metric | Result |
|---|---|
| Connected / subscribed | 1,000 / 1,000 |
| Events | 20/20 HTTP 200 |
| Deliveries | 20,000/20,000 (100%) |
| Missing / duplicates | 0 / 0 |
| Delivery P50/P95/P99 | 106 / 270 / 351 ms |
| Unexpected disconnects | 0 |
| DO instances | 1 |
| `sendFailures` | 0 |
| Sockets after cleanup | 0 |

**MEASURED IN LOCAL WORKERD.**

### 6.5 Workload C — high fan-out (1,000 sockets, 60 events at 10/s)

| Metric | Result |
|---|---|
| Connected / subscribed | 1,000 / 1,000 |
| Events | 60/60 HTTP 200 |
| Deliveries | 60,000/60,000 (100%) |
| Missing / duplicates | 0 / 0 |
| Delivery P50/P95/P99 | 27 / 64 / 85 ms |
| Publish P50/P95/P99 | 43 / 91 / 141 ms |
| Unexpected disconnects | 0 |
| DO `deliverAttempts` | 60,001 |
| DO `sendFailures` | 0 |
| DO `eventPayloadBytes` | 37,230,618 B (~620 B/recipient/event) |
| Presence traffic | 5,749 sends / 0.455 MB; 16 deferred windows |
| Cleanup | 0 sockets / 0 refs |

**MEASURED IN LOCAL WORKERD.** This is 10,000 deliveries/second at 1,000 recipients with exact accounting and no observed fan-out failure.

### 6.6 Workload D — churn (500 sockets × 5 cycles)

| Cycle | Connected | Subscribed | Cleanup | Connect P50/P95/P99 |
|---:|---:|---:|---:|---:|
| 1 | 500/500 | 500 | 12 ms | 193 / 235 / 244 ms |
| 2 | 500/500 | 500 | 17 ms | 118 / 236 / 246 ms |
| 3 | 500/500 | 500 | 12 ms | 120 / 377 / 378 ms |
| 4 | 500/500 | 500 | 13 ms | 125 / 382 / 383 ms |
| 5 | 500/500 | 500 | 6 ms | 126 / 198 / 205 ms |

**MEASURED IN LOCAL WORKERD.** Every cycle returned to 0 sockets / 0 subscription refs. No connection failures and no server-initiated `4001`/`1011` closes were observed. The harness’s `1006` accounting includes the deliberate client teardown and is not a failed churn cycle.

### 6.7 Workload E — mixed (500 sockets, 15 s)

| Metric | Result |
|---|---|
| Connected / subscribed | 500 / 500; 1,000 refs (message + typing) |
| Messages | 60/60 HTTP 200 |
| Expected / delivered | 30,000 / 29,960 |
| Missing | 40 |
| Duplicates / out-of-order | 0 / 0 |
| Delivery P50/P95/P99 | 17 / 27 / 33 ms |
| Deliberate reconnects | 40/40 re-opened |
| Typing publishes / frames | 139 / 69,251 |
| Live before teardown | 500 |
| DO `sendFailures` | 0 |
| Cleanup | 0 sockets / 0 refs |

**MEASURED IN LOCAL WORKERD.** The 40 missing deliveries occur on exactly 8 events, 5 sockets per event, matching the 5-socket churn rounds; this is **INFERRED** to be the deliberately disconnected sockets, not unexplained loss. No stable socket reported an out-of-order or duplicate event.

### 6.8 Workload F — slow-client (200 sockets, 10 paused)

| Metric | Result |
|---|---|
| Connected / subscribed | 200 / 200 |
| Fast receivers | 3,800/3,800 deliveries |
| Paused receivers before resume | 0/200 |
| Paused receivers after resume | 200/200 |
| Total | 4,000/4,000; 0 missing; 0 duplicates |
| Fast P50/P95/P99 | 20 / 40 / 70 ms |
| Paused P50/P95/P99 | 4,323 / 5,551 / 5,675 ms |
| DO `sendFailures` | 0 |
| Payload | 16 KB/event; ~66.2 MB total recipient bytes |
| Cleanup | 0 sockets / 0 refs |

**MEASURED IN LOCAL WORKERD.** The paused clients did not delay fast clients. They buffered their own frames and received all 20 events after resuming. This is a bounded test (10 clients × 20 × 16 KB); it does not prove memory safety for arbitrarily slow clients or much larger payloads.

### 6.9 What was not measured

- No CPU time, wall-clock execution, or memory per Durable Object: Cloudflare does not expose DO memory, and the local `/stats` endpoint does not include CPU. **NOT VERIFIED.**
- No staging/account-level error rates or Cloudflare-enforced connection limits. **NOT VERIFIED.**
- No 2,000/2,500/3,000/4,000/5,000 run in Stage 5: the local 1,500 boundary made higher local counts uninterpretable, and staging was blocked. **NOT VERIFIED.**
- No database/membership test under load: the local mock always allows; production DB latency and RLS/membership behavior were not exercised. **NOT VERIFIED.**

---

## 7. Actual bottleneck

### 7.1 What the data rules out at 1,000

| Candidate | Finding | Basis |
|---|---|---|
| Message fan-out | 60,000/60,000 delivered at 10/s; P99 85 ms; `sendFailures=0`. | MEASURED IN LOCAL WORKERD |
| Presence | Constant count; 0.455 MB for the 1,000-socket/60-event run; 16 deferred windows. No roster/O(N²) sends. | MEASURED + VERIFIED IN CODE |
| Per-user UserDO fan-out | Not on the message path; no per-message RPC. | VERIFIED IN CODE |
| Storage | No message persistence in the Room; DB is source of truth. | VERIFIED IN CODE |
| Slow consumer | Fast clients unaffected; paused clients buffered only themselves. | MEASURED IN LOCAL WORKERD |

### 7.2 What failed at 1,500 locally

The handshake repeats expensive work per socket:

1. JWT verify.
2. Session validation HTTP call (2.5 s timeout).
3. Membership API check in the Room.
4. `register-room` RPC to UserDO.
5. Second session validation HTTP call.
6. Accept/close with `4001` if the second check fails.

**VERIFIED IN CODE.** At 1,500 sockets this produced 151–250 `4001` closes, 32–187 connect failures, and session-validation timeout logs. The distinct-room control also failed, so this is not a single-Room fan-out limit. **MEASURED IN LOCAL WORKERD / INFERRED.**

This is a real architectural risk: a reconnect storm or a web-API/DB latency spike multiplies into two validation calls and one membership call per socket. It is **not** evidence that the current production Room DO cannot hold 1,500 sockets.

### 7.3 Historical production bottleneck (not re-measured)

The historical staging report says a single hot Room DO is stable at 2,500, starts replacing at 4,000, and resets at 5,000, with the 5,000-distinct-room control passing. That was measured on build `ed8fae25`; Stage 5 did not reproduce it. **MEASURED IN STAGING — HISTORICAL.**
The same report observed no Worker/DO exceptions, low CPU per invocation, and `sendFailures=0` even during collapse, which points to a platform/runtime or per-object resource ceiling rather than an application exception. **INFERRED / HISTORICAL.**

### 7.4 Current conclusion

The main **verified** Stage 5 constraint is the local handshake/rig ceiling at ~1,500 sockets. The main **historical/inferred** production constraint is a per-hot-Room ceiling between 2,500 and 4,000 sockets. Neither is a measured current production threshold. **INFERRED / NOT VERIFIED.**

---

## 8. Capacity thresholds and monitoring

### 8.1 Verified local envelope

| Quantity | Value | Basis |
|---|---:|---|
| Highest fully successful same-room count | 1,000 | MEASURED IN LOCAL WORKERD |
| Highest opened count (not a pass) | 1,468/1,500 | MEASURED IN LOCAL WORKERD |
| Highest subscribed count (not a pass) | 1,317 | MEASURED IN LOCAL WORKERD |
| Highest sustained hold | 1,000 for 60 s | MEASURED IN LOCAL WORKERD |
| Highest tested message rate | 10 events/s at 1,000 (10k deliveries/s) | MEASURED IN LOCAL WORKERD |
| Highest clean P99 | 85 ms at 10 events/s | MEASURED IN LOCAL WORKERD |

### 8.2 Recommended thresholds

**Local test rig only — PROPOSED, not production:**

- Warning: **750** sockets in one `chat:` room (75% of the verified clean 1,000).
- Critical: **900** sockets (90%).
- Hard test ceiling: **1,000**; do not treat 1,500 as a capacity target.

**Production — NOT VERIFIED / PROPOSED POLICY:**

Do **not** copy the local 750/900 numbers to production. The only safe production threshold is derived from a clean staging ladder on the deployed build. Until that exists, use the historical 2,500–4,000 figures only as a reason to test, not as a guarantee. The policy should be:

- Warning = **70% of the largest clean staging run**.
- Critical = **90% of the largest clean staging run**.
- Sharding review = warning sustained for 5 minutes, or any DO instance change under load, or a `4001`/session-validation failure rate above 0.1% of handshakes.
- No production numeric threshold is claimed in this report. **NOT VERIFIED.**

**Message rate:** 10 events/s at 1,000 is verified locally; do not extrapolate it to 2,500–5,000, where only 1 event/s was historically tested. **PROPOSED:** treat 10/s per 1,000-socket room as the current local ceiling, not a production SLO.

**Latency targets:** a conservative initial target of **P95 ≤ 250 ms / P99 ≤ 500 ms** is **PROPOSED**; the measured 1,000-socket high-fan-out baseline was P95 64 ms / P99 85 ms, leaving headroom. The normal-chat run measured P95 270 ms / P99 351 ms, so the target is not yet a universal pass at every workload. The historical 2,500/4,000 staging P95 was 991/1,083 ms; those runs would not meet this proposed target.

**Disconnects:** clean 1,000 runs had zero unexpected disconnects. **PROPOSED:** page on any non-user-initiated `4001`, any burst of `1006/1011` above 0.5% of live sockets per minute, or any DO `instanceId` change during a load window. Historical 2,500 had 11 disconnects and 4,000 had 33; those are historical observations, not thresholds.

**CPU/RPC:** no per-DO CPU/RPC metric was available in Stage 5. **NOT VERIFIED.** Use Cloudflare analytics/logs if available; do not invent a CPU percentage. The meaningful control-plane signals are session-validation failures, post-upgrade `4001`s, `register-room` failures, and `/publish` fan-out failures.

---

## 9. Architecture options

### Option A — Community sharding

**PROPOSED.** Split one `chat:<cid>` room across N `Room` DOs by a deterministic user/socket hash. Each shard owns its WebSockets and topic indexes; a publish fans out to all shards. Presence is summed from shard counts. Ordering is per-shard unless a global sequence is added.

| Dimension | Assessment |
|---|---|
| Advantages | Removes the single hot Room ceiling; simple deterministic placement; failure isolation per shard; incremental shard count. |
| Disadvantages | Cross-shard presence/ordering; publish must reach every shard; hot-shard skew; rebalancing moves sockets; clients need shard-aware reconnect. |
| Complexity | Medium–high. |
| Cloudflare usage | N × Room DOs; N × publish fetches per event; more objects and connections. |
| Scaling | Linear-ish in shard count for connections and sends; coordination/presence costs grow with shards. |
| Failure modes | One shard down affects only its sockets; a publish partially delivered; duplicate delivery if shard membership is ambiguous. |
| Migration | Medium: shard map + connection routing + publish fan-out + drain. |
| Operational | Shard health, skew, rebalance, ordering. |

### Option B — Hierarchical fan-out

**PROPOSED.** A coordinator/gateway receives publishes and forwards to delivery DOs or gateways in a tree.

| Dimension | Assessment |
|---|---|
| Advantages | Can isolate delivery tiers; useful for very large or cross-region fan-out; backpressure can be centralized. |
| Disadvantages | Adds RPC hops and latency; more failure points; current Room already does direct local sends cheaply; hierarchy can amplify RPC volume. |
| Complexity | High. |
| Cloudflare usage | More DO/RPC calls per publish; more objects. |
| Scaling | Good for huge fan-out if tree is balanced; worse latency for small/medium rooms. |
| Failure modes | Coordinator saturation; partial tree delivery; retry/duplication. |
| Migration | High. |
| Operational | High. |

### Option C — Hybrid: community coordinator + delivery shards

**PROPOSED — recommended future direction if a hot room exceeds the verified threshold.** Keep a lightweight community-level coordination layer (shard map, membership/presence aggregation, sequence allocation) and N delivery shards that own sockets and perform direct sends. The coordinator can be Worker/config-driven rather than a single hot DO; the important property is that no one object owns both all sockets and all coordination.

| Dimension | Assessment |
|---|---|
| Advantages | Removes one-hot-DO socket ownership; presence can be summed from shards; direct sends remain local to each shard; failure isolation; can preserve per-room ordering with a sequence. |
| Disadvantages | Most complex option; shard map and reconnect routing; cross-shard presence and ordering; publish fans to N shards; rebalancing. |
| Complexity | High. |
| Cloudflare usage | N delivery DOs + coordination storage/config; N publish calls per event; presence aggregation. |
| Scaling | Good beyond the single-object ceiling; cost grows with shards and fan-out. |
| Failure modes | Partial shard delivery; stale shard map; presence skew; ordering gaps; rebalance duplicates. |
| Migration | Medium–high, but can be per-community and gradual. |
| Operational | Highest: shard health, skew, drains, sequence monitoring, rollback. |

**Recommendation:** **Option C only when the measured staging threshold is crossed.** Option A is a simpler subset if only connection count is the issue and presence/ordering can remain global. Option B is not justified by the current direct-send architecture and would add RPC cost before it solves a measured problem. **PROPOSED.**

**Why not now:** current clean local 1,000; historical staging 2,500 stable; no current production measurement shows a hot room at risk. Sharding adds substantial complexity and new failure modes. The first work should be staging access, observability, and a re-run of the ladder. **PROPOSED / INFERRED.**

---

## 10. Migration and rollback strategy

**PROPOSED; not implemented in Stage 5.**

1. Add per-community realtime mode/shard-count configuration (default `single`; existing communities unchanged).
2. Enable the new mode for one canary community only; new connects receive a shard assignment (signed shard token or a Worker-resolved map). Existing sockets remain on the old single Room until they reconnect.
3. Publish through one path: the Worker reads the community's mode and sends one event to the single Room or to each shard. Do **not** dual-write or dual-deliver to two independent systems.
4. Preserve ordering with a per-room sequence; each shard preserves per-socket order, and the client handles the sequence for cross-shard display. Do not claim global ordering without that sequence.
5. Presence: each shard reports its count; the coordinator/Worker sums and publishes one count. Avoid N independent presence broadcasts to the same clients.
6. Drain: stop new connections to a shard, wait for existing sockets to reconnect or close with a controlled code, then remove the shard. Keep the old single-Room path available for rollback.
7. Rollback: set the community back to `single`; drain shards; new connections go to the single Room; monitor for duplicates/ordering gaps. No schema migration or production routing change is required for the rollback in this design.
8. Canary gates: 24–48 h of clean connections, zero unexplained `4001`, p95/p99 within target, no DO instance resets, then expand.

**Risks during migration:** duplicate delivery if a publish races a shard map change; ordering gaps; presence double-count; clients reconnecting to the wrong shard; rollback while old sockets still hold state. The design must make shard assignment idempotent and publish fan-out observable. **PROPOSED.**

---

## 11. Monitoring requirements

**PROPOSED.** The current `/stats` counters are a good base; add the following per-room view:

| Signal | Why | Source |
|---|---|---|
| `sockets`, `users`, `subscriptionRefs` | Occupancy and actual subscriptions | `/stats` |
| `connectionsOpened/Closed` | Churn and leaks | `/stats` |
| `instanceId` changes | DO restart/migration indicator | `/stats` samples |
| `sendFailures` | Broken/slow socket eviction | `/stats` |
| `presenceDeliverAttempts`, `presenceDeferredWindows` | Presence cost/backlog | `/stats` |
| `membershipChecks`, `membershipChecksFailed`, `membershipCacheEvictions` | Control-plane health | `/stats` |
| `sessionRevocations`, `socketsClosedByRevocation` | 4001 storms | `/stats` |
| `upgradeRateLimited` | Ramp/rate-limit behavior | `/stats` |
| Session-validation failures/timeouts | Pre/post-upgrade dependency | Worker logs/metric |
| `register-room` failures/latency | UserDO registration path | Worker/DO metric |
| `/publish` status, fan-out failures, latency | Control-plane and fan-out | Worker metric |
| Close-code distribution by code/reason | 4001/1006/1011 diagnosis | Client/Worker telemetry |
| Client reconnect rate and time-to-subscribe | User-visible instability | Client telemetry |
| CPU/wall time | Only if Cloudflare analytics exposes it | Platform |
| DO memory | **Not exposed**; infer from instance resets | NOT VERIFIED |

**Alerting:** page on any unexplained `4001`, any DO instance change under load, session-validation failure >0.1% of handshakes, `sendFailures` >0, or a P99 above the product target for 5 minutes. Warning alerts at 70% and critical at 90% of the verified clean room capacity. Create a synthetic canary that opens a socket, joins, subscribes, publishes, and measures delivery per region; run it continuously. **PROPOSED.**

**Before relying on any threshold:** deploy the staging access/manifest, run the 1,000/2,500/4,000 ladder on the current build, and record the same counters. A dashboard with no verified denominator is not a threshold. **PROPOSED.**

---

## 12. Remaining unknowns and risks

| Risk/unknown | Severity | Status |
|---|---|---|
| Authenticated staging load tests unavailable | High | NOT VERIFIED; blocks production capacity claim |
| Staging DB/user/community isolation unverified | High | NOT VERIFIED; do not run aggressive tests |
| Cloudflare account/Worker limits unverified | Medium | NOT VERIFIED |
| Production per-DO ceiling between 1,500 and 5,000 | High | NOT VERIFIED; historical only |
| Local 1,500 failure cause (handshake vs workerd vs 500s) | Medium | INFERRED; exact 500 cause not captured |
| No per-DO CPU/memory metrics | Medium | NOT VERIFIED |
| Two session validations + membership + registration per connect | Medium | VERIFIED IN CODE; reconnect-storm risk |
| Slow-client memory/backpressure beyond 10 × 20 × 16 KB | Medium | NOT VERIFIED |
| Historical docs conflict (staging membership gate) | Medium | Marked historical; current staging `API_URL`/`API_SECRET` present but unverified |
| No production traffic distribution/hot-room data | High | NOT VERIFIED |
| Sharding not implemented/tested | — | Out of scope by request |

**Additional risk:** the local mock allows every membership check and validates every session without a database. It exercises the Worker/DO code path but not production authorization, RLS, or DB latency. **NOT VERIFIED.**

---

## 13. Final deliverable

| Question | Answer |
|---|---|
| Current realtime architecture | Worker authenticates; one Room DO per logical room owns community sockets; direct topic-index `ws.send()`; UserDO owns user-scoped sockets and registers/revokes; no per-message DO-to-DO RPC. |
| Is the old 2,500–4,000 estimate still valid? | **No, not as a verified current limit.** It is a historical staging observation on an older build. Current Stage 5 could not reach it and did not measure staging. Use only as a test trigger, not a capacity guarantee. |
| Highest successfully tested count | **1,000** same-room sockets (A/B/C), fully successful locally. 1,500 was attempted but failed (best: 1,468 opened, 151 revoked; distinct control also failed). |
| Actual failure point | **Local only:** ~1,500-socket handshake/rig ceiling; no production failure point was established. **NOT VERIFIED** for production. |
| Safe operating threshold | **No verified production threshold.** Local rig only: warning 750, critical 900, max 1,000. Production policy: 70%/90% of the largest clean staging run after re-testing. |
| Main scalability bottleneck | Verified local: handshake/control plane and local workerd at 1,500, not steady-state fan-out. Historical/inferred production: single hot Room DO/runtime ceiling between 2,500 and 4,000. |
| Recommended future architecture | **Option C — community coordinator + delivery shards**, only if a measured hot room crosses the threshold. Do not build now. |
| Is sharding needed now? | **No.** Current verified local 1,000 and historical 2,500 stable do not justify it; staging re-measurement and observability come first. |
| Documentation updated | This report; historical banners on the two prior realtime reports; corrected per-logical-room model in `INFRASTRUCTURE-AUDIT.md`, `README.md`, `apps/web/README.md`; clarified `docs/community-hibernation.md`. |
| Tests/measurements performed | 100/250/500/1,000 ladder, 1,500 attempts (same room, slow ramp, distinct control), A–F workloads at 1,000/500/200, exact delivery accounting, `/stats` counters, cleanup checks. |
| Remaining risks | Staging auth/isolation, production per-DO ceiling, CPU/memory unknown, handshake amplification, slow-client memory, no production traffic data. |
| Recommended next implementation stage | **Stage 6: staging access + observability + a clean staging ladder on the current build.** Then decide whether Option C is needed; do not implement sharding before that. |

### Factual bottom line

> On the local workerd harness, on 2026-11-06, 1,000 authenticated sockets connected to one `chat:` Room DO, the DO reported 1,000 subscriptions, and 60,000/60,000 controlled `POST /publish` deliveries arrived with zero missing, zero duplicates, P99 85 ms at 10 events/s. At 1,500, the local run did not pass: the best attempt opened 1,468/1,500, 151 sockets were closed with `4001 session revoked`, and a distinct-room control also failed. No staging or production load test was run because staging credentials and DB isolation could not be verified. The old 2,500–4,000 figure is historical, not a current measured guarantee.

---

## Appendix A — Reproduction (local only)

```bash
# Mock API (local only)
node .local/stage5/mock-api.mjs

# Worker (from apps/realtime)
npx wrangler dev --config wrangler.development.toml \
  --port 8797 --ip 127.0.0.1 --local --log-level info

# Normal/fan-out ladder: existing harness
REALTIME_URL=http://127.0.0.1:8797 \
SESSION_SECRET=... REALTIME_PUBLISH_SECRET=... \
TEST_COMMUNITY_ID=<fresh uuid> TOTAL_CLIENTS=1000 \
RAMP_BATCH=100 RAMP_DELAY_MS=50 EVENT_COUNT=60 PUBLISH_INTERVAL_MS=100 \
JSON_OUT=.local/stage5/workload-fanout-1000.json \
node k6/loadtest-5k.mjs

# A/D/E/F: local-only driver
REALTIME_URL=http://127.0.0.1:8797 \
SESSION_SECRET=... REALTIME_PUBLISH_SECRET=... \
TEST_COMMUNITY_ID=<fresh uuid> WORKLOAD=mixed TOTAL_CLIENTS=500 \
EVENT_COUNT=60 DURATION_MS=15000 MESSAGE_RATE=5 TYPING_RATE=10 \
node .local/stage5/workloads.mjs
```

`k6/loadtest-5k.mjs` refuses a non-staging host unless `ALLOW_NON_STAGING=1`; the local runs set `REALTIME_URL=http://127.0.0.1:8797` explicitly. `.local/stage5/*` and `.dev.vars` are gitignored and not part of the deliverable. **VERIFIED IN CODE.**

## Appendix B — Artifacts

| Artifact | What it contains |
|---|---|
| `.local/stage5/ladder-{100,250,500,1000,1500}.json` | Normal-chat ladder and 1,500 attempts |
| `.local/stage5/control-1500.json` | Distinct-room control |
| `.local/stage5/workload-connection-1000.json` | Workload A |
| `.local/stage5/workload-fanout-1000.json` | Workload C |
| `.local/stage5/workload-churn-500.json` | Workload D |
| `.local/stage5/workload-mixed-500.json` | Workload E |
| `.local/stage5/workload-slow-200-split.json` | Workload F with fast/paused latency split |
| `.local/stage5/mock-api.mjs`, `.local/stage5/workloads.mjs` | Local-only test rig; gitignored |

**No commit, push, deploy, production change, schema change, or sharding implementation was performed.**
