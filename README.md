# draft/ — a home for designers

A full-stack platform for UI/UX, product, and social media designers. Designers apply to join, admins review applications, approved members complete their profile and get access to a real-time community chat.

## What the app does today

| Area | What's built |
|---|---|
| **Application / onboarding** | Public apply form → admin review → approval email with invite link → multi-step sign-up (profile, avatar upload, interests) |
| **Auth** | Custom JWT sessions via `jose` + `bcryptjs`. No Supabase Auth — sessions live in an httpOnly cookie. Includes login, logout, password-reset request/confirm. |
| **Admin panel** | Review and approve/reject applications; manage users (block/unblock); CRUD for master data: cities, companies, sectors, experience levels, interests, communities, Lottie animations. |
| **Communities / chat** | Real-time community chat (Supabase Realtime). Members are auto-joined to communities on sign-up. Admins can delete messages. |
| **Image uploads** | Avatar and community images uploaded via signed Supabase Storage URLs, compressed server-side with `sharp`. |
| **Rate limiting** | Redis-backed sliding-window rate limiter (Upstash) on login (IP + email), application submission, and password-reset requests. |

## Stack

- **Web app:** Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Database:** Supabase (PostgreSQL + Row Level Security + Realtime)
- **Auth:** Custom JWT sessions (`jose`, `bcryptjs`) — not Supabase Auth
- **Rate limiting:** Upstash Redis (`@upstash/ratelimit`)
- **Email:** Resend
- **Image processing:** `sharp`
- **Validation:** Zod
- **Shared code:** `packages/shared` — types & constants shared across apps

## Project structure

```
draft/
├── apps/
│   └── web/                    Next.js web app
│       ├── app/
│       │   ├── (auth)/         Public pages: login, apply, sign-up flow, password reset
│       │   ├── admin/          Admin panel (protected — admin role required)
│       │   │   └── (protected)/  applications, users, communities, master data
│       │   ├── dashboard/      Member area (protected — user role required)
│       │   └── api/
│       │       ├── admin/      Admin-only API routes
│       │       ├── auth/       login, logout, me, reset-request, reset-confirm
│       │       ├── applications/  Public apply endpoint
│       │       ├── communities/   Chat messages, membership, read receipts
│       │       ├── signup/     Multi-step onboarding endpoints
│       │       ├── profile/    Profile & interests update
│       │       └── data/       Public reference data (cities, sectors, etc.)
│       ├── lib/
│       │   ├── auth/           session.ts, rate-limit.ts, middleware helpers
│       │   ├── supabase/       service.ts (server-only), browser.ts
│       │   └── email/          Resend templates (invite, password reset)
│       ├── middleware.ts        Route protection: /admin and /dashboard
│       └── .env.example
├── packages/
│   ├── shared/                 Shared TS types, constants, Zod schemas
│   └── design-system/          Shared UI component guidelines
├── supabase/
│   └── migrations/             SQL migration files (apply in order)
└── package.json                npm workspaces root
```

## Prerequisites

- **Node.js 18.18+** (20 LTS recommended)
- **npm 9+**
- A **Supabase** project (database + storage + realtime)
- An **Upstash Redis** database (for rate limiting)
- A **Resend** account (for transactional email)

## Local setup

```bash
# 1. Install all workspace dependencies
npm install

# 2. Copy and fill in env vars
cp apps/web/.env.example apps/web/.env.local

# 3. Apply database migrations
# Run each file in supabase/migrations/ in order via the Supabase SQL editor

# 4. Start the dev server
npm run dev
```

Open **http://localhost:3000**.

## Environment variables

See `apps/web/.env.example` for the full list with comments. Summary:

| Variable | What it's for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key (safe to expose in browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key — server-only, never expose to the client |
| `SESSION_SECRET` | Secret used to sign JWT session tokens (`openssl rand -base64 32`) |
| `ADMIN_EMAIL` | Email address for the single built-in admin account |
| `ADMIN_PASSWORD` | Plain-text password for the admin account |
| `RESEND_API_KEY` | Resend API key for sending invite and password-reset emails |
| `EMAIL_FROM` | Sender address for transactional emails |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint URL (rate limiting) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token (rate limiting) |

## Known limitations

- **No automated test suite.** There are no unit or integration tests in the repo yet.
- **No CI/CD pipeline.** Deployments are manual.
- **Admin auth is a single env-var credential** (`ADMIN_EMAIL` + `ADMIN_PASSWORD`). There is no multi-admin system, no admin user records in the database, and no per-admin audit log.
- **Rate limiter fails open.** If Upstash Redis is unreachable, the rate limiter allows requests through and logs an error. This keeps the app available during Redis outages but means rate limits won't be enforced in that window.
