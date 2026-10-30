# Private R2 Storage — Implementation

Date: 2026-10-30
Branch: `feat/private-r2-storage`
Companion: `audit/PRIVATE_R2_STORAGE_AUDIT.md`

## 1. What changed

Sensitive documents now live in a **second R2 bucket** with public access disabled. The application database stores the object key, and clients receive either a stable authorization-gated proxy path or a short-lived presigned GET URL. The public media bucket is unchanged for avatars and intentionally public content.

| Area | Change |
|---|---|
| Storage primitive | New `apps/web/lib/r2-private.ts`: private bucket client, `uploadPrivateToR2`, `signPrivateGet`, key builders, key/proxy parsers, private listing |
| Access policy | New `apps/web/lib/private-access.ts`: pure `canView*` rules (unit-tested IDOR matrix) |
| Résumés (job application) | New uploads → private bucket; `job_applications.resume_key`; apply route writes the key after the RPC; web pages use `/api/private/resume/application/<id>`; mobile APIs sign a 15-minute URL |
| Saved résumés | New uploads → private bucket; `member_resumes.storage_key`; list returns a stable proxy path; delete reclaims unreferenced private objects |
| Verification samples | New uploads → private bucket `verification/<user>/<uuid>.<ext>`; upload returns `{ key, url }` (signed preview); submit accepts `work_sample_keys`; owner/admin GET return signed display URLs; legacy URLs still work |
| DM images | New uploads → private bucket `dm/<conversation>/<uuid>.<ext>`; `dm_messages.image_key`; `image_url` holds the stable proxy path; send/upload accept the proxy path; mobile renders it with the session cookie |
| Download gate | `GET /api/private/resume/application/[id]`, `GET /api/private/resume/saved/[id]`, `GET /api/private/dm/[conversationId]/[file]` — auth + ownership, then 302 to a 5-minute presigned GET with `Cache-Control: no-store` |
| Admin audit | `/api/admin/r2-audit` reports private object counts, private orphans and broken key references |
| Cleanup | Account deletion and job deletion reclaim private keys (`lib/private-storage-cleanup.ts`); DM deletes respect report evidence |
| Migration | `scripts/migrate-private-r2.mjs` + pure planner/tests |
| Tests | `npm run test:private-storage`, `npm run test:private-r2-migration` |

## 2. Data model

Migration: `supabase/migrations/20261030200000_private_r2_storage.sql`

| Column | Purpose |
|---|---|
| `member_resumes.storage_key` | Private object key; `url` becomes nullable and is the legacy public locator |
| `job_applications.resume_key` | Private object key; `resume_url` stays for legacy rows |
| `account_verification_requests.work_sample_keys text[]` | Private keys, parallel to the legacy `work_sample_urls` |
| `dm_messages.image_key` | Private object key; `image_url` carries the stable `/api/private/dm/…` path |

Check constraints reject URLs in key columns, traversal (`..`) and keys outside the intended prefix. A row must still have a file locator (`url` or `storage_key`); a DM row must still carry content, a legacy image URL, a private key or be a tombstone.

Read payloads changed:

- `job_post_payload` now includes `resume_key` on `my_application`.
- `get_job_applicants` now includes `resume_key`.
- Signatures are unchanged, so the existing `revoke`/`grant` set survives `create or replace`.

RLS is unchanged: these tables are service-role-only and every API route authorizes with the signed session.

## 3. Access matrix

| Caller | Résumé (application) | Saved résumé | Verification sample | DM image |
|---|---|---|---|---|
| Applicant | ✅ own | ✅ own | ✅ own | ✅ participant |
| Job poster (that job) | ✅ | ❌ | ❌ | — |
| Other employer | ❌ 404 | ❌ | ❌ | — |
| Unrelated member | ❌ 404 | ❌ 404 | ❌ | ❌ 404 |
| Admin | ❌ by design | ❌ | ✅ explicit | ✅ explicit for report evidence |
| Anonymous | ❌ 401 | ❌ | ❌ | ❌ 401 |

The proxy routes return the same `404` for “not found” and “not yours”, so ids cannot be probed for existence. Authorization is performed **before** any key is read or URL is signed.

## 4. Request flows

### 4.1 Résumé upload and apply

1. `POST /api/jobs/[id]/apply` validates size + magic bytes.
2. `privateResumeKey(userId, ext)` → `resumes/<user>/<uuid>.<ext>`.
3. `uploadPrivateToR2` writes with `Cache-Control: private, no-store`.
4. `apply_to_job` inserts the application with `resume_url = NULL` (the RPC validates public URLs; a private key is not one).
5. The route updates `job_applications.resume_key` scoped by application id + applicant id.
6. On failure, the uploaded object is deleted. A saved resume is not deleted on a failed send because another row may own it.

For a saved resume reused on an application, the route copies `storage_key` into `resume_key`; a legacy saved row still passes its public URL to the RPC.

### 4.2 Résumé download

- Web: the API/page returns `/api/private/resume/application/<applicationId>`.
  - `GET` loads the application + job poster, checks `canViewApplicationResume`, resolves the key (new) or the legacy URL, and redirects to a 5-minute presigned GET. The proxy response is `no-store`; the private object is `private, no-store`.
- Mobile: JSON APIs (`/api/jobs/[id]`, `/api/jobs/[id]/applicants`, `/api/jobs/feed`) return a 15-minute signed URL because `Linking.openURL` cannot carry the session cookie.
- Legacy rows: the proxy redirects to the old public URL until migration. No lockout during the transition.

### 4.3 Verification samples

- Upload: private key + signed preview (30 min). The client keeps `{ key, url }`.
- Submit: `work_sample_keys` (new) and `work_sample_urls` (legacy) are both accepted; total ≤ 3; each key is proven to be under `verification/<session user>/`.
- Owner GET: `workSampleKeys` plus signed display URLs (15 min).
- Admin GET: signed display URLs only; keys are not exposed.
- DELETE: `?key=` deletes the private object; legacy `?url=` still deletes the old public object. Both are session-scoped.

### 4.4 DM images

- Upload: private object; response `{ key, url: /api/private/dm/<conversation>/<file> }`.
- Send: `resolveDmImage` accepts (a) that proxy path (must belong to the conversation), (b) a legacy public `dm/<conversation>/…` URL, or (c) GIPHY. The row stores `image_key` for (a), and `image_url` as the stable path; (b)/(c) remain URL-backed.
- Render: the stable path is stored in the message, so REST, realtime, sidebar previews, search and report snapshots keep working without signing on every read.
- Proxy: `GET /api/private/dm/<conversation>/<file>` requires a participant session (or an admin for report evidence) and redirects to a 5-minute signed GET.
- Mobile: `lib/privateMedia.ts` resolves the relative path and adds the session cookie to the image request; private images use the **memory** cache only, so another account on the device cannot read them from disk. Bulk prefetch skips private paths.
- Legacy DM URLs keep working; the migration rewrites them to the stable proxy path.

## 5. Security properties

| Requirement | Implementation |
|---|---|
| Separate public/private buckets | `R2_PRIVATE_BUCKET_NAME`; no public URL is derived from it |
| Public access disabled on private bucket | **Operational step** (see §8); the app fails closed with `503` if the var is absent |
| Store keys, not permanent public URLs | New private columns; résumé/verification/saved/documents are key-backed. DM keeps a stable proxy path beside the key so existing read models remain valid |
| Short-lived signed URLs | 5 min download; 15 min mobile résumé; 15 min verification display; 30 min upload preview. Uploads are deliberately **not** presigned: the server validates magic bytes, size and ownership before the bytes reach storage. The only presigned PUT remains the public showcase video ticket. |
| No credentials/signing secrets to clients | Signing happens only server-side; the client never sees R2 credentials |
| Type/MIME/size/ownership validation | Existing magic-byte checks retained; all new keys are session- and row-scoped |
| Unpredictable keys | `crypto.randomUUID()` for every new private object; migration generates new UUID targets |
| Authorization before signing | Pure policy helpers run before `signPrivateGet`; failing checks return 404 |
| No public caching | Private objects and proxy redirects are `private, no-store` |
| No signed URLs in logs/analytics/storage | Proxy paths are stable and safe; signed URLs are created transiently per request and never logged or persisted |
| CORS/CDN | Private bucket needs no CORS (no browser direct access); no custom domain; no edge cache |
| Account deletion | Collects keys before cascade, reclaims after; keeps report evidence |
| Retention/deletion | Résumés/verification live while their row lives; DM images while a message or report evidence references them; deleting a job reclaims one-off résumés but keeps shared saved files |

## 6. Cleanup and retention behavior

| Event | Private behaviour |
|---|---|
| Saved résumé deleted | Delete the key if no `member_resumes` or `job_applications` row references it |
| Job deleted (poster or admin) | Collect application keys first; after cascade, delete keys not referenced by a saved résumé or another application |
| Company deleted (admin) | Collect résumé keys for every posting on the company before the cascade; delete unshared keys after |
| Account deleted | Collect saved résumés, applications (including applications on postings the member posted, which cascade with them), verification samples and sent DM images; after cascade, delete unreferenced keys. DM images kept when a report snapshot still carries the path |
| DM message deleted | Soft-delete row, clear `image_key`/`image_url`, reclaim the key unless report evidence holds it |
| Abandoned verification/DM upload | Covered by the private orphan audit (`/api/admin/r2-audit` → `private.orphans`); a private deletion UI is intentionally not added in this change |
| Community chat retention | Unchanged (15-day sweep, public bucket) |

## 7. Migration of existing files

The script is **not** run automatically and was not run for this branch.

`scripts/migrate-private-r2.mjs`:

1. **Plan (default, read-only):** scans `member_resumes.url`, `job_applications.resume_url`, `account_verification_requests.work_sample_urls` and `dm_messages.image_url`; keeps only keys under the public base with `resumes/`, `verification/` or `dm/`. De-duplicates shared source objects and prints the plan.
2. **Copy + verify (`--apply`):** public GET → private PUT (`private, no-store`), private GET back, compare SHA-256 and byte length, then update the key column(s). Verification arrays are updated by matching source URLs, preserving order. DM rows are rewritten to the stable proxy path, and report snapshots are rewritten from the old public URL to that path. The public URL columns for résumés are left intact.
3. **Purge (`--purge-public --confirm-purge`):** re-verifies the private copy exists, detaches the legacy URL only when the row already points at the verified key, refuses while any row or report snapshot still references the source URL, then deletes the public object and writes the URL list to `tmp/private-r2-purge-urls.txt`.

State is written to `tmp/private-r2-migration-state.json`; both files are local artifacts.

**CDN:** public objects were uploaded with `immutable` one-year caching. Deleting the origin does not evict an edge copy. Hand `tmp/private-r2-purge-urls.txt` to Cloudflare → Caching → Purge by URL (or invalidate the media host) before treating the public copy as gone. If `R2_PUBLIC_URL` is a `pub-*.r2.dev` URL, edge caching is bypassed and origin deletion is immediate.

Recommended production order:

1. Create the private bucket (public access off, no custom domain).
2. Grant the media token Object Read & Write on it.
3. Set the `R2_PRIVATE_BUCKET_NAME` secret everywhere the app runs.
4. Deploy this branch.
5. Run `node scripts/migrate-private-r2.mjs` and inspect the plan.
6. Run `--apply`; spot-check one of each class in web and mobile.
7. Purge the public URLs, then run `--purge-public --confirm-purge`.
8. Re-run the admin R2 audit and confirm `private.brokenReferences` is zero.

## 8. Operational configuration (not applied)

| Item | Required |
|---|---|
| Bucket | New R2 bucket, e.g. `uxcommunity-private`; public access **disabled**; no `r2.dev` domain; no custom domain |
| Token | Existing media API token needs Object Read & Write on both buckets |
| Worker secret | `R2_PRIVATE_BUCKET_NAME` (GitHub secret + local `.dev.vars`) |
| Deploy workflow | Not modified. The secret must be added to the repository before deploy, otherwise private uploads return `503` (fail closed; public media still works) |
| CORS | None for the private bucket; do not attach the public CORS policy |
| Lifecycle | No public lifecycle rules; private objects are deleted by the application |

The app deliberately does **not** fall back to the public bucket when the private bucket is missing.

## 9. Tests

Automated:

```
npm run test:private-storage
npm run test:private-r2-migration
npm run test:jobs
npm run test:dm-preview-text
npm run test:dm-client-cache
npx tsc --noEmit -p apps/web/tsconfig.json
cd "expo-app-standalone 3" && npx tsc -p tsconfig.json --noEmit
npm run lint
npm run build
```

Covered by unit tests:

- Key namespace validation, traversal/URL rejection, ownership prefix checks.
- `randomUUID` key shape; legacy URL → key mapping.
- Signed URL host, path, expiry, 1-hour clamp, missing-bucket failure.
- IDOR matrix: applicant/poster/other employer/admin for résumés; owner/admin for verification; participant/admin for DM; saved résumé owner-only.
- Web proxy path vs mobile signed URL mapping; profile facts preserved through mapping.
- DM send validation: this conversation's private path accepted; another conversation/traversal/GIPHY-lookalike rejected; legacy public accepted.
- Verification `work_sample_keys` validation and the legacy URL path.
- Migration key classification, target shape (DM two-segment path), extension/owner derivation.

Not covered by automated tests (needs credentials/private bucket):

- Real signed URL expiry over HTTP.
- The migration apply/purge against live objects.
- Cookie-bearing mobile image loads on a device.
- Admin queue thumbnails after migration.

Manual verification matrix for the deploy:

1. Unauthenticated GET of a private path → 401/404.
2. Applicant opens own résumé → 302 to R2, PDF loads.
3. Poster opens the same résumé from the applicants board → 302; another member with the id → 404.
4. Verification owner sees thumbnails; another member using the request id → 404; admin sees them.
5. DM image loads for both participants; a third account gets 404; after deleting the message the object is gone (unless reported).
6. Wait 5+ minutes and reload a previously signed URL → 403 (expired).
7. Avatars, community DPs, thread/showcase media still load from the public host.
8. Account deletion removes the user's private keys (check the audit before/after); a shared saved résumé used on another application survives.
9. Mobile: DM image and résumé open; no private image on disk after logout (memory-only cache).

## 10. Limitations / follow-ups

- Legacy public rows and cached copies remain until the migration and purge are executed.
- Community content media (chat/threads/showcase/events) is still public-by-URL, including in private/approval-only communities. This is a separate, larger change (membership-aware delivery) and is not attempted here.
- Old mobile builds cannot render new private DM images (no cookie header). Ship the new APK with the web release.
- Admin access to résumés is intentionally not granted; verification samples are admin-visible because review requires them.
- Private orphan deletion is not exposed in the admin UI; operators can delete keys with `wrangler r2 object delete` after reviewing `/api/admin/r2-audit`'s `private.orphans`.
- The marketing repository needs no code change; its audit task list already tracks the private-bucket work.
