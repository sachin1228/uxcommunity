# Build production-ready moderation service

## What changed

This PR adds a backend moderation layer for DesignHub that moderates text and image uploads before content is saved.

Text moderation lives in the Next.js backend because DesignHub already performs all trusted writes through server API routes. The text engine is modular and deterministic: validation, route-level rate limiting, spam detection, profanity detection, configurable keyword rules, a pluggable AI provider interface, a decision combiner, and Supabase decision logging.

Image moderation is split into a separate Python FastAPI service because NudeNet has a Python/model runtime and should load its model once per process. Next.js validates image MIME and file signatures locally, calls the image moderation service over HTTP, and uploads to Cloudflare R2 only when the service returns `allowed: true`.

## Architecture decision

Use the existing repo architecture instead of adding a separate backend for all moderation:

- Next.js remains the enforcement point for content writes.
- Supabase stores moderation metadata in `moderation_events`.
- Cloudflare R2 upload remains behind server routes.
- NudeNet runs as an isolated Railway-ready service under `services/image-moderation`.
- The public moderation result contract is stable: `status`, `allowed`, `reason`, `provider`, `confidence`, `triggered_rules`, `scores`, and `duration_ms`.

This keeps the current app deployment simple while allowing image moderation to scale independently and allowing future providers such as Perspective API, Azure AI Content Safety, Hive, OpenAI, or custom ML to be added without changing route behavior.

## Enforcement scope

Initial enforcement points:

- Chat message text before insert into `community_messages`.
- Chat image uploads before compression and R2 upload.
- Profile display name and bio before update.
- Signup display name before user creation.
- Signup/profile avatar uploads before compression and R2 upload.
- Admin review queue for approved, rejected, and review events.
- Admin event actions for approve, reject, delete, moderator notes, and permanent ban through `users.is_blocked`.

The engine also defines content types for posts, comments, usernames, user bios, community names, and image uploads so future surfaces can use the same API.

## Operational behavior

- Only `approved` content is saved.
- `review` and `rejected` decisions are logged and returned without saving user content.
- Text moderation continues with local rules if no external AI provider is configured.
- Image moderation fails closed: if the NudeNet service is unavailable or unconfigured, uploads are not written to R2 and the decision is `review`.
- Image contents are never logged.

## Validation

Run:

- `npm run lint`
- `npm run build`

The Python service includes a `/health` endpoint and a `/moderate` endpoint suitable for Railway deployment.
