# apps/web

The Next.js 14 (App Router) web application for the **draft/** platform.

## What's in here

### Routes

| Path | Who can access | What it does |
|---|---|---|
| `/` | Public | Landing / home page |
| `/login` | Public | Email + password login |
| `/apply` | Public | Designer application form |
| `/signup/*` | Invited users (token) | Multi-step onboarding: profile → avatar → interests |
| `/reset-password` | Public | Request / confirm password reset |
| `/dashboard/*` | Authenticated users | Member area |
| `/admin/*` | Admin only | Admin panel (see below) |

### Admin panel (`/admin`)

Protected by middleware — requires a valid session with `role: "admin"`.

| Section | What it manages |
|---|---|
| Applications | Review pending applications, approve or reject with email notification |
| Users | View all members, block/unblock accounts |
| Communities | Create/edit communities, delete messages |
| Master data | Cities, companies, sectors, experience levels, interests, tools, Lottie animations |

### API routes (`app/api/`)

| Prefix | Purpose |
|---|---|
| `/api/auth/*` | login, logout, me, reset-request, reset-confirm |
| `/api/applications` | Public apply endpoint (rate-limited: 5/hr per IP) |
| `/api/signup/*` | Multi-step onboarding (validate token, profile, avatar, interests, complete) |
| `/api/profile/*` | Update profile and interests (authenticated) |
| `/api/communities/*` | List, join, send/read messages, mark read |
| `/api/data/*` | Public reference data (cities, sectors, experience levels, interests, companies) |
| `/api/admin/*` | All admin CRUD — protected by admin session check |

## Auth

Sessions use custom signed JWTs (`jose`) stored in an httpOnly cookie — **not** Supabase Auth. The session payload carries `userId`, `email`, and `role` (`"user"` | `"admin"`).

`middleware.ts` intercepts every request to `/admin/*` and `/dashboard/*`, verifies the JWT, checks the user's role, and does a lightweight Supabase lookup to confirm the account isn't blocked or deleted before forwarding.

## Rate limiting

`lib/auth/rate-limit.ts` provides an async `rateLimit(key, limit, windowS)` backed by **Upstash Redis** using a sliding window algorithm. It is applied to:

| Endpoint | Limit |
|---|---|
| `POST /api/auth/login` (per IP) | 10 requests / 15 min |
| `POST /api/auth/login` (per email) | 20 requests / 15 min |
| `POST /api/applications` (per IP) | 5 requests / hour |
| `POST /api/auth/reset-request` (per IP) | 5 requests / hour |

**Fail-open policy:** if Redis is unreachable, the request is allowed through and the error is logged. See `lib/auth/rate-limit.ts` for details.

Required env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — get both from the [Upstash console](https://console.upstash.com).

## Image uploads

Avatars and community images are uploaded to **Supabase Storage** via signed URLs. Before storing, images are compressed server-side with `sharp` to keep storage and bandwidth costs low.

## Email

Transactional emails (designer invite, password reset) are sent via **Resend**. Templates live in `lib/email/`.

## Running locally

From the **repo root**:

```bash
npm install        # installs all workspaces
npm run dev        # starts the Next.js dev server on http://localhost:3000
```

Copy `apps/web/.env.example` → `apps/web/.env.local` and fill in all values before starting.

## Environment variables

See `.env.example` for the full annotated list. All variables are required for full functionality.
