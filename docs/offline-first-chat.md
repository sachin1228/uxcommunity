# Offline-first chat and DMs

Web and mobile can now read previously synchronized community and DM history
without a network, and a text message composed offline is persisted before it is
sent, survives a restart, and is retried with the same idempotency key.

This document records the audit, the design, what was implemented, the actual
test results, and what is deliberately **not** supported yet.

---

## The guarantee

**Supported**

- History this device already synchronized is readable with no network, after a
  reload, a browser restart, an OS kill of the mobile app, and a cold boot of the
  web shell (production builds, browsers with service workers).
- A text message composed offline is committed to a durable outbox in the same
  transaction as its optimistic bubble, renders immediately, and is retried on
  reconnect, foreground, focus, page load and explicit retry.
- Every attempt for one logical send reuses one client UUID, and the server
  enforces uniqueness on `(user_id, client_nonce)` for community and DM messages.
  A retry racing the original response, a WebSocket echo or another tab returns
  the row the first attempt wrote instead of inserting a second one.
- A queued message is never dropped silently: it either sends, or becomes
  `failed` with a manual retry. Attempt budgets are bounded; permission changes
  fail fast instead of retrying forever.

**Not supported (and not claimed)**

- New messages from other people while this device is disconnected. Catch-up
  happens when connectivity returns, using the existing cursor endpoints and
  realtime reconnect path.
- Offline **attachment** sending. Image sends still use the online path; a text
  bubble is never labelled "queued" when its bytes are not persisted.
- Background execution guarantees. Mobile drains on launch, foreground, realtime
  reconnect and explicit retry — never on a promise that the OS will wake the
  app.
- Delivery/read receipts beyond what the product already had (nothing is
  fabricated locally).

---

## 1. Audit: what existed before

### Read paths

| Surface | Before |
| --- | --- |
| Web community chat (`components/communities/chat/useChatData.ts`) | Bootstrap/page fetch, in-memory `msgCache` module store, cursor pagination, realtime catch-up. Nothing persisted across a reload. |
| Web DMs (`components/direct-messages/hooks/useDmThreadData.ts`) | Same shape with `dmCache`. Nothing persisted. |
| Mobile community chat (`hooks/useChatMessages.ts`) | Bounded (120-row) AsyncStorage window via `lib/chatCache.ts`, replayed for the first frame. Survived restarts, but it is a plain KV blob: no transactions, no per-row status, no checkpoint. |
| Mobile DMs (`app/messages/[id].tsx`) | Same AsyncStorage window per conversation. |
| Conversation lists | Web sidebar store + 30 s DM cache (memory only). Mobile `dmConversationsCache` + `chatCache` list snapshots (AsyncStorage, 7-day TTL). |

### Write paths

Both platforms painted an optimistic bubble, POSTed, then replaced it on 201 and
showed a retry affordance on failure. Idempotency existed **only for DMs**: the
`dm_messages.client_nonce` column and `(user_id, client_nonce)` unique index were
added in `20261012120000_dm_hardening.sql`, and the DM route replays the original
row on a `23505`. Community messages had no nonce column, so a lost 201 could
produce a duplicate on retry. The outbox itself was memory-only: a reload lost
the bubble and the pending request.

### Community vs DMs

- Both use a compound `(created_at, id)` cursor and the same merge rule ("a row
  we already hold wins").
- DMs add request/acceptance state, blocking, report flows and a
  sender/recipient authorization check on every send; they also carry
  `client_nonce` already.
- Reactions, edits and deletions are separate endpoints on both surfaces;
  attachments are R2 uploads performed **before** the message POST.

### What the server already gave us

- Cursor pagination: `?before=` for older history, `?after=` for catch-up.
- Authoritative rows from GET and from the POST response.
- Realtime inserts/edits/deletes/reactions over the existing Durable Object
  protocol.
- DM idempotency, as above.

The only server-side gap was community-message idempotency.

---

## 2. Design

```
packages/offline-chat/        pure domain: merge, outbox state machine, backoff,
                              storage interface, sync controller (no platform code)
apps/web/lib/offline/         IndexedDB adapter, fetch transport, engine singleton,
                              service-worker registration
expo-app-standalone 3/lib/offline/
                              expo-sqlite adapter, fetch transport, engine singleton
```

The controller owns the sequence **hydrate → enqueue/drain → catch-up** and is the
only place that decides when a checkpoint may move. The apps inject storage and a
transport; they keep their own React state and subscribe to controller events, so
there is no second state store.

### Local schema

Both adapters store the same four things per account:

| Store | Key | Purpose |
| --- | --- | --- |
| `messages` | `(conversationKey, id)` | Bounded window (`WINDOW_LIMIT = 200`) of server rows plus queued rows. Indexed by conversation. |
| `checkpoints` | `conversationKey` | `newestTs/newestId` (the `?after=` cursor) and `oldestTs/oldestId` (the `?before=` floor). |
| `conversations` | `conversationKey` | List rows / previews / unread counts. |
| `outbox` | `id` (the client nonce) | Durable outgoing text, with state, attempts, `nextAttemptAt`, lease and the exact POST body. |

Web: `IndexedDB` database `uxcommunity-chat-v1-<userId>`, version 1.
Mobile: `SQLite` file `offline-chat-v1-<userId>.db`, `user_version = 1`, real
transactions (`withTransactionAsync`).

### Outbox state machine

```
enqueue ─▶ queued ──claim──▶ sending ──accepted──▶ (record deleted, bubble "sent")
              ▲                 │
              │                 ├─ retryable ─▶ queued (backoff + jitter)
              │                 ├─ auth (401) ─▶ queued (30 s pause, no budget burn)
              │                 └─ permanent ──▶ failed ──manual retry──▶ queued
```

- `sending` is durable and leased (`OUTBOX_LEASE_MS = 30 s`). A worker that dies
  leaves the record claimable after the lease; two tabs cannot claim the same
  record in one IndexedDB/SQLite transaction. Even a lease violation is harmless
  because the server dedupes on the nonce.
- Backoff: 2 s, 4 s, 8 s … capped at 60 s, ±20 % jitter, `OUTBOX_MAX_ATTEMPTS = 6`.
- Classification: `408/425/5xx` retry, `429` honours `Retry-After`, `401` pauses,
  every other `4xx` (403 blocked, 404 gone, 409, 422 too long…) is permanent.
- Manual retry re-queues immediately, replenishes the attempt budget, and the
  server re-validates membership/block state at send time.

### Idempotency contract

- Client generates one UUID per logical send; the optimistic bubble id is
  `temp-<uuid>`.
- Community POST accepts `client_nonce`, normalized to lower case, only when it
  is a UUID (older clients that sent `temp-…` keep working, just without
  dedupe).
- Migration `20261025120000_community_message_idempotency.sql` adds the nullable
  `uuid` column and a **partial** unique index `(user_id, client_nonce) where
  client_nonce is not null`.
- On `23505` the route returns the original row with `200 { duplicate: true }`
  and does not publish a second realtime event or push.
- DM behaviour is unchanged (`200` replay already existed).

### Checkpoints

`catchUp` asks `?after=` from the checkpoint, commits the rows, **then** advances
the checkpoint to the cursor of the committed rows. A crash between the write and
the checkpoint advance re-fetches the same page; the merge is idempotent, so the
only cost is one duplicate request. `oldest*` only moves backwards, when older
pages are persisted.

### Sync triggers

| Trigger | Web | Mobile |
| --- | --- | --- |
| App start / auth restored | provider activation | `AuthContext.applyUser` activation |
| `online` / offline | yes | no cross-platform event without a dependency |
| Foreground | `visibilitychange` + `focus` | `AppState` `active` |
| Realtime reconnect | `OFFLINE_RESUME_EVENT` from the existing path | `notifyOfflineOnline()` from the realtime client |
| Explicit retry | bubble retry button | bubble retry button |
| Timers | outbox backoff | outbox backoff |

A drain is single-flight per engine (`draining` promise), so a reconnect storm
cannot start parallel workers. Catch-up stays with the existing realtime/focus
logic — this change adds a window revalidation, not a second cursor loop.

### Account isolation

- One **physical** store per member (separate IndexedDB database / SQLite file),
  plus a `userId` check in the domain layer before every write, plus an
  activation generation so a late response from the previous account is dropped.
- Logout deactivates the engine and aborts in-flight requests *before* the
  in-memory caches are cleared; the account's own queue stays on disk (an unsent
  message is not ours to delete) and is unreachable to the next account.
- Service worker caches are per-member (`ux-user-<id>`) and `/api/*` is never
  cached — message data lives in IndexedDB, not in a shared HTTP cache.
- No message content, token or attachment data is logged.

### Failure posture

If IndexedDB/SQLite is unavailable, blocked, corrupt or has an unknown schema
version, activation returns `null` and the app runs its existing online path.
Nothing is deleted implicitly; `clearOfflineAccount(userId)` is the explicit wipe.

---

## 3. What changed

### New shared package

- `packages/offline-chat/src/{types,ids,messages,outbox,backoff,storage,sync,memory-storage,index}.ts`
  — merge rules, outbox policy, storage contract, controller, and an in-memory
  adapter used by the tests.
- Tests: `messages.test.ts`, `outbox.test.ts`, `sync.test.ts` (38 cases).

### Web

- `apps/web/lib/offline/indexed-db.ts` — IndexedDB adapter (raw IDB; Dexie was
  evaluated and rejected: the read path is three indexed reads and one bounded
  window write, and a ~25 KB dependency plus its own migration story was not
  worth it).
- `apps/web/lib/offline/transport.ts` — community + DM POST/GET, `client_nonce`,
  error classification, `Retry-After`.
- `apps/web/lib/offline/engine.ts`, `components/offline/OfflineChatProvider.tsx`
  — singleton lifecycle, connectivity/focus triggers, service-worker
  registration. Mounted once by `app/dashboard/layout.tsx`.
- `apps/web/lib/offline/rows.ts` — cached-row ⇄ UI-message mapping.
- `apps/web/public/sw.js`, `lib/offline/service-worker-client.ts` — app-shell
  only, per-member document cache, never `/api/*` or RSC payloads.
- `useChatData.ts`, `useDmThreadData.ts` — hydrate from the local window before
  the network request, subscribe to controller events, write the visible window
  through after a 400 ms debounce, revalidate on resume.
- `useSendMessage.ts`, `useDmSend.ts` — text sends go through `enqueueText` on
  both the online and offline path (same nonce either way); confirmations update
  the bubble; retry calls `retry(nonce)`.
- `MessageBubble.tsx` — `queued` gets a clock glyph; `sending` still pulses;
  `failed` keeps the retry affordance.
- `useSidebarCommunities.ts`, `useDmConversations.ts` — conversation-list rows
  persisted and seeded on mount.
- `session-cache.ts` — deactivate/abort before clearing caches.
- `next.config.js` — `@uxcommunity/offline-chat` in `transpilePackages`.
- `database.types.ts` — `community_messages.client_nonce`.

### Mobile

- `lib/offline/sql-driver.ts` — the minimal SQL surface, backed by `expo-sqlite`
  lazily, so the same schema and queries run under `node:sqlite` in tests.
- `lib/offline/storage.ts` — SQLite adapter, real transactions, per-member file.
- `lib/offline/transport.ts`, `engine.ts` — API client with the existing cookie
  session; activation from `AuthContext`, `AppState` foreground drain.
- `lib/offline/rows.ts` — cached-row mapping and nonce reconciliation.
- `hooks/useChatMessages.ts`, `hooks/useSendMessage.ts`, `hooks/useDmSend.ts`,
  `app/messages/[id].tsx`, `app/messages/index.tsx` — local-first paint, stable
  listener, durable text sends, retry through the controller, conversation list
  persistence.
- `components/chat/MessageBubble.tsx` — `queued` state.
- `metro.config.js` — watch the monorepo package; `app.json` + `package.json` —
  `expo-sqlite ~16.0.10` (SDK 54).
- The existing AsyncStorage `chatCache` is kept as the warm first-frame cache;
  SQLite is the durable store.

### Server

- `supabase/migrations/20261025120000_community_message_idempotency.sql`
- `apps/web/lib/communities/message-request.ts` — parse/normalize `client_nonce`.
- `apps/web/app/api/communities/[id]/messages/route.ts` — insert the nonce,
  replay on `23505`, 409 for a nonce reused in another community.

---

## 4. Deployment requirements

1. **Apply the migration**
   `supabase/migrations/20261025120000_community_message_idempotency.sql`
   (additive, nullable column + partial unique index; no backfill, no rewrite).
   Until it is applied, the API's `client_nonce` insert fails — deploy the
   migration **before** the web app.
2. No realtime protocol change, no new Worker binding, no new environment
   variable.
3. Mobile needs a rebuilt binary for `expo-sqlite` (config plugin was added);
   an already-installed binary keeps working through the online-only path.

---

## 5. Test results

Run on 2026-10-25, locally, with the commands below.

| Command | Result |
| --- | --- |
| `npm run test:offline-chat` | 38 passed / 0 failed |
| `npm run test:offline-web` | 14 passed / 0 failed (includes 6 IndexedDB adapter cases and the `client_nonce` body parser) |
| `npm run test:offline-mobile` | 5 passed / 0 failed (SQLite schema, enqueue/claim lease, restart, account guard) |
| `npm run test:community-idempotency` | 8 assertions passed / 0 failed (local Postgres) |
| `cd apps/web && npx tsc --noEmit` | clean |
| `cd "expo-app-standalone 3" && npx tsc --noEmit` | clean |
| `npm run build` (web, production) | success |
| `npx expo export --platform android` | success (Metro resolves the shared package) |
| Existing suites: `test:community-chat-pagination`, `test:chat-scroll`, `test:chat-media`, `test:dm-client-cache`, `test:dm-read-floor`, `test:session-cache`, `test:request-cache`, `test:dedupe`, `test:content-sync`, `test:sidebar-*`, `test:mobile-{cache,bootstrap,screen-cache,realtime,communities,chat-*}` | all passed |

The bundled engine tests cover: merge/ordering/dedupe, nonce reconciliation,
checkpoint advancement only after commit, catch-up page bounds, outbox claim
leases, expired-lease recovery, backoff/jitter ceiling, `Retry-After`, permanent
vs retryable classification, account isolation, send-before-realtime and
realtime-before-send races, duplicate responses, and restart with a pending
message.

`npm run lint` reports two **pre-existing** `react-hooks/set-state-in-effect`
errors (`useChatData.ts:472`, `useDmThreadData.ts:161`). They are present at
`HEAD` and untouched by this change; new files lint clean.

---

## 6. Known limitations

1. **Attachments are online-only.** `useSendMessage`/`useDmSend` only take the
   durable path when there is no image; an image send needs the R2 upload first.
   Queueing attachments safely requires copying the bytes out of the picker's
   temporary URI into app storage, tracking the upload and send as separate
   stages, and garbage-collecting abandoned uploads — deliberately left as a
   follow-up rather than shipping a "queued" label over an ephemeral URI.
2. **No offline wake-ups.** Web relies on page load/`online`/focus; mobile on
   launch/foreground/reconnect. Background Sync is not used: it is unsupported
   on iOS Safari and the outbox would still need the same recovery path.
3. **Multi-device** is eventual: two devices can both queue the same text, and
   each is its own message (there is no cross-device draft identity). One device's
   queue is never sent under another member's session.
4. **Local data is not encrypted at rest.** It is protected by the origin
   (IndexedDB) and the app sandbox (SQLite), like the existing session cookie.
   A shared unlocked device can read the signed-in member's local history;
   device-level encryption is out of scope.
5. A very old cached window is bounded to 200 rows per conversation; older
   history is fetched again when scrolled to (online) or simply unavailable
   offline if it was never synchronized.
6. Community messages written by a client older than this change have no nonce
   and are therefore not deduped (they could not have been retried safely
   anyway).

---

## 7. Manual test checklist

1. **Web history offline** — open a community chat and a DM, scroll a little, go
   offline (DevTools), reload. Both conversations render their window; no
   spinner; the composer still works.
2. **Web queued send** — offline, send three texts. They show the queued clock.
   Reload the page: they are still there, still queued. Go online: all three
   become sent exactly once (check the network tab: one POST each, `201`).
3. **Lost response** — throttle to offline *after* the POST is sent, or use
   DevTools request blocking on the POST. The retry must return `200
   {duplicate:true}` and leave exactly one bubble.
4. **Mobile restart** — airplane mode, send two texts, force-quit the app,
   reopen: both bubbles are queued. Re-enable the network, foreground the app:
   both send once.
5. **Catch-up** — with the app closed, send from another account/device. Reopen
   online: the new messages appear in order, no duplicates, unread counters
   update.
6. **Edits/deletes/reactions while offline** — perform them from another device,
   then reconnect the first device: the visible window is revalidated.
7. **Rejected send** — block the sender from the other side, or leave the
   community, then retry a queued message: it becomes `failed` (never "sent"),
   with a readable reason and no infinite retries.
8. **Account switch** — sign out, sign in as another member on the same browser:
   no previous history, no previous queue, and the first member's queue is still
   there after signing back in.
9. **Online regressions** — typing indicators, presence, push notifications,
   unread counts, reactions and image sends still behave as before.
10. **Cold shell offline (web, production build)** — after one online visit, go
    offline and reload: the app shell loads from the service worker and history
    comes from IndexedDB. `curl`/DevTools must show no `/api/*` entries in Cache
    Storage.
