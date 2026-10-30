# Private R2 Storage Audit

Date: 2026-10-30
Scope: `apps/web` (Next.js on Cloudflare), `packages/shared`, `supabase/migrations`, and `expo-app-standalone 3`. The marketing repository (`uxcommunity-website`) was inspected separately.

## Executive summary

Before this change, **every uploaded file lived in one public R2 bucket**, and the database stored the permanent public URL of each object. That included job-application résumés, verification work samples and direct-message images. There was no download authorization, no signed GET URL and no way to revoke a leaked link. The bucket is served through a public custom domain with `Cache-Control: public, max-age=31536000, immutable`, so a copy can remain at the CDN edge for a year even after the object is deleted.

This audit found four sensitive file classes. Three are now moved to a private bucket by this branch (résumés, verification samples, DM images); the fourth class — community content media — remains public by design and is documented below as a known, separately scoped exposure.

No production bucket, secret, object or deployment was changed while producing this audit.

## 1. Storage topology (before)

| Item | Value |
|---|---|
| Bucket | One bucket, `R2_BUCKET_NAME` |
| Public origin | `R2_PUBLIC_URL` (custom domain, per `apps/web/wrangler.toml`; `pub-*.r2.dev` only for local/dev) |
| Client | `apps/web/lib/r2.ts` — S3 SDK, same credential for read/write/delete/list |
| Public URL builder | `r2PublicUrl(key)` |
| Object metadata | `Cache-Control: public, max-age=31536000, immutable` on every upload |
| CORS | `scripts/r2-cors.json`: PUT/GET/HEAD from `localhost:3000`, `app.uxcommunity.in`, `uxcommunity.in`, `*.workers.dev` |
| Signed URLs | Only a presigned PUT for showcase video/poster (`/api/communities/[id]/showcase/upload-ticket`). **No signed GET, no download authorization.** |
| CDN | Custom-domain responses are edge-cached; `r2.dev` bypasses the edge cache |

The same bucket also backs avatars, community display pictures, Lottie payloads, thread/showcase/event media and community chat images.

## 2. Sensitive file inventory

| File class | Upload route | Stored column | Key pattern | Download today |
|---|---|---|---|---|
| Job application résumé (fresh upload) | `POST /api/jobs/[id]/apply` | `job_applications.resume_url` | `resumes/<user>/<timestamp>-<random>.<ext>` | Public URL shown to applicant and job poster |
| Saved résumé (“Job profile”) | `POST /api/settings/resumes` | `member_resumes.url` | `resumes/<user>/saved/<timestamp>-<random>.<ext>` | URL returned in the list; reused by apply |
| Verification work sample | `POST /api/verification/upload` | `account_verification_requests.work_sample_urls[]` | `verification/<user>/<uuid>.<ext>` | Public thumbnail in the member form; public URL in the admin review queue |
| DM image | `POST /api/dm/conversations/[id]/upload` | `dm_messages.image_url` | `dm/<conversation>/<timestamp>-<random>.<ext>` | Public URL rendered inline in both clients’ chat bubbles and lightbox |
| Showcase video/poster | `/api/communities/[id]/showcase/upload-ticket` | `community_showcase_posts.attachments` | `showcase/...` | Public, presigned PUT upload |
| Community content media | thread/showcase/event/community-chat routes | several columns | `threads/`, `showcase/`, `events/`, `chat/` | Public |

`packages/shared/src/r2-media.ts` enumerates the URL-bearing columns for the public-bucket orphan audit, including `job_applications.resume_url`, `member_resumes.url` and `dm_messages.image_url`.

## 3. Upload path (before)

All sensitive uploads are server-mediated: the browser/phone POSTs multipart form data to a Next.js route; the route checks the session, validates type/size and uploads the bytes with `uploadToR2`. There is no direct client→R2 upload for documents.

Validation as implemented:

- Résumés: 5 MB cap, magic-byte detection (PDF/DOC/DOCX/RTF) in `lib/jobs/resume-file.ts`, extension derived from the detected type. Saved-resume ownership is scoped by session on every query.
- Verification samples: 5 MB cap, magic-byte detection (JPEG/PNG/WebP), max 3 per request, session-scoped key prefix. The submit route re-checks that every URL sits under `verification/<session user>/`.
- DM images: 20 MB input cap, magic-byte detection, session must be a conversation participant, key prefix must match the conversation on send.

Object keys were not uniformly unpredictable: verification used a UUID, but résumés and DM images used `Date.now()` + `Math.random().toString(36)`, which is guess-resistant but not a cryptographic identifier.

## 4. Download path (before)

There was no download authorization. Every consumer received the permanent public URL:

- Applicant and job poster: `job_applications.resume_url` (job detail modal, applicants board, design-mode PDF viewer, mobile application modal).
- Member: `member_resumes.url` via `/api/settings/resumes` and the settings loader.
- Verification owner: `<img src={work_sample_urls[i]}>` on web and `Image` on mobile; admin queue renders the same URLs.
- DM participants: `dm_messages.image_url` in REST responses, realtime events and both clients’ bubbles.
- `/api/image-download` is an authenticated same-origin proxy for “save image”, but it accepts any public R2/Supabase image URL; it does not enforce ownership.

Consequences:

- Anyone who obtained a URL (referrer, screenshot, log, forwarded link, browser history, a leaked admin page) could read the document forever, without an account.
- Changing an application/request/message id did not change the file URL; the URL itself was the capability. IDs were not enumerable, but a leaked URL stayed valid.
- Deleting the row did not revoke the URL; deletion relied on the orphan sweep and CDN invalidation, neither of which is immediate.
- No RLS policy could help: the object was outside Postgres, and all API routes use the service-role client. RLS on `job_applications`, `account_verification_requests` and `dm_messages` is enabled with no policies and the tables are revoked from `anon`/`authenticated`; database access was correctly closed, but the storage URL bypassed it.

## 5. Authorization checks (before)

| Surface | Check | Result |
|---|---|---|
| Applicant’s own application | `get_job_detail` filters `applicant_id = p_viewer_id` | URL visible to applicant |
| Poster’s applicant list | `get_job_applicants` raises `not_your_job` unless `job_posts.poster_id = p_poster_id` | URLs visible to the poster |
| Other employer | `get_job_applicants` refuses | Refused at API, but URL still public if leaked |
| Verification owner | `/api/verification` scopes by `user_id` | URL visible to owner |
| Verification admin | `/api/admin/verifications` requires admin | URLs visible to admin |
| Unrelated member | No route returns the URL | But a known URL is still readable |
| DM participant | Message/page routes check `user_a`/`user_b` | URLs visible to participants |
| Unrelated DM user | Route checks refuse | But a known URL is still readable |

The access rules were therefore enforced only at the **index** level, not at the **object** level. That is the core finding.

## 6. Lifecycle and retention (before)

- Account deletion cleans the avatar and community media, and relies on the public orphan audit for résumés/verification/DM. DM images were added to `ALL_MEDIA_LOOKUPS` in an earlier change so the audit would stop deleting live ones.
- Job deletion lets applications cascade; the résumé objects were explicitly left for the orphan audit.
- DM history has no retention sweep; community chat has a 15-day sweep.
- Verification history is retained indefinitely; rejected members may reapply after one month, with old sample URLs remaining public.
- No retention documentation existed for private documents.

## 7. Caching and CDN exposure (before)

Every object was uploaded with `Cache-Control: public, max-age=31536000, immutable`. The media host is a custom domain (per `wrangler.toml`), so Cloudflare’s edge caches responses. Removing or moving an object later does **not** remove already-cached copies; those need an explicit Cloudflare cache purge or a TTL/URL change. Any migration that only deletes the origin object leaves the cached public copy readable until purge (or for up to a year).

## 8. Other observations

- `apps/web/lib/r2.ts` funnels all operations through one credential and one bucket. There is no separation between public and private capacity today.
- The admin R2 audit lists the **public** bucket and can delete public orphans. It had no visibility into private keys.
- The showcase video ticket signs a PUT with a server-generated key and content type; it is not a sensitive-document path, but it is the only existing presign usage.
- `apps/web/app/api/image-download/route.ts` allow-lists `*.r2.dev`, `*.supabase.co` and the configured public host. It is an authenticated image save helper, not an authorization boundary.
- The marketing site has no R2 code, no uploads and no keys. Its audit docs already flag “private bucket + signed URLs for resumes/verification docs” and “global media privacy review” as open items (items 22–23 in its pre-launch task list). No website code change is required for this work.

## 9. Residual exposures after this branch

| Exposure | Status |
|---|---|
| Résumés, verification samples, DM images in the public bucket | **Fixed for new uploads**; existing objects require the migration script (designed, not executed) |
| Legacy public URLs already stored in rows | Still readable until the migration’s purge phase; intentionally preserved during copy |
| CDN-cached legacy copies | Require a Cloudflare purge after purge; the migration script emits the URL list |
| Community chat/thread/showcase/event media in private or approval-only communities | **Still public-by-URL**; a separate, larger privacy project (community membership-aware delivery). Documented here, not changed. |
| Avatar/DP/Lottie/public showcase assets | Intentionally public; unchanged |
| Old mobile builds rendering new private DM paths | New images are private immediately; a client that predates this branch cannot send the cookie header, so it cannot render **new** DM images. Existing public images keep working. The APK update must ship with the web deploy. |
| Admin access to résumés | Not granted; admin tools do not need the document. Verification samples are admin-visible because review requires them. |

## 10. Findings summary

| ID | Severity | Finding | Status in this branch |
|---|---|---|---|
| P-01 | Critical | Résumés stored as permanent public URLs | New uploads private; keys + proxy/signed downloads |
| P-02 | Critical | Verification samples stored as permanent public URLs | New uploads private; owner/admin signed display |
| P-03 | High | DM images stored as permanent public URLs | New uploads private; participant-gated proxy |
| P-04 | High | No object-level authorization / revocation | Proxy routes + 5-minute signed GETs, re-checked per load |
| P-05 | High | Immutable public CDN cache outlives deletion | Private objects use `private, no-store`; migration emits a purge list |
| P-06 | Medium | Weakly random résumé/DM keys | `randomUUID()` for all new private keys |
| P-07 | Medium | Account/job deletion leaves private objects to a public-only audit | Explicit private-key cleanup added |
| P-08 | Medium | No private-bucket visibility in admin audit | Private counts/orphans added to `/api/admin/r2-audit` |
| P-09 | Low | Legacy rows and CDN copies | Migration designed, dry-run first, purge last |
| P-10 | Low | Community content media remains public | Out of scope; tracked as a separate privacy project |
