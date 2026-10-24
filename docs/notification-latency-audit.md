# Notification latency audit — DMs and activity pushes

**Date:** 2026-10-24 · **Scope:** production (`app.uxcommunity.in`), Android (`in.uxcommunity.app`, Pixel emulator `emulator-5554`), plus the server code that fans messages out.
**Question:** another member sends a message — how long until the notification exists in the shade, and why?
**Status:** the code changes in §10 are implemented on this branch; §13 lists what is left (infrastructure-only).

---

## 1. Verdict

**Median ≈ 4.2 s from "sender hits send" to "notification in the tray". Typical 3.4–4.6 s. 5.5 s with the app process killed. 7.6 s worst observed (cold Worker isolate).**

Only ~20 % of that happens after FCM accepts the message. The split (medians from 11 probes):

| Stage | What happens | Median | Range |
|---|---|---|---|
| **A. Sender → DB commit** | POST `/api/dm/conversations/[id]/messages` runs 7–9 sequential remote hops before the row exists | **≈ 2.27 s** | 1.6 s – 5.3 s |
| **B. DB commit → FCM accepted** | `after()` publishes to realtime, then queries push tokens, then mints OAuth + sends FCM | **≈ 1.21 s** | 1.17 s – 1.37 s |
| **C. FCM → notification posted** | Play Services wake + `ChatFirebaseMessagingService` (avatar downloads) + `notify()` | **≈ 0.83 s** | 0.34 s – 1.94 s |

C is 0.34–0.43 s when the sender has **no avatar** (notification draws initials locally) and 0.74–0.83 s when they do — the difference is the **two** avatar downloads the service does before it posts (see §5-D). With the app process killed, C becomes **1.94 s**.

**Community chat is worse:** 4.68 s, 5.55 s and 6.40 s end-to-end in three probes, with the server fan-out alone at **1.93–1.96 s** (five sequential DB batches) and the same 0.8 s device stage. It is fixed by the same two levers (parallel publish/push, fewer fan-out round trips).

The two big levers are therefore **A** (the message row is slow to exist) and **B** (the push is serialized behind the realtime publish and three separate Supabase queries).

---

## 2. Pipeline as it exists today

```
sender app
  └─ POST /api/dm/conversations/[id]/messages           apps/web/app/api/dm/conversations/[id]/messages/route.ts
       middleware.ts → Upstash global rate limit         (~1 network hop)
       requireSession → users liveness SELECT            (~1 DB hop)
       rateLimit ×2 (Upstash, parallel)                  (~1 network hop)
       dm_conversations SELECT (access)                  (~1 DB hop)
       users + designer_profiles SELECT (parallel)       (~1 DB hop)
       dm_blocks SELECT (block check)                    (~1 DB hop)
       dm_messages INSERT                                (~1 DB hop)
       dm_conversations SELECT (request state)            (~1 DB hop)
     └─ response 201
     └─ after():
          publishDmEvent → rt.uxcommunity.in/publish     (~1 HTTP hop, retried up to 3×3 s)
          sendDirectMessagePush
            push_tokens + notification_preferences       (~1 DB hop, parallel)
            fcm_tokens                                   (~1 DB hop, sequential)
            FCM OAuth mint (cold isolate)                (~1 HTTP hop)
            FCM v1 messages:send                         (~1 HTTP hop)
              └─ Play Services → ChatFirebaseMessagingService
                   download(avatar) ×2                   (~2 public-media fetches)
                   ShortcutManagerCompat work
                   NotificationManager.notify()
```

Activity/bell notifications take a different but similar path: `deferNotification()` → `after()` → `create_notification` RPC → `sendActivityPush()` → its own token query + FCM send.

---

## 3. How this was measured

Production, three real accounts (senders: `johndoe@gmail.com`, `sundarp1228@gmail.com`; recipient: `patilsachin1228@gmail.com`, signed in on the emulator).

Per probe (11 DM probes + cold-start probe):

1. `t0` — sender's HTTP POST issued from the host.
2. `created_at` — the message row's timestamp returned by the API (Postgres clock).
3. `payload timestamp` — read back from the device: `dumpsys notification --noredact` exposes `android.messages[0].time` (the FCM data payload's `timestamp`, stamped by the Worker immediately before the FCM call).
4. `posted` — `mUpdateTimeMs` of the notification record, converted with the measured device↔host clock offset (`adb shell date +%s%3N` vs `Date.now()`, ≈ −390 ms; the emulator clock drifts slowly, so it was re-measured per probe).
5. `notification_enqueue` events in `logcat -b events` were used to cross-check the posted time.

Fixed-overhead probes (`curl` timing to production, warm TLS where noted):

| Probe | TTFB | Reading |
|---|---|---|
| `/api/healthz` (skips the middleware rate limit, no DB) | 0.45–0.48 s | Cloudflare + OpenNext baseline for a trivial route |
| `/api/auth/me`, **no cookie** (middleware Upstash + route Upstash, no DB) | 0.81–1.18 s | +0.35–0.7 s for two Upstash calls |
| `/api/auth/me`, with cookie (+ two sequential Supabase SELECTs) | 1.69–2.21 s | +0.8 s for two DB round trips |
| `/api/dm/conversations` (one RPC, `verifyActive:false`) | 1.22–1.29 s warm / 2.95 s cold | one RPC + baseline |
| static 404 asset | 0.80–1.88 s | the distance/connection cost alone |
| avatar image `media.uxcommunity.in` | 0.46–0.65 s, `cf-cache-status: DYNAMIC` | seen twice per notification |

Server-Timing from the actual DM sends (3 of the samples):

```
total;dur=1382 auth;dur=0    rate_limits;dur=156 conversation_query;dur=362 sender_profile;dur=362 message_insert;dur=342
total;dur=1694 auth;dur=343  rate_limits;dur=149 conversation_query;dur=342 sender_profile;dur=338 message_insert;dur=342
total;dur=2353 auth;dur=350  rate_limits;dur=153 conversation_query;dur=360 sender_profile;dur=995 message_insert;dur=339
total;dur=4280 auth;dur=1359 rate_limits;dur=235 conversation_query;dur=1031 sender_profile;dur=1224 message_insert;dur=366
```

Note the bimodality: a Supabase round trip is **~340 ms warm, ~1.0–1.4 s whenever it opens a fresh connection**. Every extra query in the chain costs that much.

---

## 4. Raw samples

DM from a sender **with** an avatar (john doe → Sachin Patil):

| # | send (HTTP) | t0 → row committed | commit → FCM | FCM → posted | total |
|---|---|---|---|---|---|
| 1 | 3253 | 2611 | 1178 | 833 | 4622 |
| 2 | 2190 | 1606 | 1175 | 809 | 3590 |
| 3 | 2566 | 1987 | 1188 | 820 | 3995 |
| 4 | 3175 | 2289 | 1173 | 742 | 4204 |

An earlier batch of four probes with the same setup produced **4.16 s, 4.56 s, 7.41 s and 7.64 s** end-to-end after the same clock correction; those ran against cold Worker isolates (row commit alone took 1.99–5.31 s), which is where the 7.6 s worst case comes from. Including them, the medians in §1 are computed over 8 avatar samples.

DM from a sender **without** an avatar (sundar pichai → Sachin Patil):

| # | send | commit | commit → FCM | FCM → posted | total |
|---|---|---|---|---|---|
| 1 | — | 2177 | 1225 | 429 | 3831 |
| 2 | — | 1933 | 1180 | 389 | 3502 |
| 3 | — | 1832 | 1180 | 336 | 3348 |

App process killed (`adb shell am kill`) before the send: commit 2325, commit → FCM 1241, FCM → posted **1939**, total **5505**.

---

## 5. Root causes, ranked

### A. The send route is a chain of 7–9 remote hops (~2.3 s) — `apps/web/app/api/dm/conversations/[id]/messages/route.ts`
Every hop is sequential and each one is a network round trip to Supabase or Upstash:

- `middleware.ts:53` — Upstash global rate limit on **every** request (~0.2–0.4 s, not even counted in the route's Server-Timing).
- `session.ts:200` — `assertUserActive()` SELECTs `users` on every write request. Its 15 s cache (`activeUserChecks`) is per-isolate, so on a cold isolate it always runs (measured 0–1359 ms).
- `route.ts:148` / `:152` — access query and sender profile (two more SELECTs) in parallel, but measured 342–1224 ms.
- `route.ts:182` — separate block check.
- `route.ts:251` — the insert.
- `route.ts:341` — separate request-state read **after** the insert.

A Cloudflare Worker that runs in Marseille talking to a Supabase project far enough away that a fresh connection costs ~1 s makes this the dominant term. The row exists 1.6–5.3 s after the sender taps send; the notification cannot be created before that.

### B. The push is serialized behind the realtime publish and 3 more DB hops (~1.2 s) — `route.ts:370-419`, `apps/web/lib/push/direct-message.ts:162-181`
- `after()` **awaits** `publishDmEvent()` (one HTTP call to `rt.uxcommunity.in`, up to 3 attempts × 3 s timeout — a hung realtime service delays the push by up to ~10 s) **and only then** starts the push.
- The push reads `push_tokens` + `notification_preferences` in one round trip, then `fcm_tokens` **sequentially** — a direct-message has 6 push tokens/preference rows to read and pays 2 round trips.
- On a cold isolate it also mints an FCM OAuth token first (`fcm.ts:131`), a Google round trip.
- For a member with both an iPhone and an Android, `await sendExpo(expoNow)` (`direct-message.ts:223`, 8 s deadline) runs **before** the Android FCM call.

### C. Network geology: the app is answered from Marseille, media is never edge-cached
- Every API response carries `cf-ray: …-MRS` for this Indian client, while Cloudflare answers `*.supabase.co` from `BOM` on the same connection. So each API call pays ~130 ms + TLS to Europe before the Worker even starts.
- `media.uxcommunity.in` returns `cache-control: public, max-age=31536000, immutable` but **`cf-cache-status: DYNAMIC`** — the edge is not caching avatars. Each fetch costs 0.46–0.65 s, and the notification fetches the same avatar twice.

### D. The Android service downloads the avatar twice before it posts — `ChatFirebaseMessagingService.kt:181, 193, 483`
```kotlin
val conversationAvatar = imageUrl?.let { download(it) } ?: …   // line 181
val senderAvatar = data["senderAvatarUrl"]…?.let { download(it) } … // line 193
```
For a DM both fields are the **same** URL. Two sequential `HttpURLConnection` fetches (5 s connect + 5 s read timeout each) run before `notify()`. Measured cost: 0.34–0.43 s (no avatar) vs 0.74–0.83 s (avatar) → **~0.4 s**, and a worst case of 10 s on a bad network (which can exceed the FCM service's window and produce no notification at all). The same file is duplicated at `plugins/chat-notifications/ChatFirebaseMessagingService.kt` (byte-identical) — both must change.

### E. Cold-isolate taxes
- `cachedToken` in `fcm.ts` and `activeUserChecks` in `session.ts` are module state; with spread-out traffic most requests land on a fresh isolate and pay the OAuth mint / liveness query again.
- The ~1 s Supabase outliers in Server-Timing are almost certainly connection setup (TLS + pooler) — they appear whenever a batch of queries starts after an idle gap.

### F. No measurement of the thing being complained about
There is no `push.sent` event with a timestamp, no device-side "posted" telemetry, and the native service swallows every exception (`catch (_: Exception)`) — a notification that never appears leaves no trace anywhere.

---

## 6. Fix plan

### P0 — server, no schema change (expected −1.5 s)

| # | Change | Where | Expected |
|---|---|---|---|
| 1 | Start the push **in parallel with** `publishDmEvent` (`Promise.allSettled([publish, push])`), so a slow/retrying realtime publish can never delay the tray notification | `route.ts:348-419` | −0.1…−0.4 s, removes a ~10 s worst case |
| 2 | Fold `fcm_tokens` into the existing `Promise.all` (or replace all three reads with one `dm_push_targets(user_id)` RPC) | `direct-message.ts:162-181` | −0.35…−1.0 s |
| 3 | Send FCM first, then Expo for the iOS devices; don't await Expo before FCM | `direct-message.ts:223` | −0.1…−0.5 s for mixed-device members |
| 4 | Cache the FCM access token in the Workers Cache API / KV keyed by `client_email` (50 min TTL) and add `AbortSignal.timeout` to the OAuth fetch | `fcm.ts:129-190` | −0.2…−0.4 s per cold isolate, removes a hang |

### P0 — sender path (expected −0.7…−1.5 s)

| # | Change | Where | Expected |
|---|---|---|---|
| 5 | One `send_dm_message(conversation, user, content, image, reply, nonce)` RPC doing access + block + reply anchor + idempotent insert + request-state in one statement batch (the codebase already uses this pattern for `create_notification` and `load_dm_conversations`) | `route.ts:148-345`, new migration | −0.7…−1.4 s |
| 6 | Return the sender's name/avatar from the same RPC (or a join) instead of two parallel SELECTs | `route.ts:152` | −0.3…−0.6 s on the slow path |
| 7 | Drop the per-request `assertUserActive` DB check for writes: put a `status`/`session_version` claim in the JWT and invalidate on block/delete, or cache the check in KV (60 s) | `session.ts:129-200` | −0.35…−1.35 s on cold isolates |
| 8 | Replace the Upstash global limit in `middleware.ts` (and the route's `rateLimit` calls) with the native Workers Rate Limiting binding (no network hop, runs in-colo) | `middleware.ts:53`, `lib/auth/rate-limit.ts` | −0.2…−0.5 s per request |

### P1 — Android (expected −0.4 s, removes the 10 s failure mode)

| # | Change | Where |
|---|---|---|
| 9 | Download **one** bitmap and reuse it for both slots when `senderAvatarUrl == imageUrl` (always true for DMs), and keep a small in-memory/disk LRU keyed by URL so a conversation's repeated pushes reuse it | both `ChatFirebaseMessagingService.kt` copies, lines 181/193 |
| 10 | Cut the per-download timeouts to ~1.5 s and post the notification even if the fetch fails | same, line 483 |
| 11 | Call `.setWhen(payload timestamp)` so the shade shows/orders by the send time, not the local build time | same, builder chain |
| 12 | Optional: post immediately with the initials avatar, then `notify()` again with the downloaded bitmap | same |

### P1 — infrastructure (the biggest ceiling)

| # | Change | Why |
|---|---|---|
| 13 | Make `media.uxcommunity.in` actually cache: it returns `cf-cache-status: DYNAMIC` despite `immutable`. Add a Cache Rule (Edge TTL / Cache Everything for `/avatars/*`, `/media/*`) or front it with a Worker that uses the Cache API | removes ~0.4–1 s from every notification and every avatar in the app |
| 14 | Investigate why `app.uxcommunity.in` resolves Indian clients to **MRS** while `supabase.co` lands in **BOM**; the Worker and the database should be in the same region as each other, ideally near the users. Options: fix the zone routing, try Smart Placement, or move the Supabase project | every DB hop is 340 ms warm / 1 s cold and there are 6–9 of them |
| 15 | After 5/7 land, consider a Supabase webhook → Cloudflare Queue for the fan-out, so pushes don't depend on `after()` at all | durability + removes the last coupling to the request |

### P2 — observability

| # | Change |
|---|---|
| 16 | Log `push.sent` with `message_created_at`, `push_started_at`, `tokens`, `transport` and `fcm_ms`; have the Android service log (and optionally POST) `posted_at`. p95 of "created → posted" is the metric that matters. |
| 17 | Alert on `push.dm_failed` rate and on `transientFailures`, and on the realtime publish retry log. |

---

## 7. Expected outcome

| After | Median end-to-end |
|---|---|
| today | ≈ 4.2 s |
| P0 server (#1–8) | ≈ 2.0–2.5 s |
| + P1 Android (#9–12) | ≈ 1.6–2.0 s |
| + P1 infra (#13–14) | **< 1 s** (target 0.6–0.9 s, dominated by FCM delivery) |

---

## 8. Correctness findings found while auditing (not just latency)

1. `fcm.ts:169` — the OAuth token fetch has **no timeout**; a hung Google socket stalls the whole `after()` block (and therefore every later push in that invocation).
2. `realtime/publish.ts:58-67` — 3 attempts × 3 s timeout means a black-holed realtime service delays the DM push by up to ~10 s (see fix #1).
3. `ChatFirebaseMessagingService.download()` — 5 s + 5 s timeouts × 2 fetches, all before `notify()`; on a poor network the notification can be lost entirely.
4. The native service swallows all exceptions with no log; there is no way to tell "no push was sent" from "push arrived but drawing failed".
5. `direct = fcmConfigured && fcmTokens.length > 0` — a member whose FCM token went stale falls back to Expo only for *provider-wide* failures (`delivered === 0`); a single-token transient failure has no Expo fallback.
6. Expo fallback draws a **system** notification (title/body payload) while the FCM-direct path draws the custom MessagingStyle — two different layouts depending on transport, and an old app build shows the plain one.
7. iOS goes through Expo (one extra provider hop); it was not measured here.
8. `notification_preferences` is read with `select("*")` on every push; only three columns are used.

---

## 9. Caveats

- Measured from one host/network (India → Cloudflare MRS) with the app on an Android emulator; carrier latency and Doze add more on a real phone.
- The emulator clock drifts (~0.4 s); every device timestamp was normalized against a per-probe `adb shell date` reading. Residual error is ~±50 ms.
- Postgres `created_at` and Cloudflare time are different clocks; the "commit → FCM" stage is unaffected (both endpoints are Cloudflare/device), the "t0 → commit" stage could be off by the Postgres clock skew (tens of ms).
- iOS/Expo delivery, Doze/battery-saver behaviour, and multi-device fan-out were not exercised.
- The numbers in §1–§4 were taken from the deployed build **before** the changes in §10; the post-deploy numbers have not been re-measured yet.

---

## 10. What this branch changes

### Server — DM

| Change | File |
|---|---|
| The realtime publish, the request-state event and the device push now start together (`Promise.allSettled`) instead of the push waiting for the publish and its retries | [route.ts](apps/web/app/api/dm/conversations/[id]/messages/route.ts#L411) |
| `push_tokens`, `notification_preferences` and `fcm_tokens` are read in **one** round trip (was two) | [direct-message.ts](apps/web/lib/push/direct-message.ts#L197) |
| iOS (Expo) and Android (direct FCM) sends are in flight together; the Android Expo fallback still fires only after a provider-wide FCM failure | [direct-message.ts](apps/web/lib/push/direct-message.ts#L296) |
| The block check, pending-request count and reply-anchor lookup share one round trip (was three sequential) | [route.ts](apps/web/app/api/dm/conversations/[id]/messages/route.ts#L228) |
| Liveness (`assertUserActive`) starts at the top of the request and is awaited before the insert, so it no longer sits in front of every read | [session.ts](apps/web/lib/auth/session.ts#L133) · [route.ts](apps/web/app/api/dm/conversations/[id]/messages/route.ts#L149) |
| `accepted` is terminal: a normal send answers from the row it has instead of re-reading the conversation afterwards | [route.ts](apps/web/app/api/dm/conversations/[id]/messages/route.ts#L371) |

### Server — community chat

| Change | File |
|---|---|
| Publish and push start together | [message-publish.ts](apps/web/lib/communities/message-publish.ts#L93) |
| Community header + mute-column probe share a round trip | [chat.ts](apps/web/lib/push/chat.ts#L489) |
| Preferences are read alongside the tokens (one less fan-out round trip) | [chat.ts](apps/web/lib/push/chat.ts#L579) |

### Server — FCM

| Change | File |
|---|---|
| OAuth token exchange has a 10 s timeout (a hung Google socket could stall the whole `after()`) | [fcm.ts](apps/web/lib/push/fcm.ts#L254) |
| The minted access token is shared across isolates through the Workers Cache API (55 min), so a cold isolate no longer pays a Google round trip before its first push | [fcm.ts](apps/web/lib/push/fcm.ts#L174) |

### Android

| Change | File |
|---|---|
| A DM's avatar is downloaded **once** and reused for both notification slots (the payload carries the same URL twice); other layouts still fetch their two images | [ChatFirebaseMessagingService.kt](expo-app-standalone%203/android/app/src/main/java/in/uxcommunity/app/ChatFirebaseMessagingService.kt#L187) |
| A 12-entry LRU caches decoded conversation avatars across pushes | same, companion object |
| Avatar fetch timeouts cut from 5 s + 5 s to 2 s + 2 s | same, `download()` |
| `.setWhen(payloadTimestamp)` — the shade shows the send time, not the local draw time | same, builder |

The plugin copy at `expo-app-standalone 3/plugins/chat-notifications/` is byte-identical and updated too (prebuild copies it into `android/`).

## 11. Verification on this branch

- `npx tsc --noEmit -p apps/web/tsconfig.json` — clean.
- `npx eslint` on every changed file — clean.
- `npm run test:push-budget` (17), `npm run test:push-fanout` (71), the four DM suites, and `direct-message.test.ts` (11, including three new tests: the three reads share one round trip, both transports start before either answers, the fallback still only follows an FCM failure) — all pass.
- `./gradlew :app:compileDebugKotlin` — the Android service compiles.

## 12. Expected result after deploy

| | Before | After the server changes | After the Android build ships |
|---|---|---|---|
| DM end-to-end | ≈ 4.2 s | ≈ 2.0–2.5 s | ≈ 1.6–2.0 s |
| Community chat end-to-end | ≈ 5.5 s | ≈ 3.2–4.0 s | ≈ 2.8–3.5 s |

With §13 done (Worker + DB in one region near users, media actually cached) the same paths should land **under 1 s**, dominated by FCM delivery.

## 13. What is still open (infrastructure, not code)

1. `app.uxcommunity.in` is answered from **MRS** for an Indian client while `supabase.co` lands in **BOM**; every DB hop costs 340 ms warm / 1 s cold and there are 4–9 of them. Fix the zone routing or enable Smart Placement, and co-locate the Supabase project.
2. `media.uxcommunity.in` returns `cf-cache-status: DYNAMIC` despite `cache-control: immutable` — avatars are never edge-cached. A Cache Rule for the media host removes ~0.4–1 s from every notification (and every avatar in the app).
3. The Upstash global rate limit in `middleware.ts` still costs ~0.2–0.4 s per request; the Workers Rate Limiting binding would remove the network hop without weakening the limit.
4. There is still no push-latency telemetry (`push.sent` with timings, device `posted_at`), so §12 can only be proven by re-running the method in §3 after a deploy.
