# apps/web

The Next.js 14 (App Router) web application for the **UX Community** platform.
Realtime runs out-of-process on the Cloudflare Worker in `apps/realtime`.

## What's in here

### Routes

| Path | Who can access | What it does |
|---|---|---|
| `/` | Public | Landing / home page |
| `/login` | Public | Email + password login |
| `/signup` | Public | Multi-step onboarding: profile → avatar/picture → complete |
| `/join/[token]` | Invited users | Community invite landing |
| `/forgot-password` | Public | Request a password reset email |
| `/reset-password` | Public | Confirm a password reset |
| `/too-many-requests` | Public | Rate-limit fallback (middleware rewrite) |
| `/dashboard/*` | Authenticated users | Home feed, communities, threads, events, resources, showcase, notifications, profile, library, jobs, settings, verification |
| `/dashboard/verification` | Authenticated users | Read-only account verification form and review status |
| `/admin/*` | Admin only | Admin panel (see below) |

### Admin panel (`/admin`)

Protected by middleware — requires a valid session with `role: "admin"`.

| Section | What it manages |
|---|---|
| Users | View all members, block/unblock, open a profile, delete accounts |
| Verifications | Review LinkedIn/portfolio/work samples and approve or reject read-only accounts |
| Communities | Create/edit communities, community admins & permissions |
| Master data | Cities, sectors, experience levels, job titles, Lottie animations |
| Signup attempts | Incomplete sign-ups; send a resume link |
| Tools | R2 storage health (orphan scan/delete) and related maintenance |
| Load test | Admin-triggered k6 smoke/load runs |

### API routes (`app/api/`)

187 route handlers:

| Prefix | Purpose |
|---|---|
| `/api/auth/*` | login, logout, logout-all, change-password, me, reset-request, reset-confirm, session-ended |
| `/api/signup/*` | Multi-step onboarding: direct, profile, avatar, picture, resume |
| `/api/verification/*` | Status, email OTP, work-sample upload, review submission |
| `/api/profile/*` | Update profile, avatar |
| `/api/communities/*` | Communities, membership, invites, chat messages + reactions + upload, read receipts, threads, events, resources, showcase, comments, rules, content reactions |
| `/api/home/*` | Home feed pages |
| `/api/notifications` | List, mark read, clear |
| `/api/push/*` | Expo push registration, settings, test push |
| `/api/data/*` | Public reference data (cities, sectors, experience levels, job titles) |
| `/api/admin/*` | Admin CRUD, uploads, `r2-audit`, `load-test`, signup attempts |
| `/api/giphy`, `/api/link-preview`, `/api/lottie-settings`, `/api/image-download`, `/api/healthz` | Supporting endpoints |

## Auth

Sessions use custom signed JWTs (`jose`) stored in an httpOnly cookie — **not** Supabase Auth. The session payload carries `userId`, `email`, `role` (`"user"` | `"admin"`), a registry session id (`sid`) and, for users, the account generation (`sv`). `lib/auth/session.ts` owns signing/verification plus `getSession()` / `requireSession(role?)`.

The JWT signature is only the first check. `getSession()` loads the `auth_sessions` row and its embedded `users` row, then `lib/auth/session-validity.ts` requires the row to be unrevoked and unexpired, the role/subject to match, and both the row and account `session_version` to equal `sv`. A revoked row, blocked account, deleted account or stale generation returns `null`; database errors fail closed. `requireSession()` uses the same decision, so route handlers, server pages and the private R2 proxies cannot drift apart.

`middleware.ts` is a cheap prefilter: it verifies the signature, enforces the global request rate limit and protects `/admin/*` and `/dashboard/*`. It deliberately does not redirect `/` or `/login` from a signature-only check; those pages and the protected layouts perform the registry-backed check.

`lib/auth/session-registry.ts` wraps the service-role SQL functions that issue, revoke and rotate sessions. See `audit/SESSION_REVOCATION_IMPLEMENTATION.md` for the full lifecycle, realtime propagation and limitations.

## Realtime

`lib/realtime/` is the client/server realtime layer for the Cloudflare Worker in `apps/realtime`:

| File | Role |
|---|---|
| `client.ts` | Multiplexed WebSocket singleton (ref-counted rooms/topics, reconnect with backoff) |
| `pool.ts` | Community-scoped room pool with a 5-minute idle release |
| `rooms.ts` | Room-name helpers (client-safe) |
| `publish.ts` | Server-side `/publish` client (`publishRealtime`, `publishRealtimeBatch`) |
| `revoke.ts` | Posts a sid/all/exceptSid revocation to the Worker after a database session revoke |
| `server.ts` | `publishChatEvent` — publishes one event to a community's chat room |

New sockets are accepted only after the Worker verifies the JWT and calls
`/api/internal/session/validate` (API_SECRET-gated) to check the registry row
and account version. Revocation closes matching live sockets with code 4001;
the web client treats 4001 as terminal and redirects to login.

Community rooms (`chat:*`, `presence:*`, `threads:*`, `events:*`, `resources:*`, `showcase:*`, `rules:*`) are served by one `Room` Durable Object per community; user rooms (`notifications:*`, `profile:*`) share the recipient's `UserDO`. The sidebar keeps at most `SIDEBAR_REALTIME_LIMIT` (15) community chat sockets open, most-recently-active first.

## Push notifications

`lib/push/` sends Expo push messages for chat activity: `chat.ts` resolves recipients in chunks, applies per-member audible budgets and quiet hours, deletes dead tokens, and reports exactly how many devices were reached; `expo.ts` is the provider boundary — batches to Expo's 100-per-request limit, keeps a bounded number of requests in flight, paces dispatch to `PUSH_RATE_LIMIT` notifications/sec (per invocation, not project-wide: concurrent fan-outs can exceed Expo's 600/s ceiling together, which the 429 + `Retry-After` retry path absorbs), retries transient failures (and only the messages Expo did not acknowledge) and never retries a permanent one; `unread-totals.ts` computes badge counts. Registration and preferences live under `/api/push/*`. Delivery limits are env-tunable: `PUSH_BATCH_SIZE`, `PUSH_MAX_CONCURRENCY`, `PUSH_RATE_LIMIT`, `PUSH_MAX_RETRIES`, `PUSH_RETRY_BASE_MS`, `PUSH_RETRY_MAX_MS`, `PUSH_REQUEST_TIMEOUT_MS`, `PUSH_MAX_DELIVERIES`, `PUSH_TIME_BUDGET_MS`.

## Rate limiting

`lib/auth/rate-limit.ts` provides an async `rateLimit(key, limit, windowS)` backed by **Upstash Redis** (sliding window). `lib/global-request-rate-limit.ts` adds the middleware-wide guard (20 requests/10s burst, 120/60s sustained per user or IP). Current per-route limits:

| Endpoint | Limit |
|---|---|
| `POST /api/auth/login` (per IP) | 10 requests / 15 min |
| `POST /api/auth/login` (per email) | 20 requests / 15 min |
| `GET /api/auth/me` (per IP) | 60 requests / min |
| `POST /api/auth/reset-request` (per IP) | 5 requests / hour |
| `POST /api/auth/reset-confirm` (per IP) | 10 requests / hour |
| `POST /api/signup/*` (per IP) | 20–60 requests / hour, per step |
| `POST /api/communities/[id]/messages` (per user) | 5 / 10 s and 20 / 60 s |
| Content creation (threads, resources, showcase) | 5–10 / min |
| Comments (threads, resources, events, showcase) | 15–20 / min |
| Comment reactions | 60 / min |

Static assets and Next.js HMR endpoints are excluded. API requests receive a `429` JSON response; page requests are rewritten to `/too-many-requests` with `Retry-After` headers.

**Fail-open policy:** if Redis is unreachable, the request is allowed through and the error is logged. See `lib/auth/rate-limit.ts` for details.

Required env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — get both from the [Upstash console](https://console.upstash.com).

## Media uploads

All uploads go to **Cloudflare R2** (S3-compatible) — not Supabase Storage. Public media (avatars, community DPs, Lottie, threads/showcase/events/chat) lives in `R2_BUCKET_NAME` and is served from `R2_PUBLIC_URL` via `lib/r2.ts`. **Private documents** (job-application résumés, saved résumés, verification work samples, DM images) live in `R2_PRIVATE_BUCKET_NAME` with public access disabled; `lib/r2-private.ts` stores keys, signs 5-minute downloads only after an ownership check, and writes `Cache-Control: private, no-store`. The browser compresses images before upload (`lib/image-client.ts`, Canvas → WebP) and the server stores the bytes as-is after validating the declared type **and** sniffing the file signature (`lib/image-utils.ts`). Showcase media uses an upload-ticket flow so large files go straight to R2. Public deletions are reference-checked by `lib/r2-cleanup.ts` (shared lookup table in `packages/shared/src/r2-media.ts`); private keys are cleaned by `lib/private-storage-cleanup.ts`. Anything missed can be reviewed in **Admin → Tools → R2 storage health** (`/api/admin/r2-audit`).

## Email

Transactional emails are sent via **Resend** from `lib/email/index.ts`: password reset, welcome, and resume-signup templates.

## Tests

Unit suites live next to the code as `*.test.ts` (50 files, run with `tsx --test`). From the **repo root**:

```bash
npm run test:comment-tree      # one suite, e.g. comment tree helpers
cd apps/realtime && npm test   # realtime worker suites (vitest)
bash supabase/tests/run-local.sh   # SQL suites for the community APIs, including session_revocation.test.sql
```

`npm run test:*` in the root `package.json` lists every suite. CI (`.github/workflows/ci.yml`) runs a blocking `tsc --noEmit` and the whole web unit suite; ESLint is advisory while pre-existing findings are cleared.

## Running locally

From the **repo root**:

```bash
npm install        # installs all workspaces
npm run dev        # starts the Next.js dev server on http://localhost:3000
npm run dev:realtime   # optional second terminal: realtime worker on ws://localhost:8787
```

Create `apps/web/.env.local` and fill in every value listed under **Environment variables** in the root README before starting. Realtime needs the matching `REALTIME_*` vars, listed in the same table.

The app is branded **UX Community**. The existing `draft_session` cookie is
accepted during rollout so rebranding does not invalidate active sessions;
new logins use `uxcommunity_session`.

## Deployment

- **Cloudflare Workers** via OpenNext (`wrangler.toml`, `npm run deploy`) — the only deployment target.
- **Previews:** `.github/workflows/preview.yml` builds a per-PR worker with realtime disabled.

## Environment variables

The full list — Supabase, R2, Upstash Redis, Resend, GIPHY, session, and realtime values — is under **Environment variables** in the root README. All of them are required for full functionality.
