# apps/web

The Next.js 14 (App Router) web application for the **UX Community** platform.
Realtime runs out-of-process on the Cloudflare Worker in `apps/realtime`.

## What's in here

### Routes

| Path | Who can access | What it does |
|---|---|---|
| `/` | Public | Landing / home page |
| `/login` | Public | Email + password login |
| `/apply` | Public | Inactive: redirects to `/signup` (the old apply form is preserved but not shown) |
| `/signup` | Public | Multi-step onboarding: profile → avatar/picture → complete |
| `/join/[token]` | Invited users | Community invite landing |
| `/forgot-password` | Public | Request a password reset email |
| `/reset-password` | Public | Confirm a password reset |
| `/too-many-requests` | Public | Rate-limit fallback (middleware rewrite) |
| `/dashboard/*` | Authenticated users | Home feed, communities, threads, events, resources, showcase, notifications, profile, library, jobs, settings |
| `/admin/*` | Admin only | Admin panel (see below) |

### Admin panel (`/admin`)

Protected by middleware — requires a valid session with `role: "admin"`.

| Section | What it manages |
|---|---|
| Dashboard (`/admin`) | Applications review — all / pending / approved / rejected tabs, detail modal, approve & reject |
| Users | View all members, block/unblock, open a profile, delete accounts |
| Communities | Create/edit communities, community admins & permissions |
| Master data | Cities, sectors, experience levels, interests, job titles, Lottie animations |
| Signup attempts | Incomplete sign-ups; send a resume link |
| Tools | R2 storage health (orphan scan/delete) and related maintenance |
| Load test | Admin-triggered k6 smoke/load runs |

### API routes (`app/api/`)

129 route handlers:

| Prefix | Purpose |
|---|---|
| `/api/auth/*` | login, logout, me, reset-request, reset-confirm |
| `/api/applications` | Application submission endpoint (rate-limited: 5/hr per IP) |
| `/api/signup/*` | Multi-step onboarding: validate, direct, profile, avatar, picture, complete, resume |
| `/api/profile/*` | Update profile, interests, avatar |
| `/api/communities/*` | Communities, membership, invites, chat messages + reactions + upload, read receipts, threads, events, resources, showcase, comments, rules, content reactions |
| `/api/home/*` | Home feed pages |
| `/api/notifications` | List, mark read, clear |
| `/api/push/*` | Expo push registration, settings, test push |
| `/api/data/*` | Public reference data (cities, sectors, experience levels, interests) |
| `/api/admin/*` | Admin CRUD, uploads, `r2-audit`, `load-test`, signup attempts |
| `/api/giphy`, `/api/link-preview`, `/api/lottie-settings`, `/api/image-download`, `/api/healthz` | Supporting endpoints |

## Auth

Sessions use custom signed JWTs (`jose`) stored in an httpOnly cookie — **not** Supabase Auth. The session payload carries `userId`, `email`, and `role` (`"user"` | `"admin"`). `lib/auth/session.ts` owns signing/verification plus `requireSession(role?)` for route handlers.

`middleware.ts` is the first gate on every page request: it verifies the JWT, enforces the global request rate limit, redirects signed-in users away from `/` and `/login`, and protects `/admin/*` and `/dashboard/*`. Per-user liveness (blocked/deleted accounts) is checked by `lib/auth/user-status-cache.ts`, which caches the lookup for 15 seconds.

## Realtime

`lib/realtime/` is the client/server realtime layer for the Cloudflare Worker in `apps/realtime`:

| File | Role |
|---|---|
| `client.ts` | Multiplexed WebSocket singleton (ref-counted rooms/topics, reconnect with backoff) |
| `pool.ts` | Community-scoped room pool with a 5-minute idle release |
| `rooms.ts` | Room-name helpers (client-safe) |
| `publish.ts` | Server-side `/publish` client (`publishRealtime`, `publishRealtimeBatch`) |
| `server.ts` | `publishChatEvent` — publishes one event to a community's chat room |

Community rooms (`chat:*`, `presence:*`, `threads:*`, `events:*`, `resources:*`, `showcase:*`, `rules:*`) are served by one `Room` Durable Object per community; user rooms (`notifications:*`, `profile:*`) share the recipient's `UserDO`. The sidebar keeps at most `SIDEBAR_REALTIME_LIMIT` (15) community chat sockets open, most-recently-active first.

## Push notifications

`lib/push/` sends Expo push messages for chat activity: `chat.ts` resolves recipients in chunks, applies per-member audible budgets and quiet hours, and deletes dead tokens; `unread-totals.ts` computes badge counts. Registration and preferences live under `/api/push/*`.

## Rate limiting

`lib/auth/rate-limit.ts` provides an async `rateLimit(key, limit, windowS)` backed by **Upstash Redis** (sliding window). `lib/global-request-rate-limit.ts` adds the middleware-wide guard (20 requests/10s burst, 120/60s sustained per user or IP). Current per-route limits:

| Endpoint | Limit |
|---|---|
| `POST /api/auth/login` (per IP) | 10 requests / 15 min |
| `POST /api/auth/login` (per email) | 20 requests / 15 min |
| `GET /api/auth/me` (per IP) | 60 requests / min |
| `POST /api/applications` (per IP) | 5 requests / hour |
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

All uploads go to **Cloudflare R2** (S3-compatible) through `lib/r2.ts` — not Supabase Storage. The browser compresses images before upload (`lib/image-client.ts`, Canvas → WebP) and the server stores the bytes as-is after validating the declared type **and** sniffing the file signature (`lib/image-utils.ts`). Showcase media uses an upload-ticket flow so large files go straight to R2. Deletions are reference-checked by `lib/r2-cleanup.ts` (shared lookup table in `packages/shared/src/r2-media.ts`), and anything missed can be reclaimed from **Admin → Tools → R2 storage health** (`/api/admin/r2-audit`).

## Email

Transactional emails are sent via **Resend** from `lib/email/index.ts`: password reset, invitation, welcome, resume-signup, and rejection templates.

## Tests

Unit suites live next to the code as `*.test.ts` (50 files, run with `tsx --test`). From the **repo root**:

```bash
npm run test:comment-tree      # one suite, e.g. comment tree helpers
cd apps/realtime && npm test   # realtime worker suites (vitest)
bash supabase/tests/run-local.sh   # SQL suites for the community APIs
```

`npm run test:*` in the root `package.json` lists every suite. CI (`.github/workflows/ci.yml`) runs a blocking `tsc --noEmit` and the whole web unit suite; ESLint is advisory while pre-existing findings are cleared.

## Running locally

From the **repo root**:

```bash
npm install        # installs all workspaces
npm run dev        # starts the Next.js dev server on http://localhost:3000
npm run dev:realtime   # optional second terminal: realtime worker on ws://localhost:8787
```

Copy `apps/web/.env.example` → `apps/web/.env.local` and fill in all values before starting. Realtime needs the matching `REALTIME_*` vars (see the root README).

The app is branded **UX Community**. The existing `draft_session` cookie is
accepted during rollout so rebranding does not invalidate active sessions;
new logins use `uxcommunity_session`.

## Deployment

- **Primary:** Cloudflare Workers via OpenNext (`wrangler.toml`, `npm run deploy`).
- **Alternate:** Vercel (`vercel.json`, region `syd1`).
- **Previews:** `.github/workflows/preview.yml` builds a per-PR worker with realtime disabled.

## Environment variables

See `.env.example` for the full annotated list, including Supabase, R2, Upstash Redis, Resend, GIPHY, session, and realtime values. All variables are required for full functionality.
