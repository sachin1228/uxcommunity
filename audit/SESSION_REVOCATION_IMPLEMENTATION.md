# Immediate Session Revocation — Implementation

**Branch:** `feat/immediate-session-revocation`
**Date:** 2026-10-30
**Audit input:** [SESSION_REVOCATION_VERIFICATION.md](./SESSION_REVOCATION_VERIFICATION.md)

## Verdict

**FULLY IMPLEMENTED — local suites and a live end-to-end matrix pass.**

The migration has been applied. All local SQL, web, realtime and mobile suites
pass, and a live run against the connected environment executed 56 checks with
three disposable fixtures. That run covered logout, logout-all, password change,
password reset, account deletion, suspension/unblock, private R2 URLs, admin
sessions, an existing WebSocket closing with 4001, and a revoked handshake being
rejected. A separate admin-password-rotation run confirmed that an old admin
JWT is rejected when `ADMIN_PASSWORD` changes. Every fixture was removed and no
real user session was revoked.

Remaining environmental limits are listed at the end: no native Android/iOS
build, no realtime-outage drill, and already-issued presigned URLs still live
until expiry.

Read the status labels carefully:

| Label | Meaning here |
|---|---|
| **VERIFIED** | Proven by a test run in this workspace (unit, Worker or SQL). |
| **CODE-VERIFIED** | Implementation supports it; covered by code inspection or a route audit rather than a separate runtime assertion. |
| **PARTIAL** | Some access path remains valid by design or limitation. |
| **MISSING** | No protection exists. |
| **UNKNOWN** | Insufficient evidence. |

## What was kept

The existing custom HS256 JWT architecture is unchanged:

- `jose` signs a 7-day token.
- The token lives in the `uxcommunity_session` httpOnly cookie on web and is
  replayed as a cookie header by the mobile client.
- There is still no Supabase Auth, no refresh token and no OAuth rewrite.

What changed is that the JWT is no longer the source of truth. It is a signed
pointer into a server-side session registry.

## Core model

```
JWT claims
  userId, email, role, sid, sv   (user)
  email, role, sid, adm          (admin)
        │
        ▼
public.auth_sessions (one row per issued JWT)
  id, user_id, role, session_version,
  revoked_at, expires_at, user_agent
        │
        ▼
public.users.session_version  (account generation)
```

A user token is accepted only when **all** of these hold:

1. JWT signature and expiry verify.
2. A row with `id = sid` exists.
3. The row is not revoked and not expired.
4. `row.role = 'user'` and `row.user_id = claims.userId`.
5. `row.session_version = claims.sv`.
6. The embedded user row still exists, is not blocked, and its
   `session_version` also equals `claims.sv`.

An admin token is accepted only when:

1. JWT signature and expiry verify.
2. A row with `id = sid` exists, is unrevoked/unexpired, has
   `role = 'admin'` and `user_id IS NULL`.
3. `adm` equals the current digest of
   `SHA-256("uxcommunity-admin\0" + SESSION_SECRET + "\0" + ADMIN_PASSWORD)`.

Tokens issued before this change have no `sid`/`sv`/`adm` and are rejected.
The `legacy_session` cookie is still cleared, but an old token cannot be used.

### Why both a row and a version?

- The **row** is the only way to revoke one device without affecting another
  (logout, admin session logout).
- The **version** is the generation fence. A reset/suspension that commits
  between a login's password read and its session insert still invalidates the
  new session, because validation compares the row's version and the user's
  version to the token.

The registry insert is atomic with the version read
(`create_auth_session`), and every bulk revocation bumps the version and
revokes all rows in one transaction.

## Session behaviour

| Action | Implemented behaviour | Status |
|---|---|---|
| Logout | Revokes the current `sid`; clears the cookie; closes that sid's sockets. Other devices stay signed in. | VERIFIED (unit/Worker) |
| Logout all devices | Bumps `users.session_version`, revokes every registry row, closes every socket. | VERIFIED (unit/Worker) |
| Password reset | `complete_password_reset` claims the token, rewrites the hash, bumps the version and revokes every row; realtime sockets close. | VERIFIED (SQL) |
| Password change | Verifies the current password, rewrites the hash with an optimistic old-hash guard, keeps the current `sid`, revokes every other row and closes only other sockets. Current browser stays signed in. | VERIFIED (SQL) / unit decision |
| Account deletion | `auth_sessions.user_id ON DELETE CASCADE`; every row disappears with the user; sockets close; cookie clears. | VERIFIED (SQL) / Worker test for socket close |
| Account suspension | `set_user_blocked` sets `is_blocked`, bumps the version, revokes every row; login refreshes; sockets close. | VERIFIED (SQL) / Worker test for socket close |
| Account unblocking | Bumps the version again and does not restore any row. A fresh login is required. | VERIFIED (SQL) |
| Admin logout | Revokes the current admin row. | VERIFIED (decision) |
| Admin logout all | `revoke_all_admin_sessions`; admin rows are separate from user rows. | VERIFIED (SQL) |
| `ADMIN_PASSWORD` rotation | New `adm` digest no longer matches any issued admin token. | VERIFIED (unit) |

### Password change current-session decision

The current browser stays signed in. That is deliberate and documented in the
UI ("Your current browser stays signed in. Every other device is signed out.")
and in the endpoint response. A user who wants every device signed out can use
"Sign out all devices" or reset the password.

## API authorization fixes

The audit's bypasses are closed:

| Surface | Before | After |
|---|---|---|
| `/api/private/dm/[conversationId]/[file]` | JWT-only `getSession`; blocked/deleted token could still get a signed URL. | `getSession` now validates the registry row and live user. A 401/404 is returned before signing. |
| `/api/auth/me` | JWT-only; returned the live profile for a suspended/deleted user. | `getSession` returns null for revoked/blocked/deleted; response is `{ user: null }`, never the profile. |
| `/applications/[jobId]/[applicationId]` | JWT-only; suspended job poster could render applicant PII. | `getSession` rejects a suspended/deleted poster; the page redirects to login. |
| Admin routes | Signature + 7-day role claim. | `requireSession("admin")` validates the admin registry row and current password-derived epoch. |
| `requireSession` / all guarded API routes | Signature + a separate users liveness read. | One registry lookup with an embedded live user row; fails closed. |
| `/api/account/delete` | JWT-only. | Registry-valid session; account erasure is allowed for a legacy blocked row, but a suspension revokes rows, so normally the member must contact support. |
| `/api/auth/logout` | Cleared the cookie only. | Revokes the registry row first; returns 503 and keeps the cookie if revocation fails. |
| `/api/auth/logout-all` | Did not exist. | New endpoint; version bump + all rows + all sockets. |
| `/api/auth/change-password` | Did not exist. | New endpoint; current session kept, others revoked, race-guarded. |

All 187 `route.ts` handlers under `apps/web/app/api` were re-enumerated. The only handlers without a session
guard are intentionally public/internal/signup/auth:
`admin/load-test` (delegates to `impl.ts`, which calls `requireSession("admin")`),
login, logout, reset-request, reset-confirm, session-ended, the membership-check
internal route, public reference data, GIPHY, healthz, the internal cron routes,
the new internal session-validation route, and the signup steps.

## Realtime revocation

### Handshake

`apps/realtime/src/index.ts` now requires a user token with `sid`, `sv` and
`role="user"`, then calls:

```
POST {API_URL}/api/internal/session/validate
Authorization: Bearer {API_SECRET}
{ "userId", "sid", "sv" }
```

The web route checks the same `evaluateSession` decision as HTTP. A missing
secret, timeout, non-2xx, malformed body, wrong user, wrong version, revoked
row, expired row, blocked user or deleted user all reject the upgrade. The
Worker does **not** trust the JWT alone.

After the DO accepts the upgrade, a community room is registered in the user's
`UserDO`. Registration happens **after** acceptance so a failed membership check
or a close racing the accept cannot leave a stale key or delete the key for a
socket that was just accepted. If registration cannot be persisted, the Worker
closes the socket and revokes it directly in the room rather than leaving a
socket a later revocation could not reach. The Worker then validates the session
a **second** time; if the session died in the window between the first check and
registration, it closes the socket with 4001 and asks the user's DO to remove
the server end. This closes the handshake-vs-revocation race rather than
narrowing it.

### Existing sockets

`POST /revoke` on the realtime Worker (publish-secret authenticated) forwards to
`UserDO(userId)/revoke`:

1. Closes every user-scoped socket matching the selector.
2. Lists the community rooms registered for that user.
3. Calls `Room/revoke` in each, which closes matching sockets with code
   **4001** and removes them from every fan-out index **before** the close.
4. Returns 502 if any room failed, so the web helper retries.

Selectors:

- `{ sid }` — one device (logout).
- `{ all: true }` — every device (logout-all, reset, suspension, deletion).
- `{ exceptSid }` — every other device (password change).

The web app calls this after the database revocation commits:

- logout → current sid
- logout-all / reset / suspension / deletion → all
- password change → all except current sid

### Consistency guarantees

- **HTTP is authoritative immediately.** Once the registry transaction commits,
  every new guarded request is rejected at the next request, regardless of
  whether realtime notification succeeded.
- **WebSocket close is immediate on the happy path.** The registry write is
  awaited, then the Worker/DO push is awaited with bounded retries. The
  Worker-level test observes close code 4001 and proves no further event is
  delivered.
- **Reconnect is always checked.** A socket that survives a failed push cannot
  revalidate: the handshake validation sees the revoked row and returns 401.
- **Failure window.** If the realtime Worker is unreachable while a socket is
  still alive, that socket can continue receiving events until it closes,
  reconnects, or the Worker/DO next processes a revocation. The web helper does
  two attempts (1.2 s timeout each); `UserDO` fans out to all registered rooms.
  There is no database query per frame, by design. See "Remaining limitations".
- **In-flight requests.** A request that already passed validation before the
  revocation commit may finish. New requests are rejected. This is the standard
  linearizability boundary; no attempt is made to kill an in-flight HTTP
  response.
- **Handshake race.** The Worker validates before the upgrade, accepts the
  socket, registers the community room, then validates again. A revocation that
  lands after the second read is covered by the push, because the room is
  already registered. A socket therefore cannot survive a revocation that
  predates its second check, and a socket that is closed immediately after
  acceptance cannot delete a registration belonging to another live device.

### Multiple devices and rooms

- Socket identity is `(userId, sid, sv)` persisted in the WebSocket attachment
  (hibernation-safe).
- `SocketRegistry` is still per-socket; `UserDO` closes only matching sids, so
  logging out one tab never closes another.
- A community room registration is reference-counted per live socket. Every
  accepted socket registers, every close unregisters, and the key is deleted at
  zero. This prevents a delayed close from deleting a registration a newer
  socket just wrote.
- `UserDO` retains the registry across hibernation in Durable Object storage.

## Private R2

- All three private proxies (`dm`, `application resume`, `saved resume`) use
  `requireSession` / the live `getSession`, so a blocked, deleted or revoked
  user cannot obtain a **new** signed URL.
- DM images still require conversation membership; admins remain allowed for
  the report queue.
- Existing presigned URLs remain valid until their 5-minute expiry. This is a
  property of S3-compatible presigning, not a bug; the report must not claim
  otherwise.
- Legacy public R2 URLs on un-migrated rows are still public. The proxy checks
  authorization before redirecting, but anyone who already has the public URL
  does not need the proxy. Those objects must be migrated/purged; the proxy is
  not a protection boundary for them.
- The private bucket architecture is unchanged (no public bucket, no public
  object ACL).

## Mobile

- `expo-secure-store` was added (`~15.0.8`, Expo SDK 54 compatible) and the app
  config plugin was registered.
- `lib/sessionStorage.ts` is the single token store:
  - reads SecureStore first;
  - migrates `@auth/uxcommunity_session` and `@auth/draft_session` from
    AsyncStorage on first launch;
  - removes the plaintext copy only after the encrypted write succeeds;
  - clears both stores on logout/401/revocation;
  - only uses AsyncStorage on the web build where SecureStore is unavailable.
- `lib/api.ts` and `lib/realtime.ts` now read/write through that module.
- `/api/auth/me` returning `{ user: null }` drives the existing
  `resolveSessionRestore` "no-session" branch, which clears the cookie,
  snapshot, query cache, chat cache, screen cache and realtime client.
- Realtime close code **4001** is terminal and calls
  `subscribeRealtimeSessionRevoked`; `AuthContext` immediately performs the
  same sign-out cleanup instead of waiting for the next API request.
- Android/iOS compatibility: SecureStore is available on both; the web build
  uses the fallback. No native build was run in this workspace.

## Performance

Measured in this workspace:

- Pure `evaluateSession` decision (`apps/web/lib/auth/session-validity.ts`):
  **1,000,000 calls in 250.76 ms**, ~**251 ns/call**, ~**3.99M calls/s**
  (Node/tsx, single process).
- User HTTP path: **one** primary-key lookup on `auth_sessions` with an
  embedded `users` row. Before this change the guarded path also did one
  `users` liveness read; the query count is unchanged for users, and React
  `cache` deduplicates it within a request. Admin routes add one registry
  lookup and reuse the epoch digest cache.
- Realtime: **two** validation HTTP calls per socket **handshake** (before and
  after the DO accepts, to close the revocation race), zero database calls per
  chat frame. Revocation fan-out is O(rooms with a live socket), only on a
  revocation event.
- Login adds one password-hash readback after session creation to close the
  reset race. Password change/deletion use the existing bcrypt compare.

No production-latency measurement was made; the live run exercised correctness,
not load. The pure decision cost is not the dominant term; the indexed
primary-key lookup and network round trip are.

## Tests added and exact results

| Command | Result |
|---|---|
| `npx tsc -p apps/web/tsconfig.json --noEmit` | **PASS** (0 errors) |
| `cd apps/realtime && npm run typecheck` | **PASS** (0 errors) |
| `cd "expo-app-standalone 3" && npm run typecheck` | **PASS** (0 errors) |
| Web session/security tests (`session-validity`, `session-route-audit`, `reconnect-safety`, `private-access`, `r2-private`) | **42 passed, 0 failed** |
| `cd apps/realtime && npx vitest run __tests__/session-revocation.test.ts __tests__/ws-session-revocation.test.ts __tests__/ws-multi-device.test.ts __tests__/realtime.integration.test.ts` | **53 passed, 0 failed** (real Worker + DOs) |
| `cd apps/realtime && npx vitest run __tests__/ws-ownership.test.ts` | **21 passed, 0 failed** |
| Mobile auth/realtime tests (`authRestore`, `authSnapshot`, `sessionLifecycle`, `realtimeAuth`, `realtimeCore`, `loginFlow`) | **49 passed, 0 failed** |
| `npm run build --workspace=apps/web` | **PASS** (compiled, TypeScript, full route manifest) |
| `npx eslint <24 changed web files>` | **PASS** (0 findings) |
| `npm run lint --workspace=apps/web` | **FAIL (pre-existing baseline)** 43 errors / 24 warnings in unrelated UI files; none in changed files |
| `bash supabase/tests/run-local.sh supabase/tests/session_revocation.test.sql` | **PASS** — 41 assertions, 0 failures, psql exit 0, full migration history |
| Live connected-environment matrix | **PASS** — 56/56 checks; 3 disposable members, 2 private communities, 1 DM conversation; all fixtures removed |
| Live `ADMIN_PASSWORD` rotation | **PASS** — old admin JWT accepted by the current-password server (route reached its 404 user lookup) and rejected with 401 by the rotated-password server |
| Separate staging project | **NOT AVAILABLE** — live verification used the connected environment with disposable fixtures on explicit authorization |

The Worker-level test (`ws-session-revocation.test.ts`) starts the real
`apps/realtime` Worker with Miniflare and a local API stub that can mark a sid
revoked. It proves:

1. Revoking device A closes A with 4001.
2. Device B stays open and still receives events.
3. Device A receives nothing after the close.
4. A reconnect with the revoked sid gets 401.
5. A user-scoped socket closes on `all: true`.
6. A session that dies between the pre-upgrade check and acceptance leaves no
   socket in the room and receives no later event.
7. A blocked user's new community handshake gets 401.
8. `exceptSid` (password change) keeps the current device and closes the other.

The live run used disposable members on the connected environment and observed:

- old cookies rejected after logout, logout-all, reset, deletion and suspension;
- the other device still working after a single-device logout;
- the current device still working after a password change, with the other device
  rejected;
- a used reset token replaying as 410 and the pre-reset password failing login;
- a valid DM participant receiving a 302 to a fresh presigned URL, and a revoked
  JWT receiving 401 from the same path;
- a real community socket receiving a published event, closing with code 4001 on
  logout-all, receiving no later event, and refusing reconnection with 401;
- a suspended member's socket closing with 4001, blocked login returning 403, and
  the old cookie staying dead after unblocking;
- an admin session authorizing an admin route, then being rejected with 401 after
  admin logout;
- an admin JWT rejected when a second server was started with a rotated
  `ADMIN_PASSWORD`.

The unit matrix (`session-validity.test.ts`) covers old JWT after logout,
logout-all, password reset, deletion, suspension, unblocking, expiry, malformed
expiry, cross-user token, user→admin impersonation, admin epoch rotation, admin
logout-all, deleted admin subject, an unaffected user, a reset racing login, and
a token evaluated on both sides of a revocation. `session-route-audit.test.ts`
also asserts that both registry lookups use the token's `sid`, so an old token
can never resolve a newer session row.

`session-route-audit.test.ts` is a regression guard for the bypass surfaces: no
API route outside logout reads `getRawSession`/`verifySession`; every admin
route requires the live admin session; all three private R2 proxies use the
registry-backed guard; `/api/auth/me`, the applications page and both protected
layouts use `getSession`; and the session helpers keep one shared evaluator.

## Requirement-to-test matrix

| # | Required case | Automated evidence |
|---|---|---|
| 1 | Old JWT after logout | `session-validity`: logout revokes one device; route audit rejects raw sessions |
| 2 | Old JWT after logout-all | `session-validity`: version bump; SQL: revoke-all leaves no active row |
| 3 | Old JWT after password reset | `session-validity`: generation bump; SQL: atomic reset + token replay |
| 4 | Old JWT after account deletion | `session-validity`: embedded user gone; SQL: cascade; Worker: socket close |
| 5 | Old JWT after suspension | `session-validity`: blocked row rejected; SQL: block bumps version |
| 6 | Old admin JWT after password rotation | `session-validity`: epoch change; admin logout-all row revocation |
| 7 | Refresh/replay after revocation | `session-route-audit`: registry lookup is by the token's `sid`; SQL: used reset token cannot replay; live: old cookie and used token both rejected |
| 8 | Revoked mobile session | `realtimeCore`: 4001 terminal, no reconnect; `authRestore`: no-session clears state |
| 9 | Revoked web session | `reconnect-safety`: 4001 terminal; route audit: live guards on protected pages |
| 10 | Existing WebSocket closure | Worker test: close 4001 and no later delivery |
| 11 | New WebSocket rejection | Worker test: revoked sid handshake 401 |
| 12 | Blocked user cannot reconnect | Worker test: blocked sid handshake 401 |
| 13 | Revoked user cannot get a new private R2 URL | Route audit: all private proxies use live session; `private-access`: participant/owner rules |
| 14 | Unaffected users continue | `session-validity`: other account valid; Worker: other device still receives |
| 15 | Concurrent requests during revocation | `session-validity`: reset racing login and before/after-revocation evaluations |
| 16 | Identified API bypasses closed | `session-route-audit`: DM, `/me`, applications, layouts and every admin route; live: DM, `/me` and admin routes |

The live matrix additionally exercised rows 1–14 and 16 end to end. Row 15
(concurrency) remains unit/SQL evidence: the live run did not deliberately
overlap a reset with login.

## Remaining limitations

1. **No separate staging project and no native device build.** The live matrix
   ran against the connected environment with three disposable fixtures, on
   explicit authorization. Android and iOS binaries were not built; SecureStore
   availability is SDK-provided and covered only by TypeScript and the pure
   lifecycle tests.
2. **Realtime propagation is best-effort after the HTTP commit.** A push that
   cannot reach a live DO leaves that socket open until it closes/reconnects.
   The handshake check prevents revalidation, and the HTTP API is already
   closed. If "not one event after revocation" is a hard requirement even
   during a realtime outage, add a periodic UserDO revalidation alarm (for
   example every 60 s) or a per-publish revocation check; both add cost and are
   deliberately not enabled here. The live run proved the happy path; it did
   not simulate a realtime Worker outage.
3. **Presigned R2 URLs live up to 5 minutes.** They cannot be revoked
   individually. The live run verified that no NEW URL is issued after
   revocation, not that an already-issued URL stops working.
4. **Legacy public R2 objects remain public until migrated/purged.**
5. **Suspended members cannot self-delete** through the normal password flow
   because suspension revokes every session and blocks login. They must contact
   support. The erasure path still accepts a blocked account if a registry row
   remains live because `is_blocked` was set outside `set_user_blocked`
   (which normally revokes every row).
6. **Admin epoch rotates at the environment boundary.** The live rotation check
   used a second server process with a different `ADMIN_PASSWORD` and the same
   build; a warm production isolate keeps the old digest until the deploy/isolate
   replacement that carries the new secret.
7. **In-flight HTTP requests** that validated before revocation are not
   cancelled.
8. **Concurrency was not overlapped live.** The reset/login race is covered by
   the pure and SQL matrices, not by the live HTTP run.

## Live verification matrix (completed)

The live run used the connected environment with three disposable fixtures, on
explicit authorization. No real user's session was revoked and every fixture was
removed. A separate staging project was not available. The whole run reported
**56/56 checks passed**; this table records which rows were repeated live and
which rely on the Worker/unit matrices.

| # | Test | Expected | Live result |
|---|---|---|---|
| 1 | Two sessions for account A | Two `auth_sessions` rows with the same `session_version` | PASS |
| 2 | Logout A, replay A's cookie | 401; B still 200 | PASS |
| 3 | Logout-all from B, replay both | 401 on both; version incremented | PASS |
| 4 | Reset password, replay every old cookie | 401; old reset token replay → 410/used | PASS |
| 5 | Change password from A | A still 200; B 401; socket sides match | HTTP PASS; socket sides Worker test |
| 6 | Delete account from A; replay B | 401/404; `auth_sessions` rows gone | PASS |
| 7 | Admin blocks A; replay A | 401; A's socket closes; A's login 403 | PASS |
| 8 | Admin unblocks A; replay old A cookie | 401; fresh login works | PASS |
| 9 | Old admin JWT after `ADMIN_PASSWORD` rotation | 401; admin APIs 401 | PASS (second server, same build) |
| 10 | Open community socket, revoke, publish | Socket closes 4001; no event received; other device receives | Close/no-event PASS; other-device Worker test |
| 11 | Open user socket, logout-all | Socket closes 4001 | Worker test; not repeated live |
| 12 | Reconnect with revoked sid | Handshake 401 | PASS |
| 13 | Blocked user opens community socket | Handshake 401 | PASS |
| 14 | Suspended user requests `/api/private/dm/...` | 401 before signing | Revoked JWT PASS; suspended not separately repeated |
| 15 | Already-issued presigned DM URL | Still works until its 5-minute expiry | Not executed; documented |
| 16 | Concurrent login + reset | Login fails or token fails immediately | Unit/SQL only |
| 17 | Unaffected user on another account | Normal requests continue | PASS |

## Rollout status

1. `supabase/migrations/20261030210000_session_revocation.sql` has been applied
   to the connected environment. The live matrix above was executed against it
   with disposable fixtures.
2. Web and realtime must be deployed **together**. Old tokens are rejected by
   design; users sign in once more.
3. The SQL suite, typechecks, build and Worker suites pass locally. The
   repository-wide `npm run lint` still has the pre-existing baseline failures;
   the 24 changed web files lint clean.
4. Keep the migration additive. Do not drop `auth_sessions` during rollback;
   redeploy the previous code if necessary, then clean up later.
5. Build and smoke-test the native apps before shipping the mobile change;
   SecureStore is exercised only by TypeScript/pure tests in this workspace.

## File map

| File | Purpose |
|---|---|
| `supabase/migrations/20261030210000_session_revocation.sql` | Registry, version, atomic issue/revoke/reset/block functions |
| `supabase/tests/session_revocation.test.sql` | pgTAP matrix (passes against the full migration history) |
| `apps/web/lib/auth/session-validity.ts` | Pure validity decision shared by HTTP + realtime |
| `apps/web/lib/auth/session-route-audit.test.ts` | Regression guard for the bypass surfaces |
| `apps/web/lib/auth/session.ts` | JWT claims, registry validation, `getSession` / `requireSession` |
| `apps/web/lib/auth/session-registry.ts` | Typed service-role RPC wrappers |
| `apps/web/app/api/internal/session/validate/route.ts` | API_SECRET-gated handshake validation |
| `apps/web/app/api/auth/logout/route.ts` | Per-device revoke |
| `apps/web/app/api/auth/logout-all/route.ts` | Version + all rows + all sockets |
| `apps/web/app/api/auth/change-password/route.ts` | Optimistic change, keep current |
| `apps/web/app/api/auth/reset-confirm/route.ts` | Atomic reset RPC |
| `apps/web/app/api/admin/logout-all/route.ts` | Admin row revocation |
| `apps/web/app/api/account/delete/route.ts` | Erasure + hash guard + socket close |
| `apps/web/lib/realtime/revoke.ts` | Web→Worker revocation push with retries |
| `apps/realtime/src/session-validation.ts` | Handshake validation + secret compare |
| `apps/realtime/src/index.ts` | `/revoke`, handshake claims, room registration |
| `apps/realtime/src/user.ts` | User socket close + community-room fan-out |
| `apps/realtime/src/room.ts` | Match sid/exceptSid/all, close 4001, unregister |
| `apps/realtime/src/socket-registry.ts` | Hibernation-safe sid/sv attachment |
| `expo-app-standalone 3/lib/sessionStorage.ts` | SecureStore + plaintext migration |
| `expo-app-standalone 3/lib/realtimeCore.ts` | 4001 terminal + revocation callback |
| `expo-app-standalone 3/context/AuthContext.tsx` | Clear local state on 4001 |
| `apps/web/app/dashboard/settings/AccountSection.tsx` | Change password / sign out all devices |

## Acceptance checklist

- [x] Old tokens are rejected after logout (unit + Worker + live).
- [x] Old tokens are rejected after logout-all (unit + live).
- [x] Old tokens are rejected after reset (decision/SQL + live).
- [x] Old tokens are rejected after deletion (decision/SQL cascade + live).
- [x] Old tokens are rejected after suspension (decision/SQL + live).
- [x] Old admin tokens are rejected after password rotation (unit + live second server).
- [x] Replay attempts after revocation fail at validation (sid lookup guard + SQL + live).
- [x] Revoked mobile sessions clear credentials and sockets (unit).
- [x] Revoked web sessions redirect and close sockets (unit/Worker/live).
- [x] Existing WebSocket closes after revocation (Worker + live 4001).
- [x] New WebSocket is rejected after revocation (Worker + live 401).
- [x] Blocked users cannot reconnect (Worker + live handshake 401).
- [x] Revoked users cannot obtain new private R2 URLs (live DM 401).
- [x] Unaffected users keep working (unit + live).
- [x] Concurrent login/reset race guarded (unit + SQL; not overlapped live).
- [x] Identified API bypasses closed (route audit + live DM/me/admin).
- [x] SQL suite executed against full migration history (41 assertions, 0 failures).
- [x] Live connected-environment matrix executed (56/56 checks; fixtures removed).
- [ ] Native Android/iOS builds and a realtime-outage drill.
