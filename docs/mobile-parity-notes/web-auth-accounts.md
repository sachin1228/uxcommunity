# Web auth, accounts, profiles & settings — mobile parity notes

Audit of the Next.js web app (`apps/web`) for feature parity in the Expo app (`expo-app-standalone 3/`).
Scope: signup, login/logout, password reset, session/authorization model, profile (own + member), avatar
pipeline, settings (account, notifications, email, connected accounts, job profile), company verification,
notification inbox, account deletion, membership/permissions.

Method: page component → client fetch → route handler → server validation → DB (Supabase) → response.
All paths are repo-relative. Read-only audit; no code was modified. No secrets/keys are reproduced here
(only environment variable names).

Cross-cutting facts used throughout:

- Every API route is a Next.js App Router route handler under `apps/web/app/api/**`; all DB access uses the
  Supabase **service-role** client (`apps/web/lib/supabase/service.ts:20`) which bypasses RLS. RLS policies in
  migrations are therefore irrelevant to API-route behavior; they exist for the direct Data API surface only.
- "Auth" below means the member-facing session (JWT cookie). Community-level roles (owner/admin/moderator of
  a community) are a separate model and out of scope.
- Sessions are stateless JWTs. There is **no server-side session store, no token denylist and no refresh**:
  a token stays valid until its 7-day expiry even after "logout" (logout only clears the cookie client-side).
- The signed-in identity for non-admin requests is additionally checked against `users.is_blocked` on
  non-read-only routes (`apps/web/lib/auth/session.ts:129-159`, 195-201).

---

## Feature table

| Feature | Web pages | API endpoints (method path) | Auth/roles | Key business rules & edge cases | Mobile-relevant constraints | Suggested mobile priority |
|---|---|---|---|---|---|---|
| Signup — direct (open registration) | `/signup` (no `token`/`resume` param) — `apps/web/app/signup/page.tsx` | `POST /api/signup/direct` (step 1 validation), `POST /api/signup/avatar` (final, creates account + session), `GET /api/data/cities`, `/api/data/sectors`, `/api/data/experience-levels`, `/api/data/job-titles` (dropdowns, public) | Public (no session). Final step returns the session cookie. | No email verification/OTP anywhere. Account created only in the final step via RPC `complete_signup` (one transaction). Step 1 records `signup_attempts` for admin visibility. Rate limits: 60/h/IP (step 1), 20/h/IP (final). Password rule: min 8 chars + ≥1 number (no uppercase). | Fully replay-compatible; capture `Set-Cookie` after final step. Multipart payload is `payload` (JSON string) + `file`. 400px/WebP client compression convention for avatars (web uses 400px; mobile `prepareImage` defaults to 2560px). | P1 |
| Signup — invitation | `/signup?token=…` | `GET /api/signup/validate?token=`, `POST /api/signup/complete` (step 1), `POST /api/signup/avatar` (final, carries `token`) | Public | Invitation token (reusable until final commit; `used_at` set by the RPC). 410 states for used/expired/invalid. 409 if the application or email already has an account. | Same endpoints; validate-then-complete is two round trips. | P2 |
| Signup — resume link (incomplete signup) | `/signup?resume=…` | `GET /api/signup/resume?token=`, then `POST /api/signup/direct` (step 1) + final step as direct | Public. Admin triggers: `POST /api/admin/signup-attempts/[id]/resume` (admin session). | Resume link prefills name/email; password still required (never stored). Token = 32-byte hex, TTL `INVITATION_EXPIRY_DAYS` (default 7). Dead once attempt `status='completed'`. Invitation drop-offs are re-sent the original invitation instead. | Mobile signup has no resume landing to build (link opens on web); mobile could at least not break the shared email link. | P3 |
| Login (member + admin) | `/login` | `POST /api/auth/login`, then `GET /api/auth/me` | Public | Per-IP 10/15 min + per-email 20/15 min → 429 + `Retry-After`. Generic 401 "Invalid email or password." Blocked → 403. Missing profile row → 403 `incompleteSignup:true`. Admin short-circuit via `ADMIN_EMAIL`/`ADMIN_PASSWORD` (email case-insensitive, password exact) → JWT `role:"admin"`, no `userId`, response `{success, redirect:"/admin"}`. Member response `{success, name}` (no redirect). bcrypt cost 10; cost-12 hashes rehashed on successful login. | Mobile already uses this (`lib/auth.ts`). Handle 403 blocked/incomplete distinctly; `redirect==="/admin"` is the only admin signal besides `/me`. | P1 (exists) |
| Logout | every "Sign out" button (`apps/web/components/ui/useLogout.ts`) | `POST /api/auth/logout` | Requires a valid session cookie to do anything. | No session → `200 {success:true}` without clearing (CSRF-forced-logout guard). Valid → clears both cookie names. Stateless: token remains valid until expiry. Web then hard-navigates to `/login`. | Mobile also calls `DELETE /api/push/register` before logout; clear local token regardless of response. | P1 (exists) |
| Session / identity | middleware gate on `/dashboard/*`, `/admin/*`, `/login`, `/` | `GET /api/auth/me` | Any cookie holder; `/me` distinguishes admin vs member | JWT HS256, payload `{userId?, email, role}`; 7-day hard expiry, no sliding renewal. `/me` returns `200 {user:null}` for no/expired session and clears the cookie if the user row is gone. Member shape: `{id,name,email,role:"user",profileComplete,avatar_url}`. Admin: `{role:"admin",email}` only. `/me` rate-limited 60/min/IP. | Cookie value is the whole session — store it, replay as `Cookie: uxcommunity_session=…`. Treat any 401 (liveness failure) as session death. | P1 (exists) |
| Forgot password | `/forgot-password` | `POST /api/auth/reset-request` | Public | 5/h/IP. Always returns the same generic 200 message (no user enumeration). Invalidates all previous unused reset tokens, creates a fresh one (DB default: 32-byte hex, 1-hour expiry) and emails the link. | Straightforward fetch; show the server `message`. | P2 |
| Reset password | `/reset-password?token=…` | `POST /api/auth/reset-confirm` | Public | 10/h/IP. Token unknown → 400; used or expired → 410. Atomic claim (`used_at is null`) prevents double-use races. Password rule here: min 8 + ≥1 uppercase + ≥1 number (stricter than signup). No session is created; user logs in again. | Password-rule asymmetry with signup is a real trap. Same endpoint works from mobile. | P2 |
| Own profile | `/dashboard/profile` | `GET /api/profile`, `PATCH /api/profile`, `POST /api/profile/avatar`, `GET /api/profile/feed` | `requireSession("user")`; page redirects to `/login` otherwise | `PATCH /api/profile` writes `users.name` and `designer_profiles.bio/linkedin_url/portfolio_url`; accepts any trimmed string for URLs (no URL validation), `""` → `null`. Name edit here has no cooldown/validation beyond non-empty. Feed scopes: `all|thread|showcase|resource|event|saved` (saved = owner only). | Whole own-profile screen missing on mobile. PATCH body is plain JSON, field-per-key. | P1 |
| Member profile (other user) | `/dashboard/profile/[userId]` | `GET /api/profile/feed?user=<uuid>&scope=…` | `requireSession("user")`; self → redirect to own page; non-uuid → 404 | Blocking reshapes the page: owner blocked viewer → "Profile not available" (no name, no feed); viewer blocked owner → identity hero only, no feed. Feed tabs exclude `saved`. Block/unblock via `POST/DELETE /api/dm/blocks` (10/min/user). | Needs DM-block awareness for parity of the privacy behavior. | P2 |
| Profile identity edit (name/city/sector/level/title) | `/dashboard/settings/profile` (Edit Profile form) | `PATCH /api/profile/identity` | `requireSession("user")` | RPC `update_profile_identity`: per-slot 3-month cooldown (`profile_field_changes`), active master-data checks, and official-group swap (leave old city/sector/level/title community, upsert + join new one; "Other" produces no group). 409 `{error:"profile_field_cooldown", locked_fields:{slot: iso}}`; 404; 422s. Success returns `{changed_fields, left_communities, joined_communities}`. | Must reproduce cooldown UI from server `locked_fields` and the group-swap report. Partial payload = only changed slots; all keys optional but ≥1 required. | P2 |
| Avatar upload | `/dashboard/profile` (picker modal), `/signup` step 3 | `POST /api/profile/avatar` (signed-in), `POST /api/signup/avatar` (signup, 3 MB), `POST /api/signup/picture` (legacy pre-upload, currently uncalled by web UI) | user session / public signup | JPEG/PNG/WebP only, verified by magic bytes (MIME fails the request even if declared correctly). Limits: signup 3 MB, profile 5 MB (413). Stored in Cloudflare R2: `avatars/pending/{uuid}.{ext}` (signup), `avatars/{userId}/{ts}-{rand}.{ext}` (profile). DB: `designer_profiles.avatar_url` + `avatar_source='upload'`. Old object reclaimed if unreferenced. No rate limit on profile avatar. | Mobile must upload multipart field `file`; declared MIME + magic bytes must agree. Compress ≤400px to match web output; ≤3 MB for signup, ≤5 MB for profile. | P1 (signup part) / P2 (profile part) |
| Settings index | `/dashboard/settings` | none (static rows linked from `apps/web/lib/settings/sections.ts`) | page requires user session | 6 rows: profile, account, notifications, email, connected accounts, job profile. | Build as a list screen. | P2 |
| Settings — Account | `/dashboard/settings/account` | `POST /api/auth/reset-request` | user session | Email + "member since" read-only. No email-change flow exists. No self-serve account deletion. Only action is sending a password reset link. | Low effort; same reset-request endpoint. | P2 |
| Settings — Notifications | `/dashboard/settings/notifications` | `GET/PATCH /api/push/settings` | `requireSession("user")` | Per-key PATCH, boolean enums validated, quiet-hours `HH:MM` validated (`^(\d{1,2}):(\d{2})$`, 0–23/0–59, stored `HH:MM:00`), timezone must be a valid IANA name; send device timezone on quiet-hours saves. Defaults when row absent: chatPush on, communityPush on, sound default, quiet hours off, 22:00–07:00, tz UTC. `mutedCommunityIds` replaces the whole mute set (unmute all mine, then mute listed). GET also returns `unreadCount` (badge). | Mobile settings screen already exists (`app/settings/notifications.tsx`) and uses this API. | P1 (exists) |
| Settings — Email prefs | `/dashboard/settings/email` | `GET/PATCH /api/push/settings` | user session | `emailJobUpdates` (default true), `emailCommunityActivity` (true), `emailProductNews` (false) on the same `notification_preferences` row. Explicitly record-only: "Nothing on this card changes what email-sending code does today." | Ride the same PATCH; no extra endpoint. | P2 |
| Settings — Connected accounts | `/dashboard/settings/connected-accounts` | none | user session | Empty placeholder; no OAuth exists anywhere. | Web-only until OAuth exists; ship the same empty state if parity is required. | P3 / web-only |
| Settings — Job profile | `/dashboard/settings/job-profile` | `PATCH /api/profile` (portfolio autosave), `GET/POST/PATCH/DELETE /api/settings/resumes` | user session | Portfolio: debounced 900 ms PATCH, no URL validation. Resumes: max 3 (409), 5 MB (413), PDF/DOC/DOCX/RTF by magic bytes; exactly one `is_default` (partial unique index); delete promotes the oldest remaining; every mutation returns the full refreshed `{resumes}` list. | Apply-to-job users need this on mobile eventually; portfolio autosave alone is cheap. | P2 |
| Company verification (workplace) | `/dashboard/settings/profile` (Company card), profile hero company chip | `GET /api/companies/search?q=`, `POST /api/companies/verifications`, `POST /api/companies/verifications/confirm`, `GET /api/companies/membership` | user session | 6-digit code to a work email, TTL 30 min, max 5 attempts per challenge, hash-only storage. Rate: start 5/h/user + 10/h/IP; confirm 20/10 min/user. Company is derived from the verified domain, not the posted id. Many specific 409/410/422 statuses (see §13). | Considered profile-completing on web but not required for account use. | P3 |
| Notification inbox | `/dashboard/notifications` | `GET /api/notifications`, `PATCH /api/notifications` (`{id}` or `{all:true}`) | `requireSession("user")` (GET uses `verifyActive:false`) | 30 newest, `unread_count`; mark one/all read, realtime fan-out to other tabs. | Out of the auth scope but shares the bell/badge model. | P2 (separate audit) |
| Account deletion | none for users; admin UI `/admin/(protected)/users/[id]` | `DELETE /api/admin/users/[id]` | `requireSession("admin")` only | Hard delete: designer profile, users row (FK cascades), applications (frees email), R2 avatar; owned communities transferred to longest-standing member or deleted (trigger). No self-serve deletion API. | Blocker for App Store review if the mobile app allows creating an account (Apple 5.1.1(v) requires in-app deletion). Would need a new user-facing endpoint. | P1-decision (see blockers) |
| Rate limiting / global guard (cross-cutting) | middleware on every non-static request | — | — | Global per-key: burst 50/10 s, sustained 300/60 s (keyed by user id when the JWT verifies, else IP from `cf-connecting-ip` / `x-forwarded-for` / `x-real-ip`). Pages → 429 rewrite to `/too-many-requests`; APIs → JSON 429. Per-route limits in §17. Redis fail-open. | Mobile requests count too; ensure cookie is replayed so the limiter keys by user, not phone IP. | P1 |

---

## 1. Signup — direct (open registration)

Entry page: `apps/web/app/signup/page.tsx`. Three-step client flow. With neither `?token` nor `?resume`,
direct mode starts at step 1 immediately (`page.tsx:54-60`).

### Step 1 — validation only
- Client posts `{name, email, password, confirm_password}` to `POST /api/signup/direct`
  (`apps/web/app/signup/page.tsx:170-194`). `name` is a join of two mandatory inputs (Name + Surname),
  both required client-side (`page.tsx:171-177`).
- Schema `directSignupStep1Schema` (`apps/web/lib/validations.ts:46-59`):
  - `name`: 2–100 chars **and must contain ≥2 whitespace-separated words** ("Please enter both your name and surname.")
  - `email`: valid email
  - `password`: min 8 chars + **at least one number** (no uppercase requirement)
  - `confirm_password`: must equal `password` ("Passwords do not match")
- Handler `apps/web/app/api/signup/direct/route.ts`:
  - Rate limit `signup:step1:direct:v2:{ip}` 60 per 3600 s → 429 `{error:"Too many requests. Please try again later."}` + `Retry-After` (lines 11-20).
  - Invalid JSON → 400 `{error:"Invalid request body"}`; schema failure → 422 `{error:"Validation failed", issues:<fieldErrors>}`.
  - Existing email (case-insensitive) → 409 `{error:"An account with this email already exists."}` (lines 40-51).
  - On success upserts `signup_attempts` (`recordSignupAttempt`, best-effort) and returns `{success:true}` (lines 55-58). **Nothing is created; no session exists yet.**

### Step 2 — preferences (client-side only)
- No API call. The page fetches public dropdown data (`page.tsx:140-148`):
  - `GET /api/data/cities` → `{cities:[{id,name,image_url}]}`
  - `GET /api/data/sectors` → `{sectors:[{id,name,image_url}]}`
  - `GET /api/data/experience-levels` → `{experience_levels:[{id,slug,label,image_url}]}`
  - `GET /api/data/job-titles` → `{job_titles:[{id,slug,label,image_url}]}`
  (field names: `experience_levels.route.ts:25`, `job_titles.route.ts:25`; label = admin-managed `name`, value = `slug`).
- Required on submit: `city_id`, `sector_id`, `experience_level`, `job_title`; errors are inline strings
  ("Please select a city." etc., `page.tsx:213-216`). `signupStep2Schema` (`validations.ts:61-69`) requires
  uuids for city/sector and non-empty slug strings for level/title (master tables are the source of truth).

### Step 3 — optional picture, account creation
- `handleStep3` (`page.tsx:236-291`) builds:
  `{ identity: {name,email,password,confirm_password}, profile: step2, [token], [avatar_source:"upload"] }`
  and posts to `POST /api/signup/avatar`.
  - With a picture: `multipart/form-data` with field `payload` = JSON string and field `file` = WebP blob
    (`page.tsx:252-257`). With no picture: JSON body (`page.tsx:258-263`). "Skip" clears the blob and
    completes without one (`page.tsx:378-386`).
- Client-side image prep: `compressAvatarClient` → WebP quality 0.90, longest edge ≤ 400 px, never upscaled,
  alpha preserved (`apps/web/lib/image-client.ts:46,203-263`).
- Handler `apps/web/app/api/signup/avatar/route.ts` (this route IS the account-creation endpoint):
  - Rate limit `signup:finalize:v2:{ip}` 20/h → 429 + `Retry-After` (lines 32-41).
  - Body parsing: multipart or JSON; bad → 400; schema `completeSignupSchema` → 422 with `issues`
    (lines 43-70). Extra avatar guards: file without `avatar_source:"upload"` → 422; `avatar_source:"upload"`
    with neither file nor `avatar_url` → 422; `avatar_url` that is not an R2 URL → 422 `{error:"Invalid profile picture."}` (lines 76-86).
  - File checks: declared type ∈ {jpeg,png,webp} → else 422 "Only JPEG, PNG, and WebP images are allowed.";
    size > 3 MB → 422 "Image must be under 3 MB."; **magic-byte** detection → else 422 "That file is not a valid
    JPEG, PNG or WebP image."; R2 upload failure → 500 "Upload failed. Please try again." (lines 99-120).
  - `hashPassword` = bcrypt cost 10 (`apps/web/lib/auth/password.ts:13-17`).
  - Calls RPC `complete_signup` (`apps/web/lib/supabase/database.types.ts`; SQL:
    `supabase/migrations/20261008140000_remove_design_interests.sql:64-171`), parameters:
    `p_name, p_email` (lowercased), `p_password_hash, p_city_id, p_sector_id, p_experience_level (slug),
    p_job_title (slug), p_avatar_url, p_avatar_source ('upload'|null), p_invitation_token`.
    One transaction; inside it:
    - required non-empty name/email/hash/level/title → `22023 invalid_signup_payload`
    - avatar url/source must both be null or both set (sql:90-93)
    - invitation token must be unused & unexpired, locked `for update` → `P0001 invitation_unavailable`
    - email must not exist → `23505 email_already_registered`
    - city/sector/level/title must exist and be active → `23503 inactive_or_missing_profile_option`
    - inserts `users` + `designer_profiles`; marks invitation `used_at`
  - Error mapping (route lines 17-28, 142-153): `23505` → 409 "An account with this email already exists.";
    `P0001 invitation_unavailable` → 409 "This invitation link is no longer available."; `23503`/`22023` → 422
    "One or more signup selections are no longer available."; else 500 "Failed to create account. Please try again."
    On failure the just-uploaded R2 object is deleted (best-effort).
  - Post-success side effects (all best-effort except session):
    1. `markSignupCompleted(email, userId)` updates `signup_attempts` (line 159).
    2. `autoJoinCommunities(userId)` (lines 166-172) — creates/joins communities for city ("{City} Designers"),
       sector ("{Sector} Community"), level and title (admin name as-is), skipping any master value named
       "Other" (`apps/web/lib/communities/auto-join.ts:1-90`).
    3. `sendWelcomeEmail` (lines 177-181).
    4. Session: `createSession({userId, email, role:"user"})` + `setSessionCookie` (lines 183-195).
    5. Response: `{success:true, userId, avatar_url, joined_communities}` (count only).
- After success the page shows a welcome overlay (`joined_communities`) and "Go to dashboard" does
  `resetClientSessionCaches()` + `window.location.assign("/dashboard")` (`page.tsx:293-303`) — a full document
  load because Next's client Router Cache is URL-keyed and session-blind.

### Partial completion / abandoned states
- Nothing exists in DB except the `signup_attempts` row. Re-entering with the same email refreshes the attempt
  (`started_at`, `name`) and re-checks uniqueness; if the account was meanwhile created, 409 on step 1.
- Dead client branches exist but no route returns them today: signup checks `data.redirectToLogin` and login
  checks `data.showApplyLink` (`page.tsx:187`, `login/page.tsx:15,34`). Do not depend on them.

## 2. Signup — invitation

- Entry: `/signup?token=…`. Page validates first: `GET /api/signup/validate?token=` (`page.tsx:124-136`;
  route `apps/web/app/api/signup/validate/route.ts`). Public, **no rate limit** (only the middleware global guard).
  - No token → 400 `{valid:false,error:"Token is required"}`.
  - Unknown token → 404 "Invalid invitation link."
  - `used_at` → 410 "This invitation link has already been used."
  - expired → 410 "This invitation link has expired. Please contact us."
  - a `users` row already linked to the application → 410 "An account has already been created for this invitation."
  - valid → `{valid:true, applicationId, applicantName, applicantEmail}`; the page prefills name/email.
- Step 1 posts `{name,email,password,confirm_password, token}` to `POST /api/signup/complete`
  (`apps/web/app/api/signup/complete/route.ts`): rate `signup:step1:complete:v2:{ip}` 60/h → 429.
  Invitation invalid/used/expired → 409 "This invitation link is invalid, expired, or already used.";
  existing account by application **or** email → 409 "An account has already been created for this invitation or email.";
  success records the attempt with `flow:"invitation"` + `application_id` and returns `{success:true}`.
  The invitation is NOT consumed here — "Step one is validation-only. The invitation remains reusable until
  step four commits." (route line 74).
- Steps 2–3 identical to direct; the final payload adds `token`, and the RPC claims the invitation
  (`used_at`) inside the same transaction.

## 3. Signup — resume link and `signup_attempts` tracking

Tracking helpers: `apps/web/lib/signup-attempts.ts`.
- `recordSignupAttempt` upserts on `email` (unique): `{email, name, flow, application_id, status:"started", updated_at}`
  — refreshes `started_at`/`name` on repeat visits (lines 24-50).
- `markSignupCompleted(email, userId)` sets `{status:"completed", user_id, completed_at}` (lines 56-78).
- Table: `supabase/migrations/20260913130000_signup_attempts.sql` (columns `id, email unique, name, flow direct|invitation,
  application_id, status started|completed, user_id, started_at, updated_at, completed_at`) + resume columns in
  `20260913140000_signup_attempt_resume.sql` (`resume_token` unique partial index, `resume_token_expires_at`, `resume_email_sent_at`).
  RLS enabled with no policies → service-role only. Admin UI: `/admin/(protected)/signup-attempts`.

Resume link resolution: `GET /api/signup/resume?token=` (`apps/web/app/api/signup/resume/route.ts`). Public,
no rate limit. States: 400 token required; 500 "Something went wrong. Please try again." (lookup error);
404 "This link is invalid. Please start signup again."; 410 `status !== "started"` → "This signup has already
been completed."; 410 expired/missing `resume_token_expires_at` → "This link has expired. Please start signup
again."; valid → `{valid:true, name, email}`. The page prefills identity, shows a notice, and the member
picks a password (passwords are never stored). Resume mode posts step 1 to `/api/signup/direct` (token-free).

Admin trigger: `POST /api/admin/signup-attempts/[id]/resume` (`apps/web/app/api/admin/signup-attempts/[id]/resume/route.ts`),
admin session required. 404 "Signup not found."; 409 if already completed. Invitation flow: re-sends the
original invitation (409 "Their invitation has expired. Send a fresh invitation from Applications." when it
lapsed); direct flow: issues `resume_token = randomBytes(32).toString("hex")`, TTL
`INVITATION_EXPIRY_DAYS` (default 7, lines 7-11,101-111), rotates on every retry. Email failure → 502
"Failed to send the email. Please check the mail configuration and retry.". Success `{ok:true, method:"invitation"|"resume"}`.

## 4. Login

Page: `apps/web/app/login/page.tsx`. Client posts `{email, password}` to `POST /api/auth/login`.
On success: `resetClientSessionCaches()` then `window.location.assign(data.redirect ?? "/dashboard")`
(here `redirect` is only ever `"/admin"`), lines 49-51. "Google (coming soon)" button is disabled — no OAuth.

Handler `apps/web/app/api/auth/login/route.ts`:
1. IP = raw `x-forwarded-for` header or `"unknown"` (line 20 — not split on commas; see blockers).
2. Body: invalid JSON → 400 `{error:"Invalid request body"}`; `loginSchema` (`validations.ts:13-16`, email valid +
   password non-empty) → 422 `{error:"Validation failed", issues}`.
3. Rate limits run concurrently (lines 43-64): `login:ip:{ip}` 10/900 s and `login:email:{lowercased email}` 20/900 s.
   Either trip → 429 `{error:"Too many login attempts. Please try again later."}` + `Retry-After` seconds.
4. Admin short-circuit (lines 66-79): if `ADMIN_EMAIL` and `ADMIN_PASSWORD` env vars are set and
   `email.toLowerCase() === ADMIN_EMAIL.toLowerCase()` and `password === ADMIN_PASSWORD` (raw env comparison,
   not a hash) → `createSession({email: ADMIN_EMAIL, role:"admin"})` → `{success:true, redirect:"/admin"}` + cookie.
   Admin JWTs have **no `userId`**.
5. Member lookup: `users` joined with `designer_profiles!user_id(id)` (lines 93-99). Not found → 401
   `{error:"Invalid email or password."}` (no user enumeration). bcrypt mismatch → same 401 (line 109-115).
6. `is_blocked` → 403 `{error:"Your account has been suspended. Please contact support."}` (lines 117-122).
7. No `designer_profiles` row → 403 `{error:"Your account setup is incomplete. Please contact support so we
   can finish setting it up.", incompleteSignup:true}` (lines 124-133). Completeness = profile row existence
   only; a missing avatar never counts (`apps/web/lib/auth/signup-status.ts:25-29`).
8. Rehash-on-login: stored hash cost > 10 → recompute at cost 10 and persist (non-fatal; lines 139-147).
9. Success: `createSession({userId, email, role:"user"})`, cookie set, response `{success:true, name}` (lines 149-157).

Login page UI: generic error line; `showApplyLink` branch (never produced by the API today); password
visibility toggle; link to `/forgot-password`; link to `/signup`.

## 5. Logout

- `POST /api/auth/logout` (`apps/web/app/api/auth/logout/route.ts`): if no valid session → `200 {success:true}`
  **without touching cookies** ("Prevents a CSRF-forced logout from silently succeeding with no session.").
  With a session → `200 {success:true}` and clears `uxcommunity_session` + legacy `draft_session` (maxAge 0).
- Web client (`apps/web/components/ui/useLogout.ts:43-62`): POST → `resetClientSessionCaches()` → tear down
  realtime pool → `window.location.replace("/login")` (full document load). If the request fails, the user
  stays on the page. Admin has its own button `apps/web/app/admin/(protected)/LogoutButton.tsx`.
- Semantics: **stateless** — no server-side revocation. The JWT remains usable until its 7-day expiry if
  copied elsewhere. Push tokens are unregistered separately by the mobile client (`DELETE /api/push/register`).

## 6. Session / authorization model

### 6.1 Cookie + JWT
`apps/web/lib/auth/session.ts`:
- Cookie names: `uxcommunity_session`, legacy fallback `draft_session` (lines 6-7).
- JWT: `HS256`, secret `SESSION_SECRET` (throws if unset), payload
  `{userId?: string, email: string, role: "user"|"admin"}` (lines 13-31).
- Lifetime: `EXPIRY_SECONDS = 60*60*24*7` — **7 days**, `maxAge: 604800`. **No refresh and no sliding renewal**;
  sessions are created only by `/api/auth/login` and `/api/signup/avatar` (verified: only two `setSessionCookie`
  call sites).
- Cookie flags (`setSessionCookie`, lines 100-109): `httpOnly:true`, `secure: process.env.NODE_ENV === "production"`,
  `sameSite:"lax"`, `path:"/"`, and `domain:".uxcommunity.in"` when the request host is `uxcommunity.in` or a
  subdomain (or the `NEXT_PUBLIC_APP_URL` host fallback); localhost/loopback/IPs stay host-only (lines 64-98).
  Required because the realtime socket on `rt.uxcommunity.in` shares the cookie.
- `getSession()` (lines 49-56) reads cookies via `next/headers` **from the request `Cookie:` header** and
  verifies with `jose`; it never consults browser-specific state.

### 6.2 `requireSession`
`apps/web/lib/auth/session.ts:168-204` — the standard API-route guard:
- no session → throws `Response` 401 `{error:"Unauthorized"}`.
- role mismatch → 403 `{error:"Forbidden"}`.
- for `role:"user"` with `userId`, unless `{verifyActive:false}`, runs `assertUserActive` (lines 129-159):
  reads `users.id, is_blocked` (15-second per-user memo). Missing row or `is_blocked` → 401
  `{error:"Account has been deactivated or deleted."}`. `invalidateUserLiveness(userId)` can clear the memo
  early but currently has **no callers** — an admin block/delete therefore takes up to 15 s (per warm
  instance) to take effect on write routes. **Admin sessions skip this check.**
- Many read-only endpoints pass `verifyActive:false` (e.g. `/api/notifications`, `/api/home/feed`,
  `/api/profile/feed`, `/api/push/register` DELETE, `/api/dm/*`, `/api/communities/*` GETs) — a blocked user
  keeps read access for up to 7 days; every write path verifies liveness.
- Routes return the thrown `Response` verbatim (`catch (e) { return e as Response }`).

### 6.3 Middleware
`apps/web/middleware.ts` (matcher line 96-100 covers everything except `_next/` and static extensions —
so it also runs on `/api/**`):
- Global request rate limit first (lines 53-62): key = `user:{userId}` when the JWT verifies in middleware,
  else `ip:{cf-connecting-ip | first x-forwarded-for | x-real-ip}` (`apps/web/lib/global-request-rate-limit.ts:65-77`).
  Windows: burst 50/10 s and sustained 300/60 s (`:8-11`; sustained verdict cached ≤2 s per worker).
  Failure: API → JSON 429 `{error:"Too many requests. Please wait a moment and try again."}` with
  `Retry-After`, `X-RateLimit-Limit/Remaining/Reset` (via `getRateLimitHeaders`, `middleware.ts:17-38`);
  pages → rewrite to `/too-many-requests` (429).
- `/` and `/login` with a session → redirect `/admin` (admin) or `/dashboard` (lines 65-72).
- `/admin/*` requires `session.role === "admin"` else redirect `/login` (lines 75-81).
- `/dashboard/*` requires any session else redirect `/login` (lines 84-91).
- `/too-many-requests` and `/api/healthz` bypass even the limiter (line 44).

### 6.4 Origin / CSRF / User-Agent checks (mobile-relevant)
- **There are no origin, referer, `Sec-Fetch-*`, CSRF-token or User-Agent checks anywhere in the API
  surface.** A grep for `origin|referer|csrf|sec-fetch` across `apps/web/app/api/**` finds only comments and
  unrelated URL-parsing code; the only relevant comment is the logout CSRF note
  (`apps/web/app/api/auth/logout/route.ts:5-6`). Cookie protection is `SameSite=Lax` plus the JSON/multipart
  content requirement — browser-only defenses. A React Native client that replays the `Cookie:` header is
  accepted by every route, including middleware, because all reads go through the raw request headers.
- `User-Agent` is never inspected in the API or middleware (only used in `navigator.userAgent` UI polish in
  `apps/web/app/dashboard/Topbar.tsx:47`).

## 7. Password reset

### 7.1 Request
`POST /api/auth/reset-request` (`apps/web/app/api/auth/reset-request/route.ts`), from `/forgot-password` and
Settings → Account.
- Rate limit `reset-request:{ip}` 5/3600 s → 429 `{error:"Too many requests. Please try again later."}` (no `Retry-After`).
- Body: invalid JSON → 400; email invalid → 422 `{error:"Please enter a valid email address."}` (zod message
  "Please enter a valid email address").
- **Always** returns `200 {success:true, message:"If an account with that email exists, you'll receive a reset link shortly."}`
  (no enumeration). If the user exists: all prior unused tokens are invalidated
  (`used_at = now() where used_at is null`), a new `password_resets` row is inserted (DB default: token =
  32-byte hex, `expires_at = now() + 1 hour` — `supabase/migrations/001_password_resets.sql`), and the email
  is sent; email failures are logged but still return the generic OK.

### 7.2 Confirm
`POST /api/auth/reset-confirm` (`apps/web/app/api/auth/reset-confirm/route.ts`), from `/reset-password?token=…`.
- Rate limit `reset-confirm:{ip}` 10/3600 s → 429 `{error:"Too many requests. Please try again later."}` + `Retry-After`.
- Schema (lines 7-20): `token` min 1; `password` min 8 + **≥1 uppercase + ≥1 number**; `confirm_password` equality.
  Violations → 422 `{error:"Validation failed", issues:{…}}`. (Asymmetry vs signup: no uppercase rule at signup.)
- Unknown token → 400 `{error:"Invalid or expired reset link."}`; `used_at` set → 410 "This reset link has
  already been used. Please request a new one."; expired → 410 "This reset link has expired. Please request a new one.".
- Atomic claim: `update ... set used_at = now() where id = … and used_at is null` — losing a race → 410 (lines 84-96).
- `hashPassword` (cost 10) then `update users.password_hash`; DB error → rollback `used_at` to null and 500
  "Failed to update password. Please try again." (lines 98-117).
- Success `{success:true}`. **No session is issued** — the member logs in again. The page maps 400/410 to a
  terminal "Link invalid or expired" state (`apps/web/app/reset-password/page.tsx:52-54`).

## 8. Own profile (`/dashboard/profile`)

Server page `apps/web/app/dashboard/profile/page.tsx`:
- `getSession()`; non-user/absent → `redirect("/login")` (lines 16-17).
- Loads `users(name,email,created_at)` and `designer_profiles(avatar_url, avatar_source, experience_level,
  job_title, linkedin_url, portfolio_url, bio, cities(id,name), design_sectors(id,name))` plus company state
  (lines 25-38). Role pill label resolved from slugs via `apps/web/lib/profile/role-label.ts`.
- Initial tab from `?tab` if a valid `ProfileFeedScope` (`all|thread|showcase|resource|event|saved`), else `all` (line 20).

Client `ProfileClient.tsx`:
- Avatar picker (`ImagePickerModal`) → `handleSavePicture` posts multipart field `file` to
  `POST /api/profile/avatar`, sets returned `avatar_url`, then `router.refresh()` (lines 109-130).
- `AddLinkModal` for LinkedIn/portfolio posts JSON `{linkedin_url}` or `{portfolio_url}` to `PATCH /api/profile`
  (`AddLinkModal.tsx:49-68`); success updates local state + `router.refresh()`.
- Activity feed `GET /api/profile/feed?scope=…` (own: full scopes incl. `saved`) — route
  `apps/web/app/api/profile/feed/route.ts:1-110`; RPCs `get_profile_feed_page` / `get_member_feed_page`.
- Company chip/AddCompanyModal (see §13).

Data endpoints:
- `GET /api/profile` (`api/profile/route.ts:6-29`, `requireSession("user")`) → `{user:{name,email,created_at}|null,
  profile:{avatar_url, avatar_source, experience_level, job_title, linkedin_url, portfolio_url, bio,
  cities:{id,name}|null, design_sectors:{id,name}|null}|null}`.
- `PATCH /api/profile` (`:31-85`): body keys all optional strings — `name` (trimmed; empty → 422
  "Name cannot be empty."; writes `users.name`), `bio` (trim; empty → `null`), `linkedin_url`, `portfolio_url`
  (trim; empty → `null`; **no URL validation or length cap**). Partial failures → 500 "Failed to update name."
  / "Failed to update profile."; success `{success:true}`. Invalid JSON → 400 "Invalid JSON body.".
  This is the only writer for bio and the hero links; name/city/sector/level/title go through §10 instead
  when edited from Settings (Settings' LinkedIn/Portfolio cards use this same endpoint with 900 ms debounce —
  `LinkedInSection.tsx:21-40`, `PortfolioSection.tsx`).

## 9. Member profile (`/dashboard/profile/[userId]`)

`apps/web/app/dashboard/profile/[userId]/page.tsx`:
- Requires user session else `redirect("/login")` (line 50). Non-uuid → `notFound()` (line 53; regex
  `apps/web/lib/profile/links.ts:11-15`). Own id → redirect to `/dashboard/profile` (line 54).
- Loads `users(name,created_at)`, `designer_profiles(avatar_url, avatar_source, experience_level, job_title,
  linkedin_url, portfolio_url, bio, cities(id,name), design_sectors(id,name))`, company state, and DM block
  state in both directions (lines 62-83).
- If the owner blocked the viewer: neutral "Profile not available / This member has restricted who can view
  their profile." state — no name, no hero, no feed (lines 87-104). If the viewer blocked the owner: hero with
  block controls and **no tabs/feed** (lines 140-147). Tabs exclude `saved` (line 58) — "a member's saves are
  private" (`/api/profile/feed` docblock).
- Feed: `GET /api/profile/feed?user=<uuid>&scope=…`; a block in either direction returns `{items:[]}`-style
  empty data rather than an error (`api/profile/feed/route.ts:83-92`).
- Block/unblock: `POST /api/dm/blocks {user_id}` / `DELETE /api/dm/blocks?user_id=` (10 per 60 s per user →
  429 "Too many requests. Please slow down."; 422 "Invalid member." / "You cannot block yourself.";
  404 "Member not found."; idempotent; responses `{blocked:true|false}`)
  — `apps/web/app/api/dm/blocks/route.ts:21-105`.
- There are **no other privacy settings** (no field-level visibility, no private profile toggle). Blocking is
  the only privacy control, and it also suppresses DMs both ways via a DB trigger.

## 10. Profile identity edit (Edit Profile form)

Web path: profile hero "Edit Profile" → `/dashboard/settings/profile` → `ProfileSection` →
`components/profile/EditProfileForm.tsx` → `PATCH /api/profile/identity`.
Loader `apps/web/lib/profile/identity-server.ts` provides: current values, per-slot `locks` (ISO unlock dates),
option lists (active cities/sectors/levels/titles), and the member's current official group per dimension.

Request (`apps/web/app/api/profile/identity/route.ts:22-55`):
- `requireSession("user")`.
- Schema `profileIdentityUpdateSchema` (`validations.ts:89-98`): partial object of
  `name` (trim 2-100), `city_id` uuid, `sector_id` uuid, `experience_level` (non-empty slug),
  `job_title` (non-empty slug); must contain ≥1 key ("Nothing to update." → 422 with issues).
- Calls RPC `update_profile_identity(p_user_id, p_name?, p_city_id?, p_sector_id?, p_experience_level?, p_job_title?)`
  (`supabase/migrations/20261007120000_profile_identity_edit.sql:71-360`). `undefined` params keep DEFAULT NULL =
  "leave as is".

Rules inside the RPC (single transaction):
- Locks the member's `users` + `designer_profiles` rows `for update`.
- Only *actually changed* values count as changed slots; a no-op returns
  `{changed_fields:[], left_communities:[], joined_communities:[]}`.
- Cooldown: each of `name | job_title | experience_level | city | sector` may change once per 3 months
  (`profile_field_changes`, PK `(user_id, field)`; unlock = `changed_at + interval '3 months'`, clamped like
  calendar months — see `lib/profile/identity.ts:73-82`). Violation → `P0001 profile_field_cooldown` with
  `detail = {slot: available_at}` JSON.
- Cooldown is re-checked inside the upsert (`ON CONFLICT ... WHERE changed_at <= now() - interval '3 months'`)
  so concurrent edits cannot both spend one slot (sql:237-250).
- New values must exist in master data and be active (`23503`), name non-empty (`22023 invalid_name`),
  profile exists (`P0002 profile_not_found`).
- Official-group swap: for each changed dimension, delete membership (+ admin permissions rows) in the
  community tied to the old value, then upsert + join the community tied to the new value
  (name rules identical to `auto-join`: city = "{City} Designers", sector = "{Sector} Community",
  level/title = admin name; "Other" creates/joins nothing). System groups are ownerless; the RPC never
  touches an owned community.

Route error mapping (lines 57-82): 409 `{error:"profile_field_cooldown", locked_fields:{slot:iso}}`;
404 `{error:"Profile not found."}`; 422 `{error:"Name cannot be empty."}`; 422 `{error:"One of your selections
is no longer available. Please pick again."}`; else 500 "Failed to update profile. Please try again.".
Success returns the RPC jsonb directly: `{changed_fields, left_communities, joined_communities}` where each
community is `{id, name, image_url}`. The form shows "Profile updated" plus the Left/Joined group lists and
calls `router.refresh()` + `invalidateCommunitiesList()`
(`components/profile/EditProfileForm.tsx:326-390`, `ProfileSection.tsx:30-33`).

## 11. Avatar upload pipeline

Storage: Cloudflare R2 via `apps/web/lib/r2.ts` (`uploadToR2`, `deleteFromR2`, `deleteR2AssetIfUnreferenced`,
`parseR2Key`). URLs returned are the object's public URL.

| Surface | Endpoint | Field | Size cap | R2 key | DB write |
|---|---|---|---|---|---|
| Signup finalize | `POST /api/signup/avatar` | `file` (multipart, `payload` JSON sibling) or pre-uploaded `avatar_url` | **3 MB** | `avatars/pending/{uuid}.{ext}` | set inside RPC `complete_signup` (`designer_profiles.avatar_url`, `avatar_source='upload'`) |
| Signup pre-upload (currently not called by the web UI) | `POST /api/signup/picture` | `file` | 3 MB | `avatars/pending/{uuid}.{ext}` | none — returns `{success:true, avatar_url}` for the finalize call |
| Signed-in profile | `POST /api/profile/avatar` | `file` | **5 MB** (413 "File exceeds 5 MB limit.") | `avatars/{userId}/{Date.now()}-{random}.{ext}` | `designer_profiles.avatar_url` + `avatar_source='upload'`; previous object reclaimed if unreferenced |

Shared rules:
- Content-type must be `multipart/form-data` (profile route: otherwise 415 "A profile picture upload is
  required."); missing file → 422.
- Declared MIME allow-list: `image/jpeg`, `image/png`, `image/webp` (signup: "Only JPEG, PNG, and WebP images
  are allowed."; profile: "Only JPEG, PNG and WebP are accepted.").
- The declared type is re-verified against the file's **magic bytes** (`detectImageMime`,
  `apps/web/lib/image-utils.ts:26-39`): JPEG `FFD8`, PNG signature, `RIFF....WEBP`. Failure → 422
  "That file is not a valid JPEG, PNG or WebP image.". Stored extension comes from the detected MIME
  (`extensionForMime`), defaulting to `webp`.
- Both forms compress client-side first: WebP q0.90, longest edge ≤ 400 px, never upscaled
  (`compressAvatarClient`, `lib/image-client.ts:46,261-263`). GIF/AVIF are therefore never produced;
  a raw GIF would fail the magic-byte check (detect only knows jpeg/png/webp).
- Profile route removes the replaced object only if no other media column references it (lines 88-97).
- No rate limit on `/api/profile/avatar`; signup routes limited (20/h/IP each).
- `avatar_source` constraint: null or `'upload'` only (`supabase/migrations/20260826010000_remove_generated_avatars.sql:13-17`).

## 12. Bio, LinkedIn, portfolio links

- `bio`: written only by `PATCH /api/profile` (trimmed; empty clears to null). Shown on the profile card
  (own and member pages) as `initialBio` / `bio`.
- `linkedin_url`, `portfolio_url`: written by `PATCH /api/profile`; no validation (see §8). Rendered as
  hero link buttons. Web has two entry points (profile hero modal + Settings cards), all hitting the same
  endpoint; Settings cards debounce 900 ms and show a Saving/Saved/Error status
  (`SaveStatus.tsx`). Clearing is done by sending `""` (stored as NULL).
- Application flow (out of scope but shares field names): `applicationSchema` requires a `linkedin.com` URL
  and a valid portfolio URL (`validations.ts:3-11`) — this stricter rule does NOT apply to profile links.

## 13. Company verification (workplace badge)

Endpoints (all `requireSession("user")`):
- `GET /api/companies/search?q=` — `verifyActive:false`.
- `POST /api/companies/verifications` — start/resend a challenge (`app/api/companies/verifications/route.ts`).
  - Rate: `company-verification:{userId}` 5/3600 s + `company-verification-ip:{ip}` 10/3600 s → 429
    `{error:"rate_limited", message:"Too many verification emails requested. Try again later."}`.
  - Body `{company_id?, company_name?, work_email?, verification_id?}` (need `work_email` or `verification_id`).
  - 400 `invalid_body`; 422 `invalid_email`/`personal_email` (free providers rejected via `checkWorkEmail`),
    422 `company_name_domain_mismatch` (+ `domain`, `suggested_name` — a new company's name must match the
    domain it proves), 422 `company_name_required`.
  - DB-derived failures: 410 `company_inactive`; 409 `company_name_taken`, `domain_not_verified_for_company`,
    `domain_already_verified` (message suggests joining the owner company), `already_member`; 401 `unknown_user`;
    404 `not_found` (resend id gone); 503 `not_installed`; 500 `unexpected`.
  - Success: `{pending:{...}}` — only a masked work email, the raw address never leaves the server.
  - Code: 6 digits, TTL 30 min, max 5 guesses per challenge, sha256(pepper+code) stored
    (`lib/companies/codes.ts:13-16,30-37`).
- `POST /api/companies/verifications/confirm` — body `{verification_id: uuid, code: "000000"}`.
  - Rate `company-verify-confirm:{userId}` 20/600 s → 429.
  - Success: `{company:{...}}`. Failures: 422 `invalid_code` (+`attemptsLeft`, `maxAttempts`),
    404 `not_found`, 409 `already_used`, 410 `expired`, 429 `too_many_attempts`, 410 `company_inactive`,
    409 `domain_not_verified`, 409 `domain_already_verified` (with the winning company when raced),
    503 `not_installed`, 500 `unexpected`.
- `GET /api/companies/membership` — current membership state for the settings card.
- Client: `components/companies/AddCompanyModal.tsx` (search at :143, start at :211, confirm at :277);
  Company card on `/dashboard/settings/profile` (`CompanySection.tsx`) and the company chip on the profile hero.

## 14. Settings tree

Index `/dashboard/settings` (rows defined in `apps/web/lib/settings/sections.ts:26-57`); layout is a
max-width column (`settings/layout.tsx`). Every drill-down page independently calls
`getSession()` and redirects non-user roles to `/login` (e.g. `account/page.tsx:11-12`, `notifications/page.tsx:11-12`).

### 14.1 Account — `/dashboard/settings/account`
- `loadAccount` reads `users(email, created_at)`; email falls back to the session email; "member since" is
  formatted server-side as `"October 2026"` style (`lib/settings/load.ts:41-60`).
- Both rows are read-only by design: no email change flow ("changing it needs a verification flow that does
  not exist yet" — `AccountSection.tsx:12-21`).
- Only action: "Send reset link" → `POST /api/auth/reset-request` with the account email; shows the server
  message or a generic failure (`AccountSection.tsx:27-52`).

### 14.2 Profile — `/dashboard/settings/profile`
Cards (page `profile/page.tsx:21-49`):
1. **Profile** — identity edit (see §10).
2. **Company** — work-email verification (see §13).
3. **LinkedIn** — debounced PATCH `/api/profile` (see §8).
4. **Portfolio** — same (also on Job profile).

### 14.3 Notifications — `/dashboard/settings/notifications`
- Server-loads `loadNotificationPreferences` (`lib/settings/load.ts:67-100`) — same defaults and `HH:MM`
  conversion as the API so the page and `/api/push/settings` can never disagree.
- UI toggles: Push notifications (`chatPushEnabled`), Community updates (`communityPushEnabled`),
  Message sound (`chatSound` "default"|"silent"), Quiet hours (`quietHoursEnabled` + `quietHoursStart/End`).
- Every change is one single-key PATCH to `/api/push/settings`; no debounce; the control reverts on failure
  (only while the field still holds the attempted value) (`NotificationsSection.tsx:35-74`).
- Quiet-hours saves always include `quietHoursTimezone` from `Intl.DateTimeFormat().resolvedOptions().timeZone`
  (fallback UTC) — the window is evaluated in the member's own zone (`lib/push/preferences.ts:135-160`).
- Quiet-hours policy that mobile must match (for badge/push behavior parity): window can cross midnight;
  when enabled and start≠end, pushes inside the window are silenced; invalid tz ⇒ quiet hours treated as off
  (`lib/push/preferences.ts:146-165`). Audible push budget: max 3 audible per (member, community) per rolling
  60 s, rest silent, per `lib/push/preferences.ts:32-40`.
- Note: the UI sends quiet-hours times in `HH:MM`; the server stores `HH:MM:00`.

### 14.4 Email — `/dashboard/settings/email`
- Same loader row; toggles `emailJobUpdates` (default true), `emailCommunityActivity` (true),
  `emailProductNews` (false); same single-key PATCH behavior (`EmailSection.tsx:27-51`).
- Explicitly does not change email-sending code paths today ("only records the member's choice").

### 14.5 Connected accounts — `/dashboard/settings/connected-accounts`
- Static placeholder: "No accounts connected yet." No OAuth anywhere in the product
  (`ConnectedAccountsSection.tsx:1-31`). Web-only.

## 15. Notification inbox (`GET/PATCH /api/notifications`)

- `GET` (`requireSession("user", {verifyActive:false})`): newest 30, fields
  `id, user_id, actor_id, community_id, type, entity_type, entity_id, title, body, href, metadata, read_at, created_at`
  plus `unread_count`. → `{notifications:[…], unread_count:n}`; failure 500 "Failed to load notifications.".
- `PATCH` (verifyActive default true): `{id}` marks one read, `{all:true}` marks every unread read; both
  return `{ok:true}` and publish realtime updates to the member's notifications room. Not-found/foreign id:
  update simply matches nothing (still `{ok:true}` unless a DB error → 500). Missing id → 422 "Notification id is required."
- Related: read-state is mirrored client-side by `lib/notifications-seen.ts`, `lib/notifications-tabs.ts`
  (web only); badge total via `get_unread_message_totals` surfaced in `/api/push/settings`.

## 16. Account deletion (admin-only today)

- **No user-facing delete endpoint exists.** The only deletion path is
  `DELETE /api/admin/users/[id]` (`requireSession("admin")` — `apps/web/app/api/admin/users/[id]/route.ts:128-282`):
  1. Reads `application_id, email` and the avatar URL; pre-computes which owned communities will be
     transferred (longest-standing remaining member, `joined_at` ascending) vs deleted (no members left).
  2. Deletes `designer_profiles`, then `users` (DB cascades + BEFORE DELETE trigger
     `20260913150000_community_ownership_on_user_delete.sql` hands over/deletes owned communities).
  3. Deletes `applications` rows (by id then by email) so the address can reapply.
  4. Deletes the R2 avatar if unreferenced; reclaims media of deleted communities; anything missed is left to
     the R2 orphan audit. Response: `{success:true, communities:{transferred:[…], deleted:[…], r2_cleanup:[…]}}`.
- Cascade/attribution/R2-residue details: `docs/user-deletion-audit.md` (surviving rows: `communities.owner_id`
  `set null` was fixed by the trigger; `notifications.actor_id`, `signup_attempts.user_id` survive by design).
- Block/unblock (the softer admin action): `PATCH /api/admin/users/[id]` `{is_blocked:boolean}` → 422 if not
  boolean; blocking takes effect at next login and at next non-cached liveness check on write APIs.
- **Parity implication:** if the mobile app creates accounts, iOS App Store guideline 5.1.1(v) generally
  requires in-app account deletion — none exists for members; the mobile team must either add a user-facing
  endpoint/server action or ship without account creation.

## 17. Rate-limit reference (all implemented via `apps/web/lib/auth/rate-limit.ts`, Upstash sliding window)

| Key | Limit | Window | Route/file |
|---|---|---|---|
| `signup:step1:direct:v2:{ip}` | 60 | 3600 s | `api/signup/direct/route.ts:11` |
| `signup:step1:complete:v2:{ip}` | 60 | 3600 s | `api/signup/complete/route.ts:11` |
| `signup:finalize:v2:{ip}` | 20 | 3600 s | `api/signup/avatar/route.ts:32` |
| `signup:picture:v2:{ip}` | 20 | 3600 s | `api/signup/picture/route.ts:20` |
| `login:ip:{ip}` | 10 | 900 s | `api/auth/login/route.ts:44` |
| `login:email:{email}` | 20 | 900 s | `api/auth/login/route.ts:45` |
| `me:ip:{ip}` | 60 | 60 s | `api/auth/me/route.ts:9` |
| `reset-request:{ip}` | 5 | 3600 s | `api/auth/reset-request/route.ts:13` |
| `reset-confirm:{ip}` | 10 | 3600 s | `api/auth/reset-confirm/route.ts:24` |
| `company-verification:{userId}` / `-ip:{ip}` | 5 / 10 | 3600 s | `api/companies/verifications/route.ts:130-133` |
| `company-verify-confirm:{userId}` | 20 | 600 s | `api/companies/verifications/confirm/route.ts:84` |
| `dm:block:{userId}:60s` | 10 | 60 s | `api/dm/blocks/route.ts:49,87` |
| `global-request:burst:{key}` | 50 | 10 s | `lib/global-request-rate-limit.ts:9`, middleware |
| `global-request:sustained:{key}` | 300 | 60 s | `lib/global-request-rate-limit.ts:10`, middleware |

- Limiter is **fail-open**: missing Upstash env vars (`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`) or
  a Redis error allow the request through (`lib/auth/rate-limit.ts:62-68,78-86`).
- `{ip}` is `x-forwarded-for` (raw header value, not split) or `"unknown"` in most routes; the company route
  and the middleware key instead prefer `cf-connecting-ip` → first `x-forwarded-for` → `x-real-ip`.
- `/api/signup/validate` and `/api/signup/resume` have no per-route limit (global guard only).
- Rate-limited JSON always includes `Retry-After` except `reset-request` (which omits it).

## 18. Membership & permissions model

- **"Member"** = a `users` row with a 1:1 `designer_profiles` row. The profile row is the completeness
  signal everywhere (`lib/auth/signup-status.ts`); a user without it gets the 403 `incompleteSignup` at login.
  There is no separate membership verification for the account itself (no approval gate for direct signup).
- **`is_blocked`** (`users.is_blocked`, migration `20260718_add_is_blocked_to_users.sql`): blocks login (403)
  and fails the per-request liveness check (401 `{error:"Account has been deactivated or deleted."}`) on
  verified routes. Read-only routes with `verifyActive:false` still work for a blocked holder for the token's
  7-day lifetime.
- **Admin**: identified ONLY by env credentials at login (`ADMIN_EMAIL`/`ADMIN_PASSWORD`,
  `api/auth/login/route.ts:66-79`). The resulting JWT is `{email, role:"admin"}` with **no `userId`**. Every
  admin surface enforces it independently: middleware redirects non-admin page requests
  (`middleware.ts:75-81`), every `/api/admin/**` route calls `requireSession("admin")` (403 vs 401),
  and admin JWTs skip the DB liveness check. There is no `is_admin` column anywhere.
- **Role in responses**: `/api/auth/me` returns `role:"user"` or `role:"admin"`; login returns
  `redirect:"/admin"` for admin. Admin accounts cannot use member features that need `userId`
  (e.g. `/api/push/settings` requires `role:"user"`).
- **Community-level roles** (owner/admin/moderator of a community, `community_members.role` +
  `community_admin_permissions`) are per-community and enforced per route — out of this audit's scope but
  required before a mobile community-admin console reaches parity.

---

## Mobile auth compatibility

### Cookie name and how APIs read it
- Session cookie: **`uxcommunity_session`** (`lib/auth/session.ts:6`). Legacy `draft_session` is still read
  as a fallback in middleware and `getSession`. Mobile should only ever write `uxcommunity_session`.
- All server reads go through the raw `Cookie:` request header: middleware via `request.cookies`
  (`middleware.ts:48-51`), route handlers via `cookies()` in `getSession()` (`session.ts:49-56`). Nothing
  depends on the browser beyond that header, so the replay approach used in
  `expo-app-standalone 3/lib/api.ts` (extract `Set-Cookie` value → `AsyncStorage` → `Cookie:` header on every
  request) is fully supported by every route audited here.
- Login/signup responses set exactly this cookie; logout clears it (maxAge 0) plus the legacy name.
  React Native may only surface one combined `set-cookie` header; the mobile client ignores the header on
  logout and clears local storage unconditionally (`lib/api.ts:89-94`), which is the correct behavior.

### What could block the replay approach (and what does not)
Verified by reading the code and grepping the whole API surface:
- **No origin/referer/`Sec-Fetch-*` checks** on any auth/profile/settings route.
- **No CSRF token requirement.** The only CSRF-related code is the logout guard (don't clear without a
  session). `SameSite=Lax` on the cookie is a browser-only mitigation and is irrelevant to a replayed header.
- **No User-Agent assumption** anywhere server-side (only cosmetic client code).
- Real friction points:
  1. **IP extraction for rate limits.** Most routes read the raw `x-forwarded-for` header
     (e.g. `login/route.ts:20`, `me/route.ts:8`). Through Cloudflare this header is populated, but a client
     talking to the origin directly would present no header → the key becomes `"unknown"` and ALL such
     clients share one bucket (10 logins/15 min globally, etc.). The middleware's global limiter uses
     `cf-connecting-ip` first, which Cloudflare sets. Ensure the mobile app always reaches the app through the
     same edge (or a proxy that sets the header).
  2. **7-day hard session, no refresh.** There is no refresh endpoint and no sliding renewal; the JWT's
     `exp` is fixed at issue. `/api/auth/me` returns `200 {user:null}` for an expired token (not 401), so
     mobile must treat `user:null` (or a 401 from any other API) as signed out, clear storage and route to
     login. `AuthContext.refresh()` on app start is the right probe.
  3. **Stateless logout.** The token remains valid until `exp`; logout is cookie-clearing only. If the mobile
     app copies the JWT anywhere else (analytics, logs), it stays usable. There is no denylist to call.
  4. **Liveness 401s mid-session.** If an admin blocks/deletes the account, member APIs return 401
     `{error:"Account has been deactivated or deleted."}` on write paths (up to 15 s cached), while
     `verifyActive:false` read routes keep working. Mobile 401 handling must cover this, not just
     `{user:null}`.
  5. **Admin JWT has no `userId`.** Any mobile admin screen must not assume `/me` returns an id for admins,
     and member-only endpoints (push register/settings, profile, resumes) will 403 `{error:"Forbidden"}` for
     the admin role.

### Token expiry / refresh behavior
- Issued with `iat` + `exp = iat + 604800s` (`session.ts:8,29`). Cookie `maxAge` matches. No rotation on any
  request; re-login is the only way to start a new 7-day window.
- Expired token behavior: middleware treats it as no session (redirects pages to `/login`); `/api/auth/me`
  returns `200 {user:null}`; all `requireSession` routes return 401 `{error:"Unauthorized"}`.
- Cookie domain `.uxcommunity.in` in production is only a browser concern; replaying the raw value works
  from any host (the mobile app targets its configured `EXPO_PUBLIC_API_URL`).

### Logout semantics
- Server: POST `/api/auth/logout` → clears both cookies if a valid session exists; otherwise no-op 200.
  No server state changes; the JWT is not revoked.
- Mobile (existing, `AuthContext.tsx:94-104`): tear down realtime → `DELETE /api/push/register` (unregister
  the device so the next person doesn't get this account's pushes) → `POST /api/auth/logout` →
  `clearSession()` in a `finally` → `setUser(null)`. This exactly matches the server's semantics and should
  be preserved.

### Signup from mobile — feasibility summary
- All signup endpoints are replay-compatible (public JSON/multipart, `Set-Cookie` on the final call):
  `POST /api/signup/direct` → `POST /api/signup/avatar` (multipart `payload` + `file`) → store the returned
  cookie. The RPC performs all uniqueness/activity checks; the mobile client only needs the same field names
  (`identity.name/email/password/confirm_password`, `profile.city_id/sector_id/experience_level/job_title`).
- Avatar parity detail: web compresses avatars to WebP ≤400 px before upload; the shared mobile
  `lib/prepareImage.ts` defaults to a 2560 px cap — pass the 400 px cap (or rely on the server's 3 MB/5 MB
  caps) when adding mobile avatar upload.
- Email verification/OTP does not exist, so there is no OTP screen to reproduce. The only OTP in the product
  is the company work-email challenge (§13), which is optional.

### Known client quirks worth copying (not breaking)
- Login and signup completion on web both do a **full document navigation** after a session boundary because
  Next's client Router Cache is URL-keyed and session-blind (`app/login/page.tsx:41-51`,
  `app/signup/page.tsx:293-303`). Mobile has no equivalent cache; the important part is clearing any cached
  user data on login/logout (mobile already does this via `resetRealtimeSession` + `clearSession`).
- Web login accepts `data.redirect` (`"/admin"` for admin) — mobile `lib/auth.ts` already reads it as
  `isAdmin`.
