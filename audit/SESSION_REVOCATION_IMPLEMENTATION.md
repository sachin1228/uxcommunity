# Immediate Session Revocation — Implementation

**Branch:** `feat/immediate-session-revocation`
**Date:** 2026-10-30
**Audit input:** [SESSION_REVOCATION_VERIFICATION.md](./SESSION_REVOCATION_VERIFICATION.md)

## Verdict

**PARTIALLY IMPLEMENTED — code and SQL verified, staging runtime outstanding.**

Every mechanism in the request is implemented and covered by local unit,
Worker-level or SQL tests. The remaining gap is environmental: no staging
application or disposable accounts were available, so the end-to-end staging
matrix below could not be executed. No production migration, secret, session or
deployment was touched.

Read the status labels carefully:

| Label | Meaning here |
|---|---|
| **VERIFIED** | Proven by a test run in this workspace (unit, Worker or SQL). |
| **CODE-VERIFIED** | Implementation supports it; no live database/staging run. |
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

No staging database latency measurement was possible. The pure decision cost
is not the dominant term; the indexed primary-key lookup and network round trip
are.

## Tests added and exact results

| Command | Result |
|---|---|
| `cd apps/web && npx tsc --noEmit` | **PASS** (0 errors) |
| `cd apps/realtime && npx tsc --noEmit` | **PASS** (0 errors) |
| `cd "expo-app-standalone 3" && npm run typecheck` | **PASS** (0 errors) |
| `npx tsx --test apps/web/lib/auth/session-validity.test.ts` | **18 passed, 0 failed** |
| `cd apps/realtime && npx vitest run __tests__/session-revocation.test.ts` | **9 passed, 0 failed** |
| `npx tsx --tsconfig apps/web/tsconfig.json --test apps/web/lib/realtime/reconnect-safety.test.ts` | **3 passed, 0 failed** |
| `npx tsx --test "expo-app-standalone 3/lib/realtimeCore.test.ts"` | **22 passed, 0 failed** |
| `cd apps/realtime && npx vitest run __tests__/ws-session-revocation.test.ts` | **4 passed, 0 failed** (real Worker + DOs) |
| `npm run build --workspace=apps/web` | **PASS** (compiled, TypeScript, 124/124 pages) |
| `npx eslint <all changed files>` | **PASS** (0 findings) |
| `npm run lint --workspace=apps/web` | **FAIL (pre-existing)** 43 errors / 24 warnings in unrelated UI files; none in changed files |
| `bash supabase/tests/run-local.sh supabase/tests/session_revocation.test.sql` | **PASS** — 41 assertions, 0 failures, psql exit 0, full migration history (caught three PL/pgSQL name ambiguities in the new functions, now fixed) |
| Staging runtime matrix | **NOT RUN** — no staging app, no disposable accounts |

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

The unit matrix (`session-validity.test.ts`) covers old JWT after logout,
logout-all, password reset, deletion, suspension, unblocking, expiry, malformed
expiry, cross-user token, user→admin impersonation, admin epoch rotation, admin
logout-all, deleted admin subject, and an unaffected user.

## Remaining limitations

1. **No staging application run.** The SQL migration and pgTAP suite pass
   against a scratch PostgreSQL cluster built from the full migration history,
   but that cluster intentionally omits Supabase-only objects and no staging
   app was available. Apply the migration to staging and run the staging matrix
   before claiming production readiness.
2. **Realtime propagation is best-effort after the HTTP commit.** A push that
   cannot reach a live DO leaves that socket open until it closes/reconnects.
   The handshake check prevents revalidation, and the HTTP API is already
   closed. If "not one event after revocation" is a hard requirement even
   during a realtime outage, add a periodic UserDO revalidation alarm (for
   example every 60 s) or a per-publish revocation check; both add cost and are
   deliberately not enabled here.
3. **Presigned R2 URLs live up to 5 minutes.** They cannot be revoked
   individually.
4. **Legacy public R2 objects remain public until migrated/purged.**
5. **Suspended members cannot self-delete** through the normal password flow
   because suspension revokes every session and blocks login. They must contact
   support. The erasure path still accepts a blocked account if a registry row
   remains live because `is_blocked` was set outside `set_user_blocked`
   (which normally revokes every row).
6. **Admin epoch rotates only on environment redeploy.** A warm isolate keeps
   the old digest until the deployment/isolate is replaced; Cloudflare secret
   rotation requires a deploy, so this is effectively the deploy boundary.
7. **Mobile native builds were not run.** TypeScript and the pure lifecycle
   tests pass; SecureStore availability on a device is SDK-provided but not
   exercised here.
8. **In-flight HTTP requests** that validated before revocation are not
   cancelled.

## Staging verification matrix

Run against a disposable staging project only. Never production.

| # | Test | Expected |
|---|---|---|
| 1 | Login on two devices (A, B) | Two `auth_sessions` rows with the same `session_version` |
| 2 | Logout A, replay A's cookie | 401; B still 200 |
| 3 | Logout-all from B, replay both | 401 on both; version incremented |
| 4 | Reset password, replay every old cookie | 401; old reset token replay → 410/used |
| 5 | Change password from A | A still 200; B 401; A's socket stays, B's closes 4001 |
| 6 | Delete account from A; replay B | 401/404; `auth_sessions` rows gone |
| 7 | Admin blocks A; replay A | 401; A's socket closes; A's login 403 |
| 8 | Admin unblocks A; replay old A cookie | 401; fresh login works |
| 9 | Old admin JWT after `ADMIN_PASSWORD` rotation | 401/redirect; admin APIs 401 |
| 10 | Open community socket, revoke, publish | Socket closes 4001; no event received; other device receives |
| 11 | Open user socket, logout-all | Socket closes 4001 |
| 12 | Reconnect with revoked sid | Handshake 401 |
| 13 | Blocked user opens community socket | Handshake 401 |
| 14 | Suspended user requests `/api/private/dm/...` | 401 before signing |
| 15 | Already-issued presigned DM URL | Still works until its 5-minute expiry (documented, not a failure) |
| 16 | Concurrent login + reset | Login either fails or the issued token fails immediately; reset password is never overwritten |
| 17 | Unaffected user on another account | Normal requests and sockets continue |

## Rollout

1. Apply `supabase/migrations/20261030210000_session_revocation.sql` to staging.
2. Deploy web and realtime together. Old tokens are rejected by design; users
   sign in once more.
3. Run the SQL suite and the staging matrix. Do not run against production.
4. Only after staging passes, schedule a production window. Applying the
   migration alone does not log anyone out; deploying the new validation does.
5. Keep the migration additive. Do not drop `auth_sessions` during rollback;
   redeploy the previous code if necessary, then clean up later.

## File map

| File | Purpose |
|---|---|
| `supabase/migrations/20261030210000_session_revocation.sql` | Registry, version, atomic issue/revoke/reset/block functions |
| `supabase/tests/session_revocation.test.sql` | pgTAP matrix (passes against the full migration history) |
| `apps/web/lib/auth/session-validity.ts` | Pure validity decision shared by HTTP + realtime |
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

- [x] Old tokens are rejected after logout (unit + Worker).
- [x] Old tokens are rejected after logout-all (unit).
- [x] Old tokens are rejected after reset (decision/SQL).
- [x] Old tokens are rejected after deletion (decision/SQL cascade).
- [x] Old tokens are rejected after suspension (decision/SQL).
- [x] Old admin tokens are rejected after password rotation (unit).
- [x] Replay attempts after revocation fail at validation (unit + Worker).
- [x] Revoked mobile sessions clear credentials and sockets (unit).
- [x] Revoked web sessions redirect and close sockets (unit/Worker).
- [x] Existing WebSocket closes after revocation (Worker test).
- [x] New WebSocket is rejected after revocation (Worker test).
- [x] Blocked users cannot reconnect (handshake validation).
- [x] Revoked users cannot obtain new private R2 URLs (all private proxies use live session).
- [x] Unaffected users keep working (unit).
- [x] Concurrent login/reset race guarded (hash readback + optimistic updates).
- [x] Identified API bypasses closed.
- [x] SQL suite executed against full migration history (41 assertions, 0 failures).
- [ ] Staging runtime matrix executed.
