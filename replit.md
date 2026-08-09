# UX Community

## Overview

UX Community is a Next.js 14 workspace for designers. The web app lives in
`apps/web` and uses custom cookie sessions, Supabase for persisted data and
realtime features, and shared workspace packages.

## Run locally

```bash
npm install
npm run dev
```

The development server runs the `apps/web` workspace. Required Supabase,
storage, email, and rate-limit variables are documented in
`apps/web/.env.example`; `SESSION_SECRET` should be supplied through Replit
Secrets.

## Product conventions

- Keep the existing Next.js App Router and npm workspace structure.
- Writes go through authenticated Next.js API routes using the service-role
  Supabase client; do not expose service credentials in browser code.
- Public threads, events, and resources use the `is_public` flag and appear in
  the authenticated home feed.