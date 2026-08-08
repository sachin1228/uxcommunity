# DraftHub

DraftHub is a Next.js designer community platform in an npm workspace monorepo.

## Run locally

From the repository root:

```bash
npm install
npm run dev
```

The web app runs on port 3000.

## Environment configuration

The web app reads configuration from `apps/web/.env.local`. A complete, safe
template is available at `apps/web/.env.example`. The local file is ignored by
git and must contain the project-specific Supabase, admin, email, Redis, and
R2 values before those features can be used.

`SESSION_SECRET` is managed as a Replit Secret and should not be copied into a
committed file.

## User preferences

- Keep the existing npm workspace and Next.js structure.
- Never commit secrets or credentials.