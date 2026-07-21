# Draft — Designer Platform

A Next.js 14 + Supabase platform for designers (UI/UX, product, social media).

## Stack
- **Monorepo:** npm Workspaces (`apps/web`, `packages/shared`)
- **Frontend:** Next.js 14 App Router, TypeScript, Tailwind CSS
- **Backend/Auth/DB:** Supabase (Auth + PostgreSQL)
- **Email:** Resend
- **Shared types:** `packages/shared` (TypeScript, used by web and future mobile)

## Running locally
```bash
npm install          # from monorepo root
cd apps/web
cp .env.example .env.local   # fill in real values
npm run dev
```

## Required environment variables (apps/web/.env.local)
| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `SESSION_SECRET` | Random secret for session signing |
| `ADMIN_EMAIL` | Admin account email |
| `ADMIN_PASSWORD` | Admin account password |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `EMAIL_FROM` | From address for outgoing email |

## Database
Schema lives in `supabase/schema.sql`. Apply it via the Supabase dashboard SQL editor or the Supabase CLI.

## User preferences
