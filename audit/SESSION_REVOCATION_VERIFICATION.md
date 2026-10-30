# Session Revocation Verification

**Date:** 2026-10-30
**Repos audited:**
- `uxcommunity` (`/Users/sachin/Documents/GitHub/uxcommunity`)
- `uxcommunity-website` (`/Users/sachin/Documents/GitHub/uxcommunity-website`)

**Mode:** Read-only audit. No application code, migrations, configuration, secrets or
production data were modified. The only file written is this report.

**Verdict: PARTIALLY IMPLEMENTED.**

The product does **not** use Supabase Auth, does **not** issue refresh tokens, and
has no server-side session store or `session_version` column. It uses a custom
HS256 JWT in the `uxcommunity_session` cookie, valid for 7 days. Revocation is
approximated by re-reading `public.users` on every `requireSession()` call. That
makes account deletion and suspension effective on most API routes at the next
request, but it is not token revocation: logout, password reset and password
change leave every previously issued JWT valid until its 7-day expiry, and live
WebSocket connections are never revalidated or closed.

---

## 1. Architecture actually implemented

### 1.1 Login and JWT issuance

| What | Where |
| --- | --- |
| Session cookie name (`uxcommunity_session`, legacy `draft_session`) | `apps/web/lib/auth/session.ts:7-8` |
| JWT creation (`SignJWT`, HS256, 7-day expiry) | `apps/web/lib/auth/session.ts:32-38` |
| Cookie attach (`httpOnly`, `secure` in production, `sameSite=lax`, `maxAge=7d`) | `apps/web/lib/auth/session.ts:107-116` |
| Member login → password check → `createSession({ userId, email, role: "user" })` | `apps/web/app/api/auth/login/route.ts:161-165`, cookie at `:193` |
| Environment admin login → `createSession({ email, role: "admin" })` (no `userId`) | `apps/web/app/api/auth/login/route.ts:75-88` |
| JWT payload | `apps/web/lib/auth/session.ts:20-24` |

There is exactly **one** token type. The same 7-day JWT is the access token, the
refresh credential and the realtime credential. There is no `/refresh`, no
rotation and no token family.

### 1.2 Validation and the liveness check

| What | Where |
| --- | --- |
| Signature/expiry verification (`jose.jwtVerify`, which validates `exp`) | `apps/web/lib/auth/session.ts:40-49` |
| Cookie read + React per-request memoization | `apps/web/lib/auth/session.ts:56-63` |
| Liveness read (`users.id`, `is_blocked`, `verification_status`, `created_at`) | `apps/web/lib/auth/session.ts:139-167` |
| Missing/deleted/blocked row → thrown 401 | `apps/web/lib/auth/session.ts:155-160` |
| `requireSession()` enforces liveness only for `role === "user"` | `apps/web/lib/auth/session.ts:213-240` |
| Admin sessions skip the liveness read | `apps/web/lib/auth/session.ts:231-238` |

Important distinction:

- **JWT expiry** is cryptographic and enforced by `jwtVerify` (`exp`). After
  7 days the token is rejected everywhere that calls `getSession()` or
  `requireSession()`.
- **Immediate revocation** is not cryptographic. It is a database authorization
  check (`getActiveUserState`) that runs at the start of each request. The JWT
  itself remains valid and can still be replayed to any code path that does not
  call `requireSession()`.

The liveness read is `cache()`d only within a single React request. It is not
cached across requests or isolates, so a committed delete/block is seen by the
next guarded request. An in-flight request that already passed the check can
still finish, which is the normal TOCTOU window.

### 1.3 Logout

`POST /api/auth/logout` calls `getSession()` and then `clearSessionCookie()`
(`apps/web/app/api/auth/logout/route.ts:4-14`). It does not write a denylist,
delete a session row, bump a version, or notify the realtime service. A copied
JWT remains accepted by `requireSession()` until its `exp`.

The browser client closes its sockets and hard-navigates to `/login`
(`apps/web/components/ui/useLogout.ts:43-61`), but that is client-side teardown,
not server-side revocation.

### 1.4 Password reset

`POST /api/auth/reset-request` invalidates only other **password reset tokens**
(`apps/web/app/api/auth/reset-request/route.ts:55-67`). It does not touch
sessions.

`POST /api/auth/reset-confirm` atomically claims the reset token and updates
`users.password_hash` (`apps/web/app/api/auth/reset-confirm/route.ts:85-104`).
There is no `password_changed_at` / `password_updated_at` column, no
`session_version` bump, and no session deletion. Existing JWTs continue to pass
`requireSession()` because `getActiveUserState` checks only row existence and
`is_blocked`.

### 1.5 Password change

No authenticated change-password endpoint exists. `apps/web/app/api/` contains
password logic only in login, reset-request, reset-confirm and account-delete.
The account settings card exposes only a reset-link request
(`apps/web/app/dashboard/settings/AccountSection.tsx:12-20`), and the mobile
account screen does the same (`expo-app-standalone 3/app/settings/account.tsx:13`).
When a password is changed through the reset flow, all older sessions remain
valid (see 1.4).

### 1.6 Account deletion

| Step | Where |
| --- | --- |
| Member-facing deletion; password + literal `DELETE` required; deliberately no liveness check | `apps/web/app/api/account/delete/route.ts:19-59` |
| Hard delete of the `users` row | `apps/web/lib/account/delete.ts:95` |
| Cascades (profile, memberships, DMs, content, reset tokens, push tokens) | FKs on `public.users`; e.g. `community_members.user_id` in `supabase/migrations/20260720_communities.sql:30-35`, `dm_conversations.user_a/user_b` in `supabase/migrations/20261012100000_direct_messages.sql:29-34` |
| Community ownership handoff/deletion trigger | `supabase/migrations/20260913150000_community_ownership_on_user_delete.sql:115-120` |
| Current cookie cleared after successful deletion | `apps/web/app/api/account/delete/route.ts:73-81` |

The deleted user's JWT is not invalidated, but the next `requireSession()` call
finds no `users` row and returns 401. The dashboard layout independently reads
`users.is_blocked` and redirects to `/api/auth/session-ended`
(`apps/web/app/dashboard/layout.tsx:22-48`). `/api/auth/me` returns
`{ user: null }` and clears the cookie (`apps/web/app/api/auth/me/route.ts:43-49`).

### 1.7 Account suspension

Suspension is the `users.is_blocked` boolean (`supabase/schema.sql:80-91`).
`PATCH /api/admin/users/[id]` writes only that flag
(`apps/web/app/api/admin/users/[id]/route.ts:92-106`). Login rejects blocked
users (`apps/web/app/api/auth/login/route.ts:129-134`). Guarded API calls return
401 on their next request; the dashboard redirects on its next render. No
session row, token version, socket close or client notification is produced.

### 1.8 API authorization coverage

There is no generic API authorization middleware. `middleware.ts` verifies the
JWT and rate-limits, then protects page prefixes; it does **not** read the
database (`apps/web/middleware.ts:40-90`). Each route is responsible for calling
`requireSession()` / `getSession()`.

- 183 `route.ts` files exist under `apps/web/app/api`.
- 159 `route.ts` files import `requireSession`.
- 4 user-facing API handlers use only `getSession()`:
  - `apps/web/app/api/auth/logout/route.ts` (clear cookie only)
  - `apps/web/app/api/auth/me/route.ts` (no liveness, but handles a deleted row)
  - `apps/web/app/api/private/dm/[conversationId]/[file]/route.ts` (no liveness)
  - `apps/web/app/api/account/delete/route.ts` (intentional; password-gated)
- A method-level scan of every exported route handler found no other unguarded
  user-data handler. The remaining unguarded routes are public catalog/health/
  giphy/signup/invite-lookup or internal secret-authenticated routes (section 6).

### 1.9 Realtime / WebSocket

| What | Where |
| --- | --- |
| Handshake JWT verification (cookie or `?token=`) | `apps/realtime/src/index.ts:158-176` |
| JWT verifier (`jwtVerify`, signature + `exp`) | `apps/realtime/src/index.ts:61-68` |
| User-scoped room name check | `apps/realtime/src/index.ts:178-184`, `apps/realtime/src/room-routing.ts:59-71` |
| Community membership check at upgrade only | `apps/realtime/src/room.ts:188-205` |
| Membership API call (only `community_members`) | `apps/realtime/src/membership-auth.ts:194-205`, `apps/web/app/api/communities/[id]/members/[userId]/check/route.ts:59-77` |
| Membership cache (60 s, only used when upgrading) | `apps/realtime/src/membership-auth.ts:40, 165-192` |
| Frame handling with no re-authorization | `apps/realtime/src/room.ts:234-285` |
| No alarm/periodic sweep or forced close | no `setAlarm` / revalidation in `apps/realtime/src`; `scheduled()` does alerts/retention/notifications, not sockets (`apps/realtime/src/index.ts:100-147`) |

An open socket keeps its `userId`, subscriptions and room membership until the
client closes it or the runtime evicts it. A blocked user can also open a **new**
community socket because the membership endpoint never consults
`users.is_blocked`. A deleted user's membership rows cascade away, so a new
community socket is normally refused; user-scoped and sub-entity rooms only
require a valid JWT and skip the membership check.

### 1.10 Private R2

| What | Where |
| --- | --- |
| Private bucket, no public URL, private keys | `apps/web/lib/r2-private.ts:1-25` |
| Presigned GET capped at 3600 s, default 300 s | `apps/web/lib/r2-private.ts:222-244` |
| Application résumé proxy: `requireSession("user")` + applicant/poster check | `apps/web/app/api/private/resume/application/[id]/route.ts:30-35, 57-80` |
| Saved résumé proxy: `requireSession("user")` + owner check | `apps/web/app/api/private/resume/saved/[id]/route.ts:27-31, 36-62` |
| DM image proxy: `getSession()` + participant/admin check, **no liveness** | `apps/web/app/api/private/dm/[conversationId]/[file]/route.ts:30-67` |
| Verification samples: guarded | `apps/web/app/api/verification/route.ts:16-22` |

Residual windows:

- A presigned URL already handed to a browser keeps working for its full TTL
  (300 s for all three routes; the signer allows up to 3600 s). Revocation cannot
  retract it.
- Legacy rows without a private key redirect to a permanent public bucket URL
  (`resume/application/[id]/route.ts:64-70`, `resume/saved/[id]/route.ts:49-52`).
  Those objects remain readable outside the app until the migration/purge runs;
  see `audit/PRIVATE_R2_STORAGE_IMPLEMENTATION.md:77, 212`.
- The DM proxy allows `role === "admin"` without a membership check. Admin JWTs
  have no `users` row and no liveness check (section 1.2).

### 1.11 Marketing website

`uxcommunity-website` has no auth implementation of its own: one route forwards
the cookie to the app (`../uxcommunity-website/app/api/auth/me/route.ts:6-31`).
It does not verify the JWT, does not read the database, and does not forward a
`Set-Cookie` clear back to the browser. Its header decides "logged in" from cookie
presence (`../uxcommunity-website/app/components/SiteHeader.tsx:4-9`). It cannot
extend or bypass the app's revocation behavior, but it can briefly show a stale
signed-in header after the app would have cleared the cookie.

### 1.12 Mobile

The Expo app uses the same JWT, not a separate mobile token:

- It captures `Set-Cookie` and replays the value as a `Cookie` header
  (`expo-app-standalone 3/lib/api.ts:4-19, 239-261`).
- It stores the token in **AsyncStorage**, not SecureStore
  (`expo-app-standalone 3/lib/api.ts:16-19, 172-215`).
- It signs out locally on a 401 for the current session
  (`expo-app-standalone 3/context/AuthContext.tsx:378-399`).
- It sends the same cookie as a WebSocket handshake header
  (`expo-app-standalone 3/lib/realtime.ts:1-25, 50-60`).

Server-side authorization is identical to web. Client-side session handling is
not: web has an HttpOnly cookie and a dashboard layout that checks `is_blocked`;
mobile has a readable persisted token and a cached profile snapshot that can
paint a blocked account until a guarded request returns 401.

---

## 2. What the requested searches found

| Search term | Finding |
| --- | --- |
| `signOut` | Only the mobile local sign-out coordinator. No Supabase `auth.signOut()`. |
| `revoke` | No session/token revocation. Matches are R2 credential docs, `URL.revokeObjectURL`, SQL `revoke` grants, and comments. |
| `refreshSession` | No matches. No refresh-token implementation. |
| `getUser` | No Supabase `auth.getUser()`. The app uses `getSession()` / `getMe()`. |
| `getClaims` | No matches. |
| `password` | Login, reset-request, reset-confirm, account-delete, signup. No change-password endpoint. |
| `session` | Custom JWT only. No `sessions` table, no session id, no version column. |
| `JWT` / `jose` | `SignJWT` / `jwtVerify` in `apps/web/lib/auth/session.ts` and `apps/realtime/src/index.ts`. |
| `auth.uid()` | Only in RLS policies in a handful of migrations (e.g. `20260814000000_separate_event_likes_and_saves.sql`, `20260918140000_notification_preferences.sql`, `20261010200000_member_resumes_and_email_prefs.sql`). No Supabase Auth session ever supplies that uid. |
| `deleted_at` | Chat/message tombstones and DM message rows only. No user soft-delete. |
| `is_active` | Cities, design sectors, communities. Not a user status. |
| Custom session/version | None. `apps/web/lib/auth/user-status-cache.ts` is a 15 s status cache but is imported only by its own test; it is not used by `session.ts`. `docs/notification-latency-audit.md:178` proposes a `session_version` claim, confirming it does not exist today. |

---

## 3. Answers to the ten questions

### Q1. Does account deletion invalidate existing access tokens immediately?

**Answer:** Not cryptographically. Access is denied on the next guarded request,
but the JWT itself remains valid and some surfaces remain usable.

- **Guarded API routes:** effective. `requireSession()` → `getActiveUserState()`
  reads `users` by id; the row is gone → thrown 401
  (`apps/web/lib/auth/session.ts:139-167, 213-240`). The `users` row is hard
  deleted (`apps/web/lib/account/delete.ts:95`).
- **Dashboard pages:** effective on next render; the layout redirects to
  `/api/auth/session-ended` (`apps/web/app/dashboard/layout.tsx:22-48`).
- **`/api/auth/me`:** returns `{ user: null }` and clears the cookie
  (`apps/web/app/api/auth/me/route.ts:43-49`).
- **Private résumés:** denied by `requireSession()`.
- **Private DM images:** normally 404 because `dm_conversations` cascades on user
  delete (`supabase/migrations/20261012100000_direct_messages.sql:29-34`).
- **Already-open WebSocket:** **still receives events** (section 1.9).
- **New user-scoped/sub-entity WebSocket:** still opens with the deleted user's
  JWT; community rooms are normally refused because membership cascaded.

So deletion is an effective *authorization* revocation for most HTTP paths, not
an *access-token* revocation. The token can still be replayed to any path that
does not perform the database check.

**Classification: PARTIAL.**

### Q2. Does password reset invalidate all previously issued sessions?

**Answer: No.**

`reset-confirm` only claims the reset token and writes `users.password_hash`
(`apps/web/app/api/auth/reset-confirm/route.ts:85-104`). The liveness query in
`getActiveUserState` does not read the password hash, a password timestamp or a
session version (`apps/web/lib/auth/session.ts:139-167`). Every JWT issued before
the reset remains accepted by `requireSession()` until its own `exp` (up to
7 days). Login with the new password creates an additional JWT; it does not
invalidate the old one.

**Classification: MISSING.**

### Q3. Does password change invalidate other sessions?

**Answer: There is no password-change feature, and the reset flow does not
invalidate other sessions.**

No authenticated change-password route exists. Settings only send a reset link
(`apps/web/app/dashboard/settings/AccountSection.tsx:12-20`; mobile equivalent
`expo-app-standalone 3/app/settings/account.tsx:13`). If a member uses the reset
flow while another session is active, that other session remains valid (Q2).

**Classification: MISSING** (both the feature and the invalidation).

### Q4. Can a revoked refresh token still obtain a new access token?

**Answer: Not applicable — there are no refresh tokens.**

The only issuance call is `createSession()` (`apps/web/lib/auth/session.ts:32-38`),
used by member and admin login. There is no refresh endpoint, no rotation, no
token family and no revocation list. The 7-day JWT is simultaneously the access
token and the refresh credential. A "revoked refresh token" cannot exist because
no refresh token can exist.

**Classification: MISSING (mechanism absent).**

### Q5. Can an old JWT still access protected API endpoints?

**Answer: It depends on why it is old.**

| Event | Old JWT still passes `requireSession`? | Why |
| --- | --- | --- |
| Logout | **Yes** | Only the cookie is cleared; no server state changes. |
| Password reset | **Yes** | Only `password_hash` changes. |
| Password change | N/A (no endpoint) | — |
| Account deletion | **No** on `requireSession` routes (401) | `users` row is gone. |
| Account suspension | **No** on `requireSession` routes (401) | `is_blocked` is read per request. |
| JWT expiry | **No** | `jwtVerify` enforces `exp`. |
| Admin password/env change | **Yes** for the old admin JWT | Admin role is carried in the JWT; no user row or env re-check. |

Exceptions on otherwise-guarded routes are listed in Q10. The important
distinction is that logout and password reset produce an old-but-still-authorized
JWT, not a revoked one.

**Classification: PARTIAL.**

### Q6. Can an old JWT access Supabase directly through RLS?

**Answer: No, not through this application's JWT.**

Evidence:

- No Supabase Auth is used. There is no `@supabase/ssr`, `auth.getUser()`,
  `auth.getClaims()`, `refreshSession()` or Supabase `signOut()` in either repo.
- Every database call uses the server-side service-role client
  (`apps/web/lib/supabase/service.ts:21-37`), which bypasses RLS and is never
  imported into client components.
- The app JWT is `{ userId, email, role }` signed HS256 with `SESSION_SECRET`
  (`apps/web/lib/auth/session.ts:20-38`). It has no Supabase `sub`, no `role`
  claim, no `aud`, and is not a Supabase Auth token. PostgREST has no configured
  reason to accept it.
- The repository's own migration documents that all reads/writes go through the
  service role and that no Supabase browser/server client remains:
  `supabase/migrations/20260926000000_close_public_read_exposure.sql:23-34`.
- `public.users` has RLS enabled (`supabase/schema.sql:172`) and no policy; an
  anon/authenticated request cannot read it.
- No anon key is shipped: only `NEXT_PUBLIC_SUPABASE_URL` and the server-only
  `SUPABASE_SERVICE_ROLE_KEY` are referenced.

`auth.uid()` policies exist in older migrations, but no code path ever supplies a
Supabase Auth JWT, so those policies have no consumer for app sessions. Even if
someone obtained the app JWT, it is not a Supabase credential. Public catalog
tables with intentional anon grants are a separate exposure question and are
not unlocked by the app JWT.

**Classification: CODE-VERIFIED (no path exists).**

### Q7. Can an old JWT access private R2 files?

**Answer: Partially — résumé and verification routes are guarded; the DM route is
not fully guarded for suspended users; presigned URLs and legacy public objects
survive revocation. After logout or a password reset, the old JWT is still a
live session, so it can still mint presigned URLs for all three proxies.**

- **Application résumé:** `requireSession("user")` then applicant/poster check;
  deleted or blocked → 401 (`apps/web/app/api/private/resume/application/[id]/route.ts:30-35, 57-62`).
- **Saved résumé:** `requireSession("user")` then owner-scoped query; deleted or
  blocked → 401 (`apps/web/app/api/private/resume/saved/[id]/route.ts:27-31, 36-47`).
- **Verification samples:** `requireSession("user")` (`apps/web/app/api/verification/route.ts:16-22`).
- **DM image:** `getSession()` only, then participant or `role === "admin"` check.
  A **blocked** user still passes and can mint a 5-minute presigned URL; a deleted
  user normally gets 404 because the conversation cascaded
  (`apps/web/app/api/private/dm/[conversationId]/[file]/route.ts:30-67`).
- **Already-issued presigned URL:** valid for its TTL regardless of revocation
  (`signPrivateGet`, default 300 s, max 3600 s — `apps/web/lib/r2-private.ts:222-244`).
- **Legacy public rows:** if `resume_key`/`storage_key` is absent, the proxy
  redirects to the old permanent public URL (`resume/application/[id]/route.ts:64-70`,
  `resume/saved/[id]/route.ts:49-52`). Those objects are outside app
  authorization until the migration/purge described in
  `audit/PRIVATE_R2_STORAGE_IMPLEMENTATION.md:77, 212`.

**Classification: PARTIAL.**

### Q8. Can an already-connected WebSocket continue receiving messages after revocation?

**Answer: Yes.**

- The handshake verifies the JWT once
  (`apps/realtime/src/index.ts:158-176`).
- The Room Durable Object checks community membership once, before accepting the
  socket (`apps/realtime/src/room.ts:188-205`).
- There is no alarm, timer, periodic re-read, or server-initiated close in
  `apps/realtime/src`; `scheduled()` handles alerts, retention and notifications,
  not sockets (`apps/realtime/src/index.ts:100-147`).
- `webSocketMessage()` processes subsequent frames without re-authorizing
  (`apps/realtime/src/room.ts:234-285`).

Therefore a socket opened before a delete/block/reset/logout keeps receiving
fan-out events until the client closes it or the runtime evicts it. A copied JWT
can also open a new **user-scoped** room (`user:`, `notifications:`, `profile:`,
`dm:`) or a sub-entity room after deletion, because those paths require only a
valid JWT. A **blocked** user can additionally open new **community** sockets:
the membership endpoint checks only `community_members`
(`apps/web/app/api/communities/[id]/members/[userId]/check/route.ts:59-77`) and
never reads `users.is_blocked`. A deleted user's community membership cascades
away, so new community sockets are normally refused.

The client-side close on logout (`apps/web/components/ui/useLogout.ts:43-61`,
mobile `resetRealtimeSession`) is not a server-side revocation and only happens
if the client cooperates.

**Classification: MISSING.**

### Q9. Are mobile and web sessions handled consistently?

**Answer: Consistent on the server; inconsistent on the client.**

Same:
- Both present the same `uxcommunity_session` JWT.
- Both are subject to the same 7-day `exp`.
- Both hit the same `requireSession()` / `getSession()` guards.
- Both use the same realtime handshake and the same JWT-only upgrade check.

Different:
- Web stores the token in an HttpOnly, Secure (production), SameSite=Lax cookie
  (`apps/web/lib/auth/session.ts:107-116`).
- Mobile captures the same cookie value and stores it in plain AsyncStorage
  (`expo-app-standalone 3/lib/api.ts:16-19, 172-215`), so the token is readable by
  any code with app storage access. That makes the missing server-side revocation
  more consequential on mobile.
- Web's dashboard layout checks `is_blocked` and redirects
  (`apps/web/app/dashboard/layout.tsx:22-48`). Mobile's `/api/auth/me` does not
  expose `is_blocked` (`apps/web/app/api/auth/me/route.ts:34-60`), so a blocked
  user can keep a cached shell until a guarded request returns 401.
- Mobile has a global 401 subscriber that signs out and resets realtime
  (`expo-app-standalone 3/context/AuthContext.tsx:378-399`). Web relies on the
  individual page/route response and the dashboard layout redirect.

**Classification: PARTIAL.**

### Q10. Is there any endpoint that bypasses the revocation mechanism?

**Answer: Yes — by design in some places, by omission in others.**

| Path | Behavior | Assessment |
| --- | --- | --- |
| `GET /api/private/dm/[conversationId]/[file]` | `getSession()` only; no `requireSession`/`is_blocked`. Blocked participants still get a 302 to a signed URL. Deleted participants normally 404 via cascade. | **Omission.** |
| `GET /api/auth/me` | `getSession()` only. Deleted row → `user:null` + cookie clear; blocked row is still returned with profile fields. | **Omission** (minor data exposure; no authorization grant). |
| `POST /api/account/delete` | Deliberately no liveness check so a blocked member can erase their account. Password + `DELETE` confirmation are the gate. | **Intentional** and documented (`account/delete/route.ts:10-22`). |
| `GET /applications/[jobId]/[applicationId]` | Page uses `getSession()` only; `loadJobViewer()` checks that the `users` row exists but not `is_blocked` (`apps/web/lib/jobs/service.ts:642-656`). A suspended job poster can still render applicant data; deletion redirects. | **Omission** (page, not JSON API). |
| `WS /ws` | JWT verified at handshake only. Open sockets survive revocation; blocked users can open new community sockets. | **Omission.** |
| `/api/admin/**` | `requireSession("admin")`; admin JWT has no `userId`, no users row and no liveness check. Rotating `ADMIN_PASSWORD` does not revoke already-issued admin JWTs. | **Privileged stale-session gap.** |
| `/api/internal/**`, `/api/communities/[id]/members/[userId]/check` | Server-to-server `API_SECRET`; no user session. | **Intended internal auth**, not reachable with a user JWT. |
| `GET /api/healthz`, `/api/data/*`, `/api/giphy`, `GET /api/communities/join/[token]`, `GET /api/signup/resume`, signup step-1 endpoints | Public by design; no user-scoped data. | **Not revocation bypasses.** |
| `GET /api/auth/session-ended` | Clears the cookie and redirects; does not revoke the token. | **UI cleanup only.** |

The method-level scan found no other route handler that skips a guard while
serving user data.

**Classification: PARTIAL.**

---

## 4. Revocation matrix

`requireSession` = a route that calls the liveness-checking helper.
`JWT valid` = signature and `exp` still pass.

| Event | JWT valid? | `requireSession` API | Dashboard page | `/api/auth/me` | DM private file | Open WebSocket | New community WebSocket |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Logout | Yes | **Allowed** | **Allowed** | **Allowed** | **Allowed** | **Continues** | **Allowed** |
| Password reset | Yes | **Allowed** | **Allowed** | **Allowed** | **Allowed** | **Continues** | **Allowed** |
| Password change | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| Account deleted | Yes (until `exp`) | Denied 401 | Redirect | `user:null` + clear | 404 (cascade) | **Continues** | Usually denied (membership cascade) |
| Account blocked | Yes | Denied 401 | Redirect | **Allowed** (profile) | **Allowed** (302) | **Continues** | **Allowed** |
| JWT expired | No | Denied 401 | Redirect to login | `user:null` | 401 | **May continue** | Handshake denied |

The last column is the key architectural gap: **JWT expiry is not a socket
lifetime bound.**

---

## 5. Runtime verification

### 5.1 Availability assessment

No runtime revocation tests were performed.

Reasons:

- No staging URL, staging credentials or disposable staging accounts are
  declared in either repository. `wrangler.staging.toml` configures only the
  realtime Worker; it does not establish a staging application/database or test
  accounts.
- `apps/web/.env.local`, `apps/web/.env.production.local` and
  `apps/realtime/.dev.vars` exist, but their targets were not inspected (they may
  contain production credentials; reading them would also expose secrets).
- Docker is not available in this environment and there is no running local
  Supabase stack, so a disposable local database could not be provisioned
  without new infrastructure.
- A Node process is listening on port 3000, but it is not identified as staging.
  Creating or deleting accounts against it could mutate production data, which
  the audit forbids.
- Account deletion, suspension and password reset are destructive state changes.
  They must not be exercised against real users.

Consequently no "actual HTTP responses" are recorded in this report. Every
finding above is **CODE-VERIFIED** or an explicit **MISSING/PARTIAL** conclusion
from code, not a runtime proof. None of the results qualifies as **VERIFIED**
under the requested classification.

### 5.2 Reproducible manual test plan

Run only on a dedicated staging deployment with disposable accounts. Replace
placeholders; never paste real tokens into logs or tickets.

**Setup**

1. Deploy the web app and realtime Worker against a staging Supabase project and
   a staging private R2 bucket.
2. Create three disposable members: `victim@staging.invalid`,
   `attacker@staging.invalid`, `sender@staging.invalid`. Give them a shared
   staging community and a DM conversation with one image.
3. Log in as the victim in two independent clients (browser profile A and B, or
   browser + Expo build) and capture each `uxcommunity_session` value from the
   login response. These are the two old tokens.

**A. Account deletion**

1. From session A, `POST /api/account/delete` with the victim password and
   `"confirmation":"DELETE"`.
2. With session B's old cookie:
   - `curl -i -H "Cookie: uxcommunity_session=$B" "$BASE/api/auth/me"`
     Record status/body. Expected current behavior: `200 {"user":null}` plus a
     clearing `Set-Cookie`.
   - `curl -i -H "Cookie: uxcommunity_session=$B" "$BASE/api/communities"`
     Record status. Expected current behavior: `401` (liveness check).
   - `curl -i -H "Cookie: uxcommunity_session=$B" "$BASE/dashboard"`
     Record status/Location. Expected: redirect to `/api/auth/session-ended`.
3. Preserve a WebSocket opened with B **before** the delete, subscribe to
   `chat:<communityId>`, and have the sender post a message. Record whether B
   receives it. Expected current behavior: yes.
4. Reconnect B after the delete to `chat:<communityId>`. Expected: 403.

**B. Password reset**

1. With two live sessions for a fresh disposable account, request a reset for
   that account and read the token from the staging mail sink.
2. `POST /api/auth/reset-confirm` with the token and a new password.
3. Replay the old cookie from the other session against `/api/communities` and
   `/api/auth/me`. Expected current behavior: both succeed; the old JWT was not
   invalidated.
4. Confirm the new password logs in and mints an additional JWT; the old JWT
   still works.

**C. Password change**

1. Confirm no authenticated change-password route exists (`find app/api -iname
   '*password*'`); the UI offers only "send reset link".
2. Treat the reset in B as the only password-change path. It does not invalidate
   other sessions.

**D. Suspension**

1. As an admin, `PATCH /api/admin/users/<id>` with `{"is_blocked":true}`.
2. Replay the blocked user's cookie:
   - `/api/communities` → expected 401.
   - `/api/auth/me` → expected 200 with profile fields (current gap).
   - `/api/private/dm/<conversationId>/<file>` → expected 302 (current gap).
   - `/applications/<jobId>/<applicationId>` where the blocked user is the job
     poster → expected 200 with applicant data (current gap).
3. Open a new WebSocket to `chat:<communityId>` with the blocked cookie.
   Expected current behavior: accepted, and receives messages (membership exists,
   `/check` ignores `is_blocked`).
4. Open a user-scoped room `user:<blockedId>`. Expected: accepted.

**E. Private R2**

1. Capture the `Location` from a 302 on
   `/api/private/resume/application/<applicationId>`.
2. Block the applicant, then fetch the captured URL within 5 minutes. Expected:
   R2 serves it (the signature does not know about app revocation).
3. After 5 minutes, fetch it again. Expected: expired signature.
4. Try the proxy again as the blocked applicant. Expected: 401.
5. Repeat for `/api/private/dm/...`: expected 302 while blocked (gap).

**F. Admin token**

1. Log in as the environment admin, capture the cookie.
2. Rotate `ADMIN_PASSWORD` in staging and redeploy the variable.
3. Replay the old admin cookie against `/api/admin/users`. Expected current
   behavior: 200 until the JWT's 7-day `exp`.

**G. Expiry vs revocation**

1. Mint a JWT, wait past `exp` (or use a short-lived test secret), then replay it.
   Expected: 401 everywhere `jwtVerify` runs, including the WebSocket handshake.
2. Open a WebSocket before `exp` and keep it open past `exp`; send an event after
   expiry. Expected current behavior: the socket still receives it. This isolates
   expiry from socket lifetime.

Record status codes, response bodies, `Set-Cookie` headers, and WebSocket frames.
Do not use production accounts.

---

## 6. Bypass and residual-risk register

1. **Logout is client-side only.** A copied JWT is valid for the remainder of its
   7 days (`apps/web/app/api/auth/logout/route.ts:4-14`).
2. **Password reset does not revoke.** The only password state change is
   `password_hash` (`apps/web/app/api/auth/reset-confirm/route.ts:99-104`).
3. **No password-change endpoint.** Settings only sends a reset link.
4. **No refresh-token rotation.** One 7-day JWT is both access and refresh
   credential.
5. **Live sockets survive revocation.** No DO alarm, no periodic JWT/liveness
   check, no forced close (`apps/realtime/src/room.ts:188-285`).
6. **Blocked users can reconnect to community rooms.** `/check` reads only
   `community_members` (`apps/web/app/api/communities/[id]/members/[userId]/check/route.ts:59-77`).
7. **DM private-file proxy skips liveness.** `getSession()` only
   (`apps/web/app/api/private/dm/[conversationId]/[file]/route.ts:30-33`).
8. **`/api/auth/me` returns a blocked profile.** No `is_blocked` in the select
   (`apps/web/app/api/auth/me/route.ts:34-60`).
9. **Suspended job posters can render applicant data.** `/applications/...`
   checks row existence, not `is_blocked` (`apps/web/lib/jobs/service.ts:642-656`).
10. **Admin JWTs are unrevocable for 7 days.** Admin role has no users row and no
    liveness check (`apps/web/lib/auth/session.ts:231-238`); rotating
    `ADMIN_PASSWORD` does not affect issued tokens.
11. **Presigned R2 URLs outlive revocation** for their TTL
    (`apps/web/lib/r2-private.ts:228-244`).
12. **Legacy public R2 objects remain public** until the migration/purge
    (`audit/PRIVATE_R2_STORAGE_IMPLEMENTATION.md:77, 212`).
13. **Mobile stores the session token in AsyncStorage**, not an encrypted store
    (`expo-app-standalone 3/lib/api.ts:16-19, 172-215`).
14. **The website can show a stale signed-in header** because it only checks
    cookie presence and does not forward cookie clears
    (`../uxcommunity-website/app/components/SiteHeader.tsx:4-9`,
    `../uxcommunity-website/app/api/auth/me/route.ts:6-31`).

The only global revocation lever in the current design is rotating
`SESSION_SECRET` (deployed consistently to the web app and the realtime Worker).
That invalidates every user and admin JWT at once; there is no selective
per-user or per-device revocation.

---

## 7. Verdict

**PARTIALLY IMPLEMENTED.**

What already works:

- JWT expiry is enforced (`jose.jwtVerify` on `exp`).
- Account deletion and suspension deny the next `requireSession()` request and
  the next dashboard render.
- Login rejects deleted and blocked accounts.
- Application/saved résumés and verification samples require a live session.
- The realtime Worker fails closed when `SESSION_SECRET` is missing and checks
  community membership at handshake.
- Direct Supabase access is not an available path for app JWTs.

What remains vulnerable:

- Logout, password reset and password change do not revoke existing JWTs.
- There is no refresh-token model to rotate or revoke.
- Live WebSocket connections are never revalidated or closed.
- Blocked users can reconnect to community sockets and still fetch DM images.
- `/api/auth/me`, `/applications/...` and the DM proxy skip the liveness check.
- Admin JWTs cannot be selectively revoked for 7 days.
- Presigned R2 URLs and legacy public R2 objects outlive revocation.

No fixes were implemented, by instruction. The next step is a product decision:
either add a real server-side session/version mechanism (which would make logout,
password reset and per-device revocation meaningful) or explicitly accept the
7-day stateless-JWT model and close the specific bypasses above.
