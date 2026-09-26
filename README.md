# uxcommunity/ — a home for designers

A platform for UI/UX, product, and social media designers. Designers sign up directly, complete their profile, and get access to real-time community chat; admins review applications, manage members and master data, and moderate communities.

## What the app does today

| Area | What's built |
|---|---|
| **Application / onboarding** | Direct multi-step sign-up (profile → avatar → interests) at `/signup`, with invite links for approved/invited users. Applications still land in the admin dashboard for approve/reject review with email notifications. |
| **Auth** | Custom JWT sessions via `jose` + `bcryptjs`. No Supabase Auth — sessions live in an httpOnly cookie. Includes login, logout, password-reset request/confirm. |
| **Admin panel** | Review and approve/reject applications; manage users (block/unblock/delete); community admins & permissions; CRUD for master data: cities, sectors, experience levels, interests, job titles, communities, Lottie animations; incomplete sign-up recovery; R2 storage health audit; k6 load-test runs. |
| **Communities / chat** | Real-time community chat (Cloudflare Durable Objects — see `apps/realtime`). Members are auto-joined to communities on sign-up. Admins can delete messages. |
| **Image & file uploads** | Avatars, community images, chat/thread/showcase/event media uploaded to Cloudflare R2 (S3-compatible). Clients compress before upload (Canvas on web, `expo-image-manipulator` on mobile) and the server validates the bytes (signature sniffing) and stores them as-is. Orphaned objects are reclaimed by a reference-aware cleanup plus an admin R2 audit. |
| **Rate limiting** | Redis-backed sliding-window limiter (Upstash) plus a global middleware guard. Per-route limits cover login (IP + email), applications, password reset, sign-up, chat sends, and content creation. |
| **Push notifications** | Expo push to mobile devices for new chat messages, with per-member audible budgets, quiet hours, and muted-community preferences. |

## Stack

- **Web app:** Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Realtime:** Cloudflare Worker + Durable Objects (`apps/realtime`) — one `Room` DO per community, one `UserDO` per user for notifications/profile rooms
- **Mobile:** Expo SDK 54 + React Native (`expo-app-standalone 3/`), Expo Router, React Query
- **Database:** Supabase (PostgreSQL + Row Level Security)
- **Auth:** Custom JWT sessions (`jose`, `bcryptjs`) — not Supabase Auth
- **Rate limiting:** Upstash Redis (`@upstash/ratelimit`)
- **Email:** Resend
- **Storage:** Cloudflare R2 (S3-compatible) for all uploaded media
- **Image processing:** client-side Canvas (web) and `expo-image-manipulator` (mobile); server-side signature validation
- **Validation:** Zod
- **Shared code:** `packages/shared` (types, constants, R2 media lookup table) and `packages/design-system` (tokens, themes)

## Project structure

```
uxcommunity/
├── apps/
│   ├── web/                    Next.js web app (see apps/web/README.md)
│   │   ├── app/
│   │   │   ├── login/ apply/ forgot-password/ reset-password/ signup/ join/   Public pages
│   │   │   ├── admin/          Admin panel (protected — admin role required)
│   │   │   │   └── (protected)/  users, communities, master data, signup attempts, tools, load test
│   │   │   ├── dashboard/      Member area (protected — user role required)
│   │   │   └── api/            129 route handlers (auth, admin, communities, home, push, …)
│   │   ├── components/         UI: admin/, communities/, feeds/, sidebar/, home/, …
│   │   ├── lib/                Domain + client code: auth/, communities/ (+ models/, tests),
│   │   │                       realtime/, push/, supabase/, home/, feeds/, r2*/
│   │   ├── middleware.ts       Session check, route protection, global request rate limit
│   │   └── wrangler.toml       OpenNext worker config (vercel.json is the alternate target)
│   └── realtime/               Cloudflare Worker: Room DO (per community) + UserDO (per user)
│       ├── src/                index.ts, room.ts, user.ts, room-routing.ts, subscriptions.ts
│       └── __tests__/          vitest suites (unit + staging harnesses)
├── expo-app-standalone 3/      Mobile app — Expo / React Native + Expo Router
│   │                           (note: folder name contains a space — quote it in commands)
│   │                           Architecture: docs/mobile-architecture.md
│   ├── app/                    Expo Router tree: (auth)/, (tabs)/, community/, settings/
│   ├── components/             chat/, communities/, community/ & shared UI
│   ├── context/                AuthContext and providers
│   ├── hooks/                  useChatMessages, useCommunities, usePushNotifications, …
│   ├── lib/                    api, auth, realtime (Cloudflare WS client), push, …
│   ├── app.json                Expo config (package/bundle ids, plugins)
│   ├── eas.json                EAS Build profiles (development / preview / production)
│   └── android/ ios/           Native projects (generated by `expo prebuild`)
├── packages/
│   ├── shared/                 TS types, constants, R2 media lookup table, video config
│   └── design-system/          Design tokens, themes, CSS + DESIGN_GUIDELINES.md
├── supabase/
│   ├── migrations/             SQL migration files (apply in order)
│   ├── schema.sql              Partial snapshot — SQL tests need the full migration history
│   ├── seed.sql
│   └── tests/                  pgTAP suites + run-local.sh
├── k6/                         k6 load/stress scenarios (see k6/README.md)
├── docs/                       Architecture, mobile, performance and audit docs (see below)
├── scripts/                    Build helpers (emoji extraction, etc.)
└── package.json                npm workspaces root
```

## Docs

| Doc | What it covers |
|---|---|
| `docs/architecture-refactor.md` | Dependency-direction refactor: domain models, membership gate, `CommunityChat` split |
| `docs/mobile-architecture.md` | Expo routing, auth gates, realtime chat and push notifications |
| `docs/mobile-design-system.md` | How the mobile app consumes the shared design tokens |
| `docs/performance-audit.md` | Ranked API/realtime performance findings and recommendations |
| `docs/user-deletion-audit.md` | What `DELETE /api/admin/users/[id]` removes, cascades, and leaves in R2 |
| `INFRASTRUCTURE-AUDIT.md` | Full production infrastructure audit (deployment, flows, scale, cost) |

## Prerequisites

- **Node.js 22+** (LTS; `package.json` engines and CI both require it — wrangler 4.x needs 22)
- **npm 10+**
- A **Supabase** project (PostgreSQL database)
- A **Cloudflare R2** bucket + public domain (for uploaded media)
- An **Upstash Redis** database (for rate limiting)
- A **Resend** account (for transactional email)
- A **GIPHY** API key (for GIF/sticker search)

## Local setup

```bash
# 1. Install all workspace dependencies
npm install

# 2. Copy and fill in env vars
cp apps/web/.env.example apps/web/.env.local

# 3. Apply database migrations
# Run each file in supabase/migrations/ in order via the Supabase SQL editor

# 4. Start the web dev server (terminal 1)
npm run dev
```

### SQL tests

`supabase/tests/*.test.sql` are pgTAP files. Run them against a local database
built from the **whole migration history** — not from `supabase/schema.sql`
alone, which is a partial snapshot and is missing constraints that later
migrations add, so a fixture can look green locally and fail in the SQL editor:

```bash
bash supabase/tests/run-local.sh                      # every test file
bash supabase/tests/run-local.sh supabase/tests/sidebar_scan_bounds.test.sql
```

The script boots a throwaway PostgreSQL in `/tmp` (unix socket only, no Docker,
no Supabase CLI, nothing left behind), applies `schema.sql` and every migration
in order, and reports each assertion. See the header of the script for the limits
of the pgTAP stand-ins and the Supabase-only objects it cannot create.

Open **http://localhost:3000**.

### Tests & checks

| Command | What it runs |
|---|---|
| `cd apps/web && npx tsc --noEmit` | TypeScript check across the web app (blocking in CI) |
| `cd apps/web && npx eslint .` | ESLint (advisory in CI while pre-existing findings are cleared) |
| `npm run test:<suite>` | One web unit suite, e.g. `npm run test:comment-tree` (all suites are listed in `package.json`) |
| `cd apps/realtime && npm test` | Realtime worker suites (vitest); `npm run test:perf` for the perf set |
| `bash supabase/tests/run-local.sh` | pgTAP SQL suites against a throwaway local PostgreSQL |
| `npm run test:k6-fixtures` | k6 fixture shape + "no credentials tracked" guards |

CI (`.github/workflows/ci.yml`) runs the blocking type check and the full web
unit suite (50 `*.test.ts` files, executed with `tsx --test`).

### Realtime locally (chat, typing indicator, reactions)

Realtime runs on a separate Cloudflare worker in `apps/realtime` (Durable Objects). To have it work locally you need **two terminals** — one for the web app, one for the realtime worker:

```bash
# Terminal 1 — web app
npm run dev

# Terminal 2 — realtime worker
cd apps/realtime && npx wrangler dev   # serves ws://localhost:8787
```

The web app's client connects to `ws://localhost:8787` and the server-side fan-out publishes to `http://localhost:8787/publish`. In addition to the vars from `.env.example`, `apps/web/.env.local` needs:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_REALTIME_URL` | `http://localhost:8787` |
| `REALTIME_URL` | `http://localhost:8787` |
| `REALTIME_PUBLISH_SECRET` | any value — must match the worker's |

And `apps/realtime/.dev.vars` (gitignored, create by hand):

```
SESSION_SECRET=<SAME value as apps/web/.env.local>
REALTIME_PUBLISH_SECRET=<SAME value as apps/web/.env.local>
API_URL=<the web app origin, e.g. http://localhost:3000>
API_SECRET=<any value — must match the web app's>
```

The worker uses `API_URL` + `API_SECRET` for its internal membership checks, so both files must agree on `API_SECRET` as well.

> The worker verifies WebSocket handshakes with the same JWT the web app signs. If `SESSION_SECRET` differs between the two files, the worker rejects every connection with a silent 401: nothing arrives live, and chat/notifications only catch up on load, focus, or the next sidebar fetch.

**Troubleshooting:** if messages, typing, and reactions only appear after a reload or tab focus, the WebSocket isn't connected. Make sure terminal 2 is running, then check DevTools → Network → WS for a `ws://localhost:8787/ws?...` connection.

In production the same flow runs against `rt.uxcommunity.in` — the CI deploy (`Deploy to Cloudflare`) mirrors `apps/web/wrangler.toml [vars]` into the client build automatically, so `NEXT_PUBLIC_REALTIME_URL` is only a local-dev concern.

### Cloudflare deployment targets

The root `wrangler.toml` intentionally targets `uxcommunity-realtime`, which owns both Durable Object classes (`Room` for communities, `UserDO` for user rooms). Run `npm run deploy:realtime` for that Worker and `npm run deploy:web` for the separate OpenNext web Worker; never deploy the web bundle with the root Wrangler configuration.

## Building the Android APK locally (no Expo cloud)

The mobile app lives in `expo-app-standalone 3/` (Expo / React Native, managed workflow). To produce an installable APK on your own machine you need:

- **JDK 17+** (JDK 21 works)
- **Android SDK** (via Android Studio), with `ANDROID_HOME` pointing at it — on macOS typically `~/Library/Android/sdk`

### One-time: generate the native project

```bash
cd "expo-app-standalone 3"
npx expo prebuild --platform android --no-install
```

This creates the `android/` folder from `app.json` + plugins. Re-run it only if you change native config (app.json plugins, permissions, icons, native deps). Don't hand-edit files in `android/` — they're regenerated.

### Build the APK

```bash
cd "expo-app-standalone 3/android"
export ANDROID_HOME=~/Library/Android/sdk      # if not already set
./gradlew assembleRelease
```

The first build downloads several GB of gradle dependencies and can take 10–20 minutes; later builds are incremental and much faster. The JS bundle is compiled into the APK by gradle (via Expo's gradle plugin), so **every code change requires re-running this build** — no dev server needed at runtime.

There's a helper script that runs the same build and logs to `/tmp/gradle-build.log` (useful when running it detached so it survives closing the terminal):

```bash
"expo-app-standalone 3/android/build-apk.sh"
```

### Where the APK is

```
expo-app-standalone 3/android/app/build/outputs/apk/release/app-release.apk
```

### Install it on a phone

Copy the APK to the device (Drive, chat, USB) and open it there, allowing "install unknown apps" when prompted — or over USB with debugging enabled:

```bash
~/Library/Android/sdk/platform-tools/adb install \
  "expo-app-standalone 3/android/app/build/outputs/apk/release/app-release.apk"
```

### Caveats

- **Signing:** prebuild's default template signs release builds with the debug keystore. Fine for personal/testing installs, but create a real keystore and configure signing before any Play Store release.
- **Size:** the APK bundles all CPU architectures (~90 MB). Build per-ABI APKs (`ndk.abiFilters` or `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`) for a much smaller file.
- **Env vars:** `EXPO_PUBLIC_*` values (API URL, realtime URL) are baked in at build time from `.env` / `eas.json`, so the APK talks to whatever environment was set when it was built.
- **Cloud alternative:** `npx eas-cli build -p android --profile preview` builds an APK on Expo's servers (see `eas.json`) and prints a download link.

## Environment variables

See `apps/web/.env.example` for the full list with comments. Summary:

| Variable | What it's for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key — server-only, never expose to the client |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Cloudflare R2 credentials, bucket name, and public delivery domain |
| `GIPHY_API_KEY` | GIPHY API key for GIF/sticker search |
| `SESSION_SECRET` | Secret used to sign JWT session tokens (`openssl rand -base64 32`) |
| `ADMIN_EMAIL` | Email address for the single built-in admin account |
| `ADMIN_PASSWORD` | Plain-text password for the admin account |
| `RESEND_API_KEY` | Resend API key for sending invite and password-reset emails |
| `EMAIL_FROM` | Sender address for transactional emails |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint URL (rate limiting) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token (rate limiting) |

## CI/CD

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | PR + push to `main` | Blocking TypeScript check and the full web unit suite; ESLint advisory |
| `.github/workflows/preview.yml` | PR opened/updated | Builds a per-PR Cloudflare worker (`uxcommunity-web-preview-pr<N>`) and comments the URL; realtime is disabled in previews |
| `.github/workflows/deploy.yml` | Push to `main` | Deploys the web worker (OpenNext) and the realtime worker to Cloudflare |

## Known limitations

- **Admin auth is a single env-var credential** (`ADMIN_EMAIL` + `ADMIN_PASSWORD`). There is no multi-admin system, no admin user records in the database, and no per-admin audit log.
- **Rate limiter fails open.** If Upstash Redis is unreachable, the rate limiter allows requests through and logs an error. This keeps the app available during Redis outages but means rate limits won't be enforced in that window.
- **The `main` branch deploys on merge.** Both workers ship from `deploy.yml`; the PR preview worker is the only pre-merge environment.

## Rebrand notes

The product is branded **UX Community** in the web and mobile interfaces, metadata,
emails, seed descriptions, performance-test examples, and documentation. Existing
database table names remain unchanged for compatibility with existing data.
