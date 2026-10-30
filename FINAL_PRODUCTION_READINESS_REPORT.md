# UXCommunity — Final Production Readiness Report

**Audit date:** 2026-10-31 (IST)
**Main repository:** `/Users/sachin/Documents/GitHub/uxcommunity`
**Main revision:** `1928205f` (`Update deploy.yml`), clean working tree

> **Remediation update (2026-10-31):** A remediation branch (`fix/production-readiness-remediation`) now exists with the safe code/migration/test changes described in `PRODUCTION_REMEDIATION_REPORT.md`. This document remains the baseline audit and does not itself claim any fix was applied to production. Backup/DR remains deferred to a separate task.

**Website repository:** `/Users/sachin/Documents/GitHub/uxcommunity-website` (`99cb5dc`)
**Live website:** https://www.uxcommunity.in/
**Live app:** https://app.uxcommunity.in/

> **Audit-only task.** No production data, schema, RLS policy, migration, bucket, secret, Worker, deployment or website was changed. No merge, push, deploy or R2 operation was performed. This report is the only file written.

---

## 1. Executive verdict

# NOT READY

UXCommunity should **not** launch in its current production configuration. The implementation is broad and many controls are genuinely good, but the remaining gaps are launch blockers, not roadmap polish:

1. **There is no recoverable backup.** Supabase reports no physical backups and PITR disabled; R2 versioning is disabled on both buckets; the backup/DR implementation exists only on an unmerged branch. A database loss or an accidental R2 delete is currently unrecoverable.
2. **The app serves its login page and API over plaintext HTTP.** `http://app.uxcommunity.in/login` returns `200` (no HTTPS redirect), so a first-time visitor can submit credentials over HTTP. HSTS is present but ignored on HTTP.
3. **The verification “read-only” gate is bypassed for chat and DMs.** Community chat sends, DM sends and some likes pass `allowUnverified: true`; an unverified account can write indefinitely. Production `grace_days = 2`; signup is open and has no CAPTCHA/Turnstile. The Terms and the in-app banner claim read-only-until-approved.
4. **A sensitive verification file is still publicly readable.** One orphaned `verification/` object (878,801 bytes) is served publicly with a one-year immutable cache; the R2 migration plan finds no DB-linked legacy rows, so this orphan must be handled separately.
5. **Seven sensitive tables still grant `anon`/`authenticated` full privileges.** RLS currently blocks rows (except `member_resumes` own-row policies), but the REVOKE migration is unmerged and the project default ACL re-grants new tables.
6. **A fresh database cannot be built from the migration chain.** The edited `20260814030000` migration references `community_resources.allow_replies` before the September migration adds the column, so the fresh DB never creates `get_resource_list_aggregates`. Production has a stale 6-column version; staging/DR rebuilds would fail. Production migration history records only 5 versions of 208 local migrations.

The product is also effectively pre-launch in its data: **2 users, 42 communities, 68 chat messages, 1 event, 1 DM, 1 saved résumé, 0 job posts/applications, 0 reports, 0 audit rows.** That makes destructive production testing inappropriate; a real staging environment must be provisioned.

**Recommendation:** treat the must-fix list in §8 as a launch gate. Most items are small, but the backup, HTTPS, verification-gate and migration-chain fixes are non-negotiable.

### Verification key used in this report

| Label | Meaning |
|---|---|
| **PROD** | Verified against live production (read-only SQL/catalog, REST counts, R2 API, HTTP, Cloudflare/Supabase CLI). |
| **LOCAL** | Verified on a disposable local PostgreSQL 17 database / local test suite. |
| **CODE** | Verified by reading the current `main` source; not exercised live. |
| **NOT TESTED** | Not exercised in this audit; requires staging, a real device or external credentials. |

### Method and limitation

The configured Supabase MCP server exposes only `search_docs` (no database tool). Production was inspected through the authenticated Supabase CLI's temporary **read-only** login role and a local PostgreSQL 17 client (catalog/ACL/function/constraint queries), plus the service-role PostgREST API for aggregate counts (no row contents or PII printed), R2 S3 ListObjectsV2/HEAD/versioning/lifecycle APIs, the Supabase Management API backup endpoint, Cloudflare `wrangler` domain/dev-url/secret-name reads, and unauthenticated public HTTP checks. The CLI login-role mechanism creates a temporary read role; no application data or schema was written.

No credentials, tokens or private user data are included. A local build artifact containing plaintext production secrets is reported as a finding, but its values are deliberately not reproduced.

---

## 2. Findings table

### 2.1 Critical / High

| ID | Status | Severity | Finding and evidence | Verified | Recommended fix | Prod access? |
|---|---|---|---|---|---|---|
| **C-01** | **FAIL** | **CRITICAL** | **No recoverable database backup.** `supabase backups list --linked`: `WALG=true`, `PITR=false`, earliest/latest `0`; Management API `database/backups`: `pitr_enabled=false`, `backups=0`, `physical_backup_data={}`. No `.github/workflows/backup.yml` on `main`; backup implementation is only on `feat/backup-disaster-recovery` (`3eb2c30dd`). | **PROD** | Merge/configure the encrypted daily logical backup + R2 mirror, enable R2 versioning or mirror, run a real restore drill, define RPO/RTO, escrow the age private key. | Yes |
| **C-02** | **FAIL** | **CRITICAL** | **Plaintext HTTP login/API.** `curl -L http://app.uxcommunity.in/` final URL `http://app.uxcommunity.in/login` (HTTP 200); `http://app.uxcommunity.in/login` and `/api/auth/me` return 200 over HTTP. No HTTP→HTTPS redirect on the app host (the marketing host does 308 to HTTPS). | **PROD** | Enable Cloudflare “Always Use HTTPS” / a redirect rule for `app.uxcommunity.in` (and all `*.uxcommunity.in` hosts), verify POST `/api/auth/login` is HTTPS-only, add HSTS preload after validation. | Yes |
| **C-03** | **FAIL** | **HIGH** | **Verification gate bypass.** `assertUserState` skips the gate whenever `allowUnverified: true` (`lib/auth/session.ts:373-397`). Chat send (`api/communities/[id]/messages/route.ts:97`), DM send (`api/dm/conversations/[id]/messages/route.ts:141`) and thread likes use that flag. The banner says “read-only” (`components/verification/VerificationBanner.tsx:14`); Terms say most posting/messaging require approval (`terms/page.tsx:115-126`). Live `verification_settings.grace_days = 2`. Open signup has no CAPTCHA/Turnstile. | **PROD + CODE** | Remove `allowUnverified` from write endpoints (keep it on reads, verification, logout, password/delete), or explicitly document chat/DM as allowed and add bot protection. Set `grace_days` deliberately (0 recommended for a verified-write model); update legal copy. | Yes (setting/code) |
| **C-04** | **FAIL** | **HIGH** | **Seven sensitive tables still grant client roles.** Live ACLs grant `anon`/`authenticated` full DML on `content_reports`, `content_removals`, `fcm_tokens`, `account_verification_requests`, `verification_email_codes`, `verification_settings`; `member_resumes` grants `authenticated` and has four own-row policies. RLS blocks the no-policy tables today. The REVOKE migration (`20261030240000`) is only on `fix/prelaunch-audit-findings` (`843359387`), unmerged. `pg_default_acl` still grants new public tables to both roles. | **PROD** | Merge/apply the REVOKE migration; add a default-privilege revoke migration; verify `service_role` still works; run `public_read_exposure.test.sql` against staging. | Yes |
| **C-05** | **FAIL** | **HIGH** | **One public verification sample remains.** Public bucket `drafthub`: 4,464 objects / 26,671,052 bytes; exactly one `verification/` object, 878,801 bytes, public `HEAD` 200, `Cache-Control: public, max-age=31536000, immutable`. No `account_verification_requests` rows exist and the key owner prefix is not a user id: it is an orphan. Public bucket custom domain `media.uxcommunity.in` and r2.dev are both enabled. | **PROD** | After approval, delete this one orphan object (not the bucket), purge its exact URL from Cloudflare cache, verify 404 on both the custom domain and r2.dev. Do not touch other public media. | Yes |
| **C-06** | **FAIL** | **HIGH** | **Fresh DB migration chain is broken.** `20260814030000_community_list_aggregate_rpcs.sql:154` references `community_resources.allow_replies`, but the column is added later in `20260911160000_resource_allow_replies.sql`. On a disposable PG17 DB the migration logs `ERROR: column r.allow_replies does not exist`; the later migration only adds the column, so `get_resource_list_aggregates` is never created. Production has a 6-column version of the RPC, while the repo/app type expects 7 (`allow_replies`). `supabase db push` cannot build a fresh DB. | **PROD + LOCAL** | Add a forward `drop function` + 7-column `create function` migration; correct the old migration for fresh installs; add a strict fresh-DB test. See §5. | Yes |
| **C-07** | **FAIL** | **HIGH** | **Blocked/suspended members cannot self-delete.** `getSessionForErasure` only bypasses `is_blocked`/suspension; `evaluateSession` still rejects a revoked row or bumped `session_version`. Admin block/suspend revokes every session and bumps the version (`set_user_blocked` / `set_user_suspended`), so the erasure request cannot authenticate. The route comment and Terms/Privacy/Delete-account page claim blocked/suspended members can delete. | **CODE** | Add a password-based erasure endpoint with a signed email link (or a dedicated deletion-only session), or change the policy and clearly route these users to support. Test on staging. | Yes |
| **C-08** | **FAIL** | **HIGH** | **Several moderator actions bypass the audit log.** Admin user block/unblock and delete (`api/admin/users/[id]/route.ts` PATCH/DELETE) do not write `moderation_audit_log`; DM report status changes (`api/admin/dm-reports/[id]/route.ts`) do not; content-report removal/dismiss and community/job admin toggles do not. The declared `unban_user` / `lift_suspension` audit actions are never recorded. Privacy/Terms claim an append-only audit log of moderator decisions. | **CODE** | Write one audit row for every admin/moderator action (including direct user flags and hard deletes); test the audit action union. | Yes |
| **C-09** | **FAIL** | **HIGH** | **DM reports cannot be actioned.** The DM queue exposes only `reviewed`/`dismissed`/`reopen` (`api/admin/dm-reports/[id]/route.ts:6,33-49`). There is no warn/suspend/ban/remove path from a DM report, so DM harassment evidence cannot result in an account action from that queue. | **CODE** | Add the same moderation actions/audit path to the DM queue, or route DM reports into `interaction_reports` so the existing action catalogue applies. | Yes |
| **C-10** | **FAIL** | **MEDIUM/HIGH** | **Content-report evidence is thin.** `/api/content-reports` stores `content_title` and author only (`api/content-reports/route.ts:108-116`); comment/chat/profile interaction reports store a ≤500-char excerpt and `target_snapshot = {}` (`lib/moderation/interaction-reports.ts:78-198`). The policy says a snapshot is kept so moderators can review after edit/delete. DM reports do keep a 20-message snapshot. | **CODE** | Add a body/media/version snapshot to `content_reports` and the interaction targets that lack one; or narrow the policy claim. | Yes |
| **C-11** | **FAIL** | **HIGH (jobs)** | **Resume attachment is non-transactional.** The apply RPC lands the application, then a second UPDATE writes `resume_key`; on failure it only logs (`api/jobs/[id]/apply/route.ts:206-211`). The applicant sees a successful application with no résumé, and the uploaded private file is not reclaimed. Production has 0 applications, so this is not yet live-exercised. | **CODE** | Pass the key into `apply_to_job` or wrap the insert+key update in one transaction; on failure roll back and clean up. | Yes |
| **C-12** | **FAIL** | **MEDIUM/HIGH** | **Public verification URLs are still accepted for new submissions.** `api/verification/submit/route.ts:62-85,139` accepts legacy `work_sample_urls` if they sit under `verification/<userId>/`, even though new uploads use the private bucket. Legacy résumé URLs are also returned/copied as public fallbacks (`lib/jobs/private-resume.ts:23-32`; apply route `:168-180`). Production currently has 0 verification rows and 0 legacy résumés, but the code path contradicts “new samples/resumes use private storage.” | **CODE** | Reject public URLs for new submissions after the migration window; keep a read-only legacy path for existing rows; migrate/clear legacy columns. | Yes |
| **C-13** | **FAIL** | **MEDIUM/HIGH** | **Production secrets exist in local build artifacts.** `apps/web/.open-next/cloudflare/next-env.mjs` (mtime 2026-10-24) contains plaintext production credentials, including the service-role key, session secret, admin credential, email/rate-limit/R2/GIPHY/realtime secrets. `.open-next/` and `.dev.vars*` are gitignored and **not** tracked; the deployed client bundle scan found no secret markers. A local `.dev.vars.bak-20261030151132` also exists. The admin credential is a manually chosen value, not a generated high-entropy secret. | **LOCAL + PROD client scan** | Delete local build artifacts/backups, never build with production `.dev.vars`, rotate the exposed secrets if the artifacts were copied/shared, and replace the admin credential with a generated high-entropy value. | Yes (rotation) |
| **C-14** | **FAIL** | **MEDIUM** | **Existing accounts were not re-consented.** Live: 1 of 2 `users` has `terms_accepted_at` and `age_confirmed_at` NULL. `20261030120000_signup_consent.sql` explicitly leaves existing accounts NULL. New-account consent is written only after `complete_signup`, in a separate best-effort UPDATE (`api/signup/avatar/route.ts:154-168`) that logs failure and still returns success. | **PROD + CODE** | Decide whether existing accounts are test-only; if not, force re-consent at next login. Move consent timestamps into the account-creation transaction and store policy version. | Yes |
| **C-15** | **FAIL** | **MEDIUM** | **Legal copy contradicts the implementation.** Community Guidelines (updated 2026-10-30) say community/job reports “do not have a report control yet” (`community-guidelines/page.tsx:94-110`), but both are implemented. Terms say new accounts are “review-only until approved” (`terms/page.tsx:115-126`), while chat/DM/likes remain writable. Privacy/Delete-account say residual copies may remain in a provider backup cycle (`privacy/page.tsx:455-462`), but no backups/PITR exist. | **PROD site + CODE** | Update the guidelines and Terms/Privacy copy after the product decisions in C-03/C-14/C-01; re-publish and verify the live pages. | Yes (website) |
| **C-16** | **FAIL** | **MEDIUM** | **No CSP; no explicit CSRF defense; broad cookie domain.** Live headers have HSTS, X-Frame-Options DENY, nosniff, referrer and permissions policy, but no Content-Security-Policy. State-changing routes rely on SameSite=Lax, with the session cookie scoped to `.uxcommunity.in` (`lib/auth/session.ts:268-291`), so the marketing site and every subdomain receive it. No Origin/Sec-Fetch-Site check was found on normal POST routes. | **PROD + CODE** | Add a tested CSP; add Origin/Sec-Fetch-Site checks or CSRF tokens; consider a host-only app cookie + a short-lived realtime token instead of a parent-domain session cookie. | Yes |
| **C-17** | **PARTIAL** | **MEDIUM** | **Rate limiting fails open.** `lib/auth/rate-limit.ts:57-67` returns success when Upstash is unset/unreachable. Live Upstash is healthy (`PONG`, `dbsize=0`), so limits are working now; a quota/outage silently disables login/reset/signup/report throttles. | **PROD + CODE** | Fail closed for auth/report endpoints or add a conservative in-memory fallback; alert on limiter failures. | Yes |
| **C-18** | **FAIL** | **MEDIUM** | **Report target has no visibility check.** `loadInteractionTarget`/`loadTarget` resolve any content UUID without checking that the reporter can see the content or is a member of its private community; any authenticated member who knows a UUID can file a report. There is no aggregate per-target throttle (only per-reporter duplicates). | **CODE** | Enforce the same read authorization as the target page, or return 404 for invisible targets; add a per-target report cap. | Yes |
| **C-19** | **PARTIAL** | **MEDIUM** | **Admin suspension UX/workflow gaps.** There is no direct suspend/lift-suspension control in the Users console; suspension originates only from an interaction report, and lifting only by granting an appeal. The admin user page does not fetch/display `suspended_until`. | **CODE** | Add direct suspend/lift with duration validation (1–30 days) and audit; show active suspension in the user page. | Yes |
| **C-20** | **PARTIAL** | **MEDIUM** | **Appeals are incomplete for the affected user.** No mobile appeals screen; `/dashboard/appeals` maps to `none` in mobile notifications. Appeal decisions create only an in-app notification (`admin/moderation-appeals/[id]/route.ts:153-180`), which a banned member cannot read; no decision email. Content-report removals are not appealable in-app (email only). `moderation_appeals.user_id`/`report_id` cascade, so deleting the moderated account erases its appeals. | **CODE** | Add a decision email (and mobile appeal screen/route), route content-report appeals consistently, and retain anonymized appeals or document their deletion. | Yes |
| **C-21** | **PARTIAL** | **MEDIUM/HIGH** | **Jobs/events functional defects.** (a) Event PATCH has no past-start or `end > start` validation (`events/[eventId]/route.ts:106-128`); (b) host deletion sends no notice to attendees (`:290-311`); (c) RSVP/comments/likes/chat remain allowed after an event ends; (d) event lifecycle push reads only `push_tokens`, ignoring `fcm_tokens`, quiet hours and notification preferences (`lib/events/lifecycle-notifications.ts`); (e) job-match fan-out has no recipient cap/batching (`lib/jobs/notifications.ts:40-53`). | **CODE** | Add server-side schedule validation, attendee cancellation notice, ended-event gates, unify push recipients/preferences, cap/batch job fan-out. | Yes |
| **C-22** | **FAIL** | **MEDIUM** | **Production is test-seeded/pre-launch.** Live: 2 users, 42 communities, 68 messages, 1 event, 1 DM, 1 saved résumé, 5 active sessions, 0 job posts/applications, 0 reports/audits. 4 thread images + 5 event images + 1 playground object in the public bucket have no matching DB rows. The one public verification object is orphaned. This data must be classified (official/test) before launch; destructive testing against it is unsafe. | **PROD** | Confirm official communities; remove/retain test accounts/content under a written data plan; re-consent or delete the pre-consent account; clean orphan public media. | Yes |
| **C-23** | **FAIL** | **HIGH (migration ops)** | **Migration history is not a reliable record.** Remote `supabase_migrations.schema_migrations`: only `001`, `20261005140518`, `20261008145053`, `20261012205406`, `20261023120000`. Local: 208 files / 196 unique versions; 194 local versions unrecorded, 3 remote versions have no local file (contents unknown). Duplicate timestamp groups exist (`20260718` ×5, `20260719` ×2, `20260720` ×5, `20260721` ×2, `20260924120000` ×2, `20261010120000` ×2). | **PROD + repo** | Reconstruct/verify the production schema diff, obtain the three ad-hoc SQL changes, then establish a verified baseline; do not run `supabase db push` until the chain is fixed. See §5. | Yes (baseline) |

### 2.2 Medium / Low / operational

| ID | Status | Severity | Finding and evidence | Verified | Recommended fix | Prod access? |
|---|---|---|---|---|---|---|
| **M-01** | **FAIL** | **MEDIUM** | Private verification samples on mobile bypass `privateMedia` and use a plain `<Image>` with default disk caching (`expo-app-standalone 3/app/settings/verification.tsx:569`), so a signed private sample can persist on disk after sign-out. | CODE | Use the session-cookie-aware private image loader and memory-only cache. | No |
| **M-02** | **FAIL** | **MEDIUM** | `resume_key` is returned in job payloads (`20261030200000_private_r2_storage.sql:238,273`); the bucket is private, so this is defense-in-depth only. | CODE | Strip keys from client payloads; return proxy/signed paths only. | Yes |
| **M-03** | **PARTIAL** | **MEDIUM** | Job application status route ignores the `[id]` job segment (`api/jobs/[id]/applications/[applicationId]/status/route.ts:54-60`), and create/edit can accept a past `closes_at` (`lib/jobs/validation.ts:92-104`; no SQL future check). | CODE | Scope by both job and application; reject past close times. | Yes |
| **M-04** | **PARTIAL** | **MEDIUM** | Events allow RSVP/comments/likes/chat after the event ends; capacity is a non-atomic count-then-insert; event create/edit leak raw Postgres messages. | CODE | Add ended-event gates, atomic capacity, map errors. | Yes |
| **M-05** | **PARTIAL** | **MEDIUM** | Mobile event lifecycle pushes route to the community/home rather than the event (`expo-app-standalone 3/lib/pushRoutes.ts:25-30`); event lifecycle ignores FCM/preferences/quiet hours. | CODE | Route by `eventId`; unify FCM/Expo preference handling. | Yes |
| **M-06** | **PARTIAL** | **MEDIUM** | Notification gaps: no notification for job application submission/shortlist/reject; no showcase comment notifications; only thread likes notify. Notification dedupe overwrites an unread row's type/title/body for the same entity. | CODE | Decide which events must notify; add targeted rows/copy; do not overwrite type silently. | Yes |
| **M-07** | **PARTIAL** | **MEDIUM** | Removed comments/chat messages are hard-deleted with no restore path; the policy discloses this, but a granted appeal cannot restore them. | CODE | Accept and document, or soft-delete with restore. | Yes |
| **M-08** | **PARTIAL** | **MEDIUM** | Verification approval notice claims “full access to post, message, join communities, and apply to jobs” while messaging was never gated; banner says read-only while chat/DM are writable. | CODE | Align copy with the actual gate; see C-03. | Yes |
| **M-09** | **FAIL** | **MEDIUM** | No legal links in the product outside signup; mobile settings has no Terms/Privacy/Guidelines links. Marketing footer does have them. | CODE | Add legal links to web settings/footer and mobile settings. | No |
| **M-10** | **PARTIAL** | **LOW/MEDIUM** | Public bucket has r2.dev enabled in addition to the custom domain; expected for public media, but it is an extra public origin and bypasses edge cache. | PROD | Keep only if public media needs it; disable after the orphan is removed if not. | Yes |
| **M-11** | **FAIL** | **LOW** | Stale Worker secrets: `MODERATION_IMAGE_SERVICE_URL` is unused in code; `INVITATION_EXPIRY_DAYS` remains after open signup removal. | PROD/config | Remove dead secrets to reduce surface/confusion. | Yes |
| **M-12** | **PARTIAL** | **LOW** | Admin login compares email/password with `===` (`api/auth/login/route.ts:84-88`), timing-unsafe; admin logout-all exists as an API but has no UI. | CODE | Use `timingSafeEqual`; add an admin logout-all control. | Yes |
| **M-13** | **PARTIAL** | **LOW** | Login checks only `is_blocked`, not `suspended_until`; a suspended user can obtain a cookie that every later request rejects. | CODE | Reject suspended accounts at login with a clear message, or allow a deletion-only session. | Yes |
| **M-14** | **PARTIAL** | **LOW** | Realtime Worker still accepts a legacy `?token=` query fallback (registry-validated) in addition to the cookie; this risks token leakage in logs. | CODE | Remove once all clients use the header/cookie path. | Yes |
| **M-15** | **PARTIAL** | **LOW** | Password hashing is bcrypt cost 10; signup allows 8 chars + digit, while change/reset require uppercase + digit; no maximum before bcrypt's 72-byte truncation. | CODE | Raise cost/consistency and enforce a byte-length cap. | Yes |
| **M-16** | **PARTIAL** | **LOW** | Password reset request has only a per-IP limit (5/hour), no per-email limit; distributed reset-mail spam is possible. | CODE | Add a per-email limit/keyed cooldown. | Yes |
| **M-17** | **PARTIAL** | **LOW** | Mobile member profile offers only Unblock, not Block; blocking requires opening a DM first. | CODE | Add Block beside Unblock. | No |
| **M-18** | **PARTIAL** | **LOW** | Mobile saved résumés cannot be opened from Settings → Job profile; application résumé signed links expire after 15 min. | CODE | Add a viewer/open action and refresh signed links on demand. | No |
| **M-19** | **PASS with caveat** | **LOW** | Website has no CSP, though it has the same baseline headers. Marketing content is lower risk. | PROD | Add a report-only CSP first. | Yes (site) |
| **M-20** | **NOT TESTED** | **MEDIUM** | FCM delivery, Resend delivery, signed-URL expiry over HTTP, WebSocket revocation on a live session and real Android flows were not exercised. Worker secret names and Resend domain verification are present. | Config + CODE | Run the staging/Android matrix in §9. | No (testing) |

### 2.3 Verified passes (selected)

| ID | Status | Finding | Evidence |
|---|---|---|---|
| P-01 | **PASS** | Private R2 bucket isolation: `uxcommunity-private` has **no custom domain**, `r2.dev` is disabled; only the public bucket has `media.uxcommunity.in`. | live `wrangler r2 bucket domain list` / `dev-url get` |
| P-02 | **PASS** | Private object mapping: 2 objects / 1,342,175 bytes; 1 saved-résumé key + 1 DM key, both present; 0 missing, 0 orphaned private objects. | live R2 listing + DB key comparison |
| P-03 | **PASS** | Private download proxies fail closed for anonymous callers: application résumé, saved résumé and DM image proxy all return **401**. | live `curl` |
| P-04 | **PASS** | No Supabase Storage buckets are used (`/storage/v1/bucket` count 0). Sensitive files are R2-only. | live Storage API |
| P-05 | **PASS** | Community chat retention: oldest message 2026-10-25, newest 2026-10-30, **0 messages older than 15 days**; total 68. | live REST counts |
| P-06 | **PASS** | Evidence-retention SQL suites: 82/82 + 8/8 pass locally (reporter deletion anonymizes reports, audit survives). | LOCAL `npm run test:moderation-db` |
| P-07 | **PASS** | Admin route guards: all 55 `app/api/admin/**/route.ts` handlers enforce `requireSession("admin")` (load-test via `impl.ts:113`); protected layout also checks the registry-backed role. | CODE |
| P-08 | **PASS** | Session revocation implementation: `sid`/`sv` claims, `auth_sessions`, logout/logout-all/password-change/password-reset, admin epoch, realtime `/revoke`, private proxies and realtime validation all use the same evaluator. | CODE + live schema |
| P-09 | **PASS** | Realtime unauthenticated socket does not open (closed 1006); internal session validation requires `API_SECRET` and fails closed. | live probe + CODE |
| P-10 | **PASS** | Upstash reachable (`PONG`, `dbsize=0`); Resend domain `uxcommunity.in` verified; GIPHY trending 200. | live read-only |
| P-11 | **PASS** | Web Worker secret names include `FCM_SERVICE_ACCOUNT`, `R2_PRIVATE_BUCKET_NAME`, `SESSION_SECRET`, Supabase service key and R2/Resend/Upstash values; realtime has all four required secrets. | Cloudflare `wrangler secret list` (names only) |
| P-12 | **PASS** | Website legal pages: `/terms`, `/privacy`, `/community-guidelines`, `/delete-account`, `/support` all 200 on `www` and apex; footer links present; 390px viewport has no horizontal overflow on `/`, `/terms`, `/privacy`, `/community-guidelines`, `/delete-account`, `/support`. | PROD HTTP + Playwright |
| P-13 | **PASS** | Live signup page exposes all three legal links and both 18+/Terms checkboxes; server schemas default both flags false and refine true (`lib/validations.ts:18-45`); live client bundle contains no secret markers. | PROD Playwright + CODE + bundle scan |
| P-14 | **PASS** | R2 migration dry-run: **0 objects / 0 DB references**; no legacy résumés/DM/verification rows. The only public sensitive object is the orphan in C-05. | live `scripts/migrate-private-r2.mjs` read-only plan |
| P-15 | **PASS** | App security headers: HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy, Permissions-Policy; website same baseline + HTTPS redirect. | PROD HTTP |
| P-16 | **PASS** | Unit suites: moderation 75/75, private storage 36/36, signup 7/7, R2 migration planner 6/6. | LOCAL |
| P-17 | **PASS** | Moderation repair verified on a disposable DB: original `20261030220000` fails at `column "target_type" does not exist`; renaming the legacy table + rerun succeeds; `20261030230000` preserves the legacy row and produces the expected new schema. | LOCAL |
| P-18 | **PASS** | Production Supabase project `ux-community` (`eauupthwlnarkauwifmw`) is `ACTIVE_HEALTHY`; RLS is enabled on all public tables; `supabase_realtime` publication is empty; service-role access works. | PROD catalog/API |
| P-19 | **PASS** | Gated write routes (threads/showcase/resources/events creation, comments, job apply) do **not** pass `allowUnverified`; those routes are verification-gated after grace. The bypass is limited to chat/DM/some likes. | CODE |
| P-20 | **PASS** | `.open-next/` and `.dev.vars*` are gitignored and absent from git history; the deployed client chunks contain no secret markers. | repo + PROD bundle scan |

### 2.4 Not tested / blocked

| ID | Status | Finding |
|---|---|---|
| N-01 | **NOT TESTED** | Authenticated web/mobile workflows: signup completion, login, logout-all, password change/reset, report submission, moderation actions, appeals, account deletion, private résumé/DM download, signed-URL expiry. No production test accounts were available/used; no destructive tests were run. |
| N-02 | **BLOCKED** | No staging environment is defined. The only other Supabase project (`sachin1228's Project`, `wrlbykrjgoulfjqpqkoj`, Singapore) is not referenced by shipped config and its role is unknown. E2E must provision a dedicated staging project + R2 test buckets. |
| N-03 | **NOT TESTED** | Android APK flows (auth, session revocation, account deletion, private media, push, event routing). Requires a real device and a staged APK. |
| N-04 | **NOT TESTED** | Email/FCM delivery end-to-end; signed URL expiry over HTTP; realtime revocation on an open socket. Requires staging credentials/device. |
| N-05 | **NOT TESTED** | Supabase PITR restore (PITR is disabled/no backups); R2 restore (versioning disabled). Cannot be tested against production; must be tested on a disposable project after backups are configured. |

---

## 3. Production schema comparison

### 3.1 Applied migration history (live)

`supabase_migrations.schema_migrations` on production contains only:

| Version | Note |
|---|---|
| `001` | matches local `001_password_resets.sql` |
| `20261005140518` | **no local file with this version; SQL content unknown** |
| `20261008145053` | **no local file; content unknown** |
| `20261012205406` | **no local file; content unknown** |
| `20261023120000` | matches local `20261023120000_fcm_tokens.sql` |

**Inventory:** 208 local migration files, 196 unique version prefixes. Compared with the remote history: **2 matched, 194 local-only, 3 remote-only.** Duplicate version groups: `20260718` (5 files), `20260719` (2), `20260720` (5), `20260721` (2), `20260924120000` (2), `20261010120000` (2).

**Consequence:** the production schema is a brownfield/manual SQL-editor state, not a replay of the repository chain. `supabase db push`/`db reset` cannot be trusted. This is not merely cosmetic: the three remote-only versions may represent untracked changes, and 194 local migrations are unrecorded.

### 3.2 Live objects that match the intended schema

The following recent launch objects are present in production (schema AND service-role reads verified):

- `auth_sessions` with `session_version`, `revoked_at`, `revoked_reason`, expiry/subject checks, indexes; `users.session_version` and `users.suspended_until`.
- `moderation_audit_log` (new): 13 columns including `moderator_sid`, `moderator_label`, `previous_state`, `new_state`; action check; immutable `BEFORE UPDATE OR DELETE` trigger; no foreign keys; 0 rows.
- `moderation_audit_log_legacy_20261030`: 9 columns (`moderator_email`, `target_content_type`, `target_user_id`, `metadata`), FK `target_user_id → users(id) ON DELETE SET NULL`; RLS enabled; **0 rows**. This table is not in the repository.
- `moderation_appeals`: one-per-report unique index, status check; 0 rows.
- `interaction_reports`: target types include `community` and `job`; reasons include the six new ids; status includes `actioned`; reporter FK is `ON DELETE SET NULL`; 0 rows.
- `content_reports`: reporter FK `ON DELETE SET NULL`; 0 rows; status check has only `pending/removed/dismissed`.
- `dm_reports`: reporter/reported FKs `ON DELETE SET NULL`; 0 rows.
- `job_posts.moderated_at`/`moderation_note` + moderated index; `job_posts_guard_moderated_reopen` trigger; 0 job posts.
- `verification_settings` row: `grace_days = 2`; `users.verification_status`, `verification_reapply_at`, `age_confirmed_at`, `terms_accepted_at`.
- `member_resumes.storage_key`, `job_applications.resume_key`, `account_verification_requests.work_sample_keys`, `dm_messages.image_key`; constraints enforce the private key shapes.
- `user_blocks` table and `dm_blocks` view; `dm_blocks` is a view over `user_blocks`, not a separate table.
- `company_directory_seed_retained` view; expected from the reset operation.
- RLS enabled on all public tables; `supabase_realtime` publication empty; 20 policies (all own-row/author policies, no `USING (true)` public policy).

### 3.3 Schema / function drift

| Object | Live production | Repository / app expectation | Impact |
|---|---|---|---|
| `public.get_resource_list_aggregates(uuid,uuid[])` | Exists, returns **6** columns: `id, save_count, comment_count, bookmark_count, user_saved, user_bookmarked` | Edited migration and `performance-rpcs.ts` expect **7** columns including `allow_replies` | Production pages currently work because `get_resource_list_page` emits `allow_replies` in its item JSON; the aggregate field is unused/undefined. A fresh DB has **no function at all**, so resource pages would error/500. |
| Fresh migration chain | `20260814030000` references `community_resources.allow_replies` before `20260911160000` adds it | A fresh DB should create the RPC after the column exists | Local PG17 proof: `ERROR: column r.allow_replies does not exist`; the function is never created. |
| `moderation_audit_log_legacy_20261030` | Exists, 0 rows, old schema; not in repo | Repo only has the new `20261030220000` definition | Manual repair artifact. New table/legacy table both RLS-protected; historical rows would be preserved physically but are not shown by the new audit UI. |
| `member_resumes` | `authenticated` has full DML; 4 policies (`select/insert/update/delete own`) | Unmerged REVOKE migration assumes “RLS enabled, no client-facing policy” | The grant+policies are a defense-in-depth gap; the app uses service role, so revoking does not break it. |
| Default privileges | `pg_default_acl` grants `anon`/`authenticated` on new public tables (and sequences/functions) | `public_read_exposure.test.sql` expects 0 client grants | Every future table starts exposed; the seven-table REVOKE is only a point fix. |
| `get_home_feed_page` | Three overloads (3/4 args) | App calls the `p_scope` overload | No immediate issue; overloads must be maintained. |

### 3.4 Permission comparison (live)

**Tables with `anon`/`authenticated` SELECT (and full DML):**

| Table | anon | authenticated | RLS | Policies |
|---|---|---|---|---|
| `content_reports` | full | full | enabled | none |
| `content_removals` | full | full | enabled | none |
| `fcm_tokens` | full | full | enabled | none |
| `account_verification_requests` | full | full | enabled | none |
| `verification_email_codes` | full | full | enabled | none |
| `verification_settings` | full | full | enabled | none |
| `member_resumes` | — | full | enabled | 4 own-row policies |

`public_read_exposure.test.sql` (first assertion) would return **7** and fail. RLS currently prevents actual row reads on the six no-policy tables; `member_resumes` own-row policies are inert because the app does not use Supabase Auth. This is a privilege-escalation/blast-radius finding, not evidence of a current cross-user data leak.

**Correctly closed:** `users`, `auth_sessions`, `interaction_reports`, `moderation_audit_log`, `moderation_appeals`, `dm_messages`, `dm_reports`, `job_applications`, `member_resumes` (grants aside for member_resumes), `password_resets`, `fcm_tokens` (grants aside), `notifications`, `push_tokens`, `user_blocks` — no anon/authenticated grants; RLS enabled; service_role retains access.

**Functions:** sensitive RPCs (`set_user_blocked`, `set_user_suspended`, `revoke_*`, `create_auth_session`, `change_user_password`, `create_notification`, `complete_signup`, `apply_to_job`, etc.) are security-definer/invoker with `search_path` set and execute granted only to `service_role`/`postgres`, except trigger-only functions. No `public` execute on the sensitive RPCs was found.

### 3.5 Moderation migration conflict — production state

Production is already in the **repaired** state:

- `moderation_audit_log` exists with the new schema (13 columns, immutable trigger, no FKs), 0 rows.
- `moderation_audit_log_legacy_20261030` exists with the old schema/FK, 0 rows.
- `20261030220000`/`20261030230000` are **not recorded** in `supabase_migrations`.

The exact failure was reproduced on a disposable PG17 DB:

```text
20261030220000_complete_moderation_system.sql:142:
ERROR: column "target_type" does not exist
```

Repair and re-run succeeded; the legacy row was preserved; `20261030230000` produced `moderator_label`, the immutable trigger, zero audit FKs, `moderation_appeals`, `users.suspended_until` and the `SET NULL` reporter FK. The verified sequence is in §5.3. Do **not** re-run the original migration against a database that still has the legacy table.

---

## 4. Security findings

### 4.1 Immediate/high

1. **Plaintext HTTP app.** The login page and API are reachable without TLS redirect. This exposes credentials and session traffic on first visit; HSTS cannot protect a first HTTP request. **Fix at Cloudflare edge, not only Next.js.**
2. **No recoverable backups.** This is a security/availability issue: a compromised or accidental delete cannot be rolled back. R2 has no versioning/undelete; Supabase has no PITR/backups listed. See §7.
3. **Public orphan verification sample.** One 878,801-byte file under `verification/` is public with a one-year immutable cache. It has no DB row and its owner prefix does not resolve to a user, so it is an orphaned test/legacy artifact. It is still sensitive and must be removed and purged.
4. **Verification gate bypass.** Because chat/DM sends pass `allowUnverified: true`, an account that is never approved can send messages indefinitely. Combined with open signup and no CAPTCHA, this is a spam/abuse path and contradicts the Terms/banner. It also weakens the “verification is the bot gate” design.
5. **Client-role grants on sensitive tables.** RLS prevents current row reads, but the grants mean a future permissive policy, a mistake, or a `SET ROLE`-style path could expose reports, FCM tokens, verification PII and settings. The project default ACL recreates the grants on every new table.
6. **Secrets in local build artifact.** `apps/web/.open-next/cloudflare/next-env.mjs` contains the full production secret set in plaintext. It is gitignored and untracked and the deployed client bundle is clean, but the workspace/backup file must be treated as a credential exposure. Delete them; rotate all values if they were copied/shared; replace the manually chosen admin credential with a generated one.
7. **Admin actions bypass the audit log.** Direct blocks/unblocks, hard deletes, DM report status changes and content-report removals are moderator decisions but are not recorded in the append-only audit log. This weakens accountability and contradicts the policy.
8. **DM report queue cannot act.** DM harassment cannot be warned/suspended/banned from its queue; the only actions are status changes.
9. **Content evidence is incomplete.** Threads/showcase/resources/events reports retain a title and author, but not the body/media snapshot the policy promises; comments/chat/profile reports retain a 500-character excerpt and `{}` snapshot. After edit/delete, evidence may be insufficient.
10. **Blocked/suspended erasure fails.** Session revocation makes the self-service deletion endpoint unreachable for exactly the users who most need it; the manual email path remains, but the in-app claim is false.
11. **Report target visibility is unchecked.** A member who knows a UUID can report private-community content, and there is no per-target report cap.
12. **No CSP / CSRF token / broad cookie domain.** Defense-in-depth gaps; the session cookie is sent to the marketing site and all subdomains. SameSite=Lax helps, but same-site XSS on the marketing host could issue authenticated POSTs.
13. **Rate limits fail open.** Upstash is healthy now, but a quota/outage disables login/reset/report throttles without an alert by default.
14. **Legacy public URL fallbacks.** New code does not upload résumés/verification/DM files to the public bucket, but legacy resume fallbacks and the verification submit path can still carry public URLs. Production currently has no such DB rows; the public orphan shows why the fallback must be closed.
15. **Mobile verification image disk cache.** Signed verification samples use a plain image loader with disk caching, potentially surviving sign-out on a shared device.

### 4.2 Positive controls

- Private bucket isolation, key namespaces, proxy authorization, and 401/404 masking are implemented and unit-tested.
- Sensitive RPCs are service-role-only; admin routes are guarded; internal cron/validation routes use `API_SECRET`; realtime handshakes fail closed.
- Session revocation is well-designed (registry row + global version + admin epoch + realtime close), and private-file proxies use the same evaluator.
- RLS is enabled on all public tables and no `USING (true)` public read policy remains; the Supabase Realtime publication is empty.
- Evidence-retention triggers and `SET NULL` reporter references passed local SQL tests.
- Website security headers/HSTS and mobile legal pages are solid; signup consent is server-required and legal links are live.

---

## 5. Migration execution plan (do not execute without approval)

### 5.1 Preconditions

1. **Create an independent recoverable backup first.** Because production has no backups/PITR, take a logical dump (`pg_dump` PG17) and an R2 object manifest outside the production account; encrypt them (age) and store the private key offline. Do not proceed with DDL until this exists.
2. **Freeze writes** or choose a low-traffic window; the production data is tiny but the SQL editor has no transaction wrapper.
3. **Record the exact pre-change state:** table columns/constraints/triggers/ACL, `moderation_audit_log` and `_legacy` row counts (both 0 at audit time), `get_resource_list_aggregates` definition.
4. **Use a staging clone** for every script; production is not a test environment.

### 5.2 Critical ordering fixes (fresh DB / staging)

Add a **forward** migration after the latest (`20261030230000`) and correct the historical chain for fresh installs:

1. **Repair the old migration for fresh installs:** in `20260814030000_community_list_aggregate_rpcs.sql`, remove the `allow_replies` output/CTE (restore the pre-edit 6-column function). This file was edited after production applied it (`cf1577ad6`), so editing it does not change production; it only makes a fresh chain run.
2. **Add a new migration** (e.g. `20261030250000_fix_resource_list_aggregates.sql`) that:
   - `alter table public.community_resources add column if not exists allow_replies boolean not null default true;`
   - `drop function if exists public.get_resource_list_aggregates(uuid, uuid[]);` (required to change the return type)
   - recreates the function with the 7-column signature `(id, save_count, comment_count, bookmark_count, user_saved, user_bookmarked, allow_replies)`, `security invoker`, `set search_path = ''`, the `resources` CTE, and `coalesce(resources.allow_replies, false)`;
   - revokes `public/anon/authenticated` and grants execute to `service_role`;
   - `notify pgrst, 'reload schema';`
3. **Add a strict fresh-DB assertion** to `run-local.sh`/CI: after the full chain, `has_function('public','get_resource_list_aggregates')` and the 7-column signature must exist. The current harness uses `ON_ERROR_STOP=0` and masked this bug.
4. **Add/keep the pgTAP helpers** from the unmerged branch (`has_column`, `col_is_null`) — the main `test:private-storage-sql` currently fails with `function has_column(...) does not exist`.
5. **Do not rely on `supabase db push`** until the chain and history are fixed. The first error (20260814) aborts a push before the new repair migration can run.

### 5.3 Moderation repair (verified local sequence)

Production is already repaired; this is for any environment still holding the legacy table, or a DR rebuild:

1. **Inspect:** confirm `moderation_audit_log` exists with the **old** columns (`moderator_email`, `target_content_type`, `target_content_id`, `metadata`), capture `count(*)`, and verify the new table is absent or empty.
2. **Rename, do not delete:** `alter table public.moderation_audit_log rename to moderation_audit_log_legacy_YYYYMMDD;`
3. **Apply `20261030220000_complete_moderation_system.sql`.** It creates the new table, adds constraints/indexes, appeals, suspension, and functions.
4. **Apply `20261030230000_preserve_moderation_evidence.sql`.** It adds `moderator_label`, removes audit FKs (because append-only + FK actions collide), and rewrites the queue views.
5. **Verify:** new table 13 columns; action check; immutable trigger; 0 FKs; `moderation_appeals` exists; `users.suspended_until` exists; reporter FKs are `ON DELETE SET NULL`; legacy row count unchanged in `_legacy` table.
6. **Decide about legacy rows.** The repair preserves them physically in `_legacy`, but the new admin audit UI reads only the new table. With 0 production rows no data migration is needed. If rows exist, write a reviewed mapping (`moderator_email` → `moderator_label`, `target_content_type/id` → `target_type/id`, action mapping) and copy them **without activating the immutable trigger on the legacy table**; document the mapping.
7. **Keep the legacy table** (RLS enabled, service-role-only) for at least one release; include it in backups.

**Verified local result:** the original migration fails at `column "target_type" does not exist`; rename+rerun succeeds; `20261030230000` preserves the legacy row and produces the expected new schema. No production operation was performed.

### 5.4 Permission hardening

1. Merge/apply `20261030240000_revoke_client_select_on_launch_tables.sql` from `fix/prelaunch-audit-findings` (`843359387`) — it revokes the seven tables from `public`, `anon`, `authenticated` and leaves `service_role` intact.
2. Add a **default-privilege** migration for `public` tables (and sequences/functions if appropriate) so future tables do not re-acquire client grants. Test with a throwaway table + `has_table_privilege`.
3. Apply to staging first; run `public_read_exposure.test.sql` (expect the first assertion to become 0) and a service-role smoke test. The app, realtime, cron and admin paths use service_role/API_SECRET, so legitimate backend access should survive; verify `member_resumes` policies become inert but harmless.
4. Do not grant client roles back for convenience; the app has no Supabase Auth client.

### 5.5 Migration-history baseline

Production’s history is not usable for tooling. Choose one controlled approach after a schema diff:

- **Preferred:** keep the existing manual SQL-editor process, but maintain a signed “applied migrations” ledger in the repo and run a schema diff against staging before each release. Never run `db push` blindly.
- **Alternative:** after verifying every object against a staging clone, use `supabase migration repair --status applied <version>` for the versions actually applied (a write to `supabase_migrations`), and record the three unknown remote versions after obtaining their SQL. This requires approval and a backup; do not insert 194 rows speculatively.
- Resolve duplicate timestamp groups before adding new migrations; use unique, increasing timestamps.

### 5.6 Rollback/recovery

- **Before DDL:** independent PG dump + R2 manifest; keep the pre-change function definition and ACL snapshot.
- **Moderation repair:** the legacy table is only renamed; to recover, stop before dropping anything, rename back, and restore from the dump if needed. Never delete the legacy table in this release.
- **RPC repair:** keep the 6-column definition; rollback by drop/create 6-column only if the app is rolled back too. The safer rollback is a forward fix, not a destructive downgrade.
- **Revokes:** re-granting client roles is not a rollback we recommend; fix the broken backend path instead. `service_role` is untouched.
- **Catastrophic failure:** restore the independent dump to a disposable project, validate counts/functions/policies, then restore R2 objects from the backup mirror. This is only possible after §7 is done.

---

## 6. R2 migration and public-exposure plan

### 6.1 Dry-run findings (read-only)

| Metric | Public bucket `drafthub` | Private bucket `uxcommunity-private` |
|---|---:|---:|
| Total objects | **4,464** | **2** |
| Total bytes | **26,671,052** | **1,342,175** |
| Prefixes | `companies/` 4,363; `master-data/` 90; `events/` 5; `threads/` 4; `playground/` 1; `verification/` 1 | `dm/` 1; `resumes/` 1 |
| Sensitive legacy objects | **1** (`verification/`, 878,801 bytes) | 2 (1 résumé + 1 DM) |
| DB-referenced private keys | — | **2/2 present; 0 missing; 0 orphaned** |
| DB-legacy sensitive rows | **0** résumés, **0** verification, **0** DM | — |
| Migration plan | **0 objects / 0 references** | — |
| Checksum verification | **Not performed** (dry-run; no copy) | — |
| Public access | custom domain `media.uxcommunity.in` + r2.dev enabled | no custom domain; r2.dev disabled |
| Versioning | **Disabled** | **Disabled** |
| Lifecycle | only 7-day multipart abort | only 7-day multipart abort |
| Object lock | not configured | not configured |

The only publicly readable sensitive file is the orphaned `verification/` object. It has **no `account_verification_requests` row** and its owner prefix does not match a `users.id`, so it is an orphan. Public `HEAD` returns 200 with `Cache-Control: public, max-age=31536000, immutable`; the audit observed `cf-cache-status: DYNAMIC` on HEAD, but a GET can populate the edge cache, so deletion must be followed by a URL purge.

### 6.2 Safe procedure (requires approval; not executed)

1. **Confirm the orphan is not needed.** Because it has no DB reference and no owner account, treat it as a test artifact. If the user wants to preserve it, copy it to the private bucket first; do not leave it public.
2. **Delete only that object** from `drafthub` via the R2 S3 API (never delete the bucket). Do not touch the 4,463 company/master-data/community media objects.
3. **Purge the exact public URL** in Cloudflare (Caching → Purge by URL) for the custom domain; also verify the r2.dev URL. Do not purge the whole zone/cache.
4. **Verify:** custom domain and r2.dev both return 404/403 for that key; no `verification/` prefix remains in the public bucket; R2 listing count drops by one; the private buckets/DB are unchanged.
5. **Do not run `--apply` or `--purge-public`:** the dry-run plan is empty, so there is no state file and nothing to migrate. Running the migration script now would do nothing; keep it for future legacy rows.
6. **If a legacy row appears later:** run the read-only plan; inspect counts/keys; run `--apply` (copy + SHA-256 + DB key update); spot-check applicant/poster/DM/admin views; then run `--purge-public --confirm-purge`; purge the emitted URL list; verify no row/report snapshot still references the old URL. The script deliberately refuses to purge referenced sources.
7. **CDN caveat:** public objects are immutable for one year; deleting the origin is not enough. The purge list is mandatory. If `R2_PUBLIC_URL` were a `pub-*.r2.dev` URL, edge caching would be bypassed, but here the custom domain is in front.
8. **Backup caveat:** R2 versioning is off, so a mistaken delete is permanent. Before any deletion, mirror the object/prefix to a backup bucket (or enable versioning) and record ETag/size. Do not rely on the CDN cache as a backup.

### 6.3 Private-file authorization (code/live)

- New résumés, saved résumés, verification samples and DM images all use `uploadPrivateToR2` with `private, no-store`.
- Application résumé proxy: applicant or that job’s poster; saved résumé: owner only; verification: owner/admin; DM: participant/admin evidence.
- Anonymous probes to all three private proxy routes returned **401** live.
- Signed GETs are bounded 1–3600s; web/DM 5 min, mobile résumés 15 min, verification display 15 min, upload preview 30 min. Unit tests cover host/expiry/key shape; live expiry was not exercised.
- Mobile verification samples are the exception: they use a plain image component with disk caching (M-01).

---

## 7. Backup and disaster-recovery verdict

# NOT RECOVERABLE TODAY

| Control | Current state | Verdict |
|---|---|---|
| Supabase physical backups | `backups: 0`; `physical_backup_data: {}`; CLI `PITR=false`, earliest/latest `0` | **FAIL** |
| Supabase PITR | Disabled | **FAIL** |
| Independent DB dump/automation | No workflow on `main`; implementation only on `feat/backup-disaster-recovery` (`3eb2c30dd`) | **FAIL** |
| R2 versioning | Disabled on public and private buckets | **FAIL** |
| R2 object lock | Not configured | **FAIL** |
| R2 backup/mirror | None on `main`; branch implements a mirror | **FAIL** |
| Restore drill evidence | Local branch drill reportedly passes (76 tables, PG17); no production drill/record | **NOT OPERATIONAL** |
| Secret escrow | No evidence of an offline copy of the age private key / DB password / admin credential | **FAIL/UNKNOWN** |
| RPO/RTO | Not defined; no monitored backup freshness | **FAIL** |

**Can we recover after database loss or accidental deletion?** **No.** There is no restorable database copy and no R2 undelete/versioning. The CDN may hold public media copies, but that is not a controlled backup and does not cover the private bucket or the database.

**What to do (approved work):**

1. Merge `feat/backup-disaster-recovery` after review; configure `SUPABASE_DB_URL`, `BACKUP_R2_BUCKET`, least-privilege backup credentials, `BACKUP_AGE_RECIPIENT`; store the age private key offline (not in CI).
2. Run the daily encrypted logical dump + R2 mirror; add R2 versioning and/or a dedicated backup bucket with object lock; keep retention outside the production account.
3. Run the weekly restore drill into a throwaway PG17 database and verify row counts, functions, RLS and R2 checksums; record the result. Run one full restore into a disposable Supabase project before launch.
4. Define RPO/RTO and alert on missed/failed backups (the branch already emails failures).
5. Back up the legacy moderation table and the manual schema artifacts as part of the dump.

**Note:** the backup branch’s local drill applied 206 migrations; current `main` has 208 and the fresh-chain bug. Re-run the drill after §5.2 fixes and confirm the restored DB has `get_resource_list_aggregates` and the expected RLS/ACL state.

---

## 8. Remaining launch blockers

### 8.1 Must fix before launch

1. **HTTPS enforcement** on `app.uxcommunity.in` (and all subdomains); verify login/API POSTs are HTTPS-only. *(C-02)*
2. **Recoverable backups** — independent encrypted DB dump + R2 mirror/versioning + a real restore drill. *(C-01)*
3. **Remove and purge the public orphan verification sample.** *(C-05)*
4. **Apply the sensitive-table REVOKE + default-privilege hardening**; verify service_role and run the exposure test. *(C-04)*
5. **Fix the verification gate** (gate chat/DM writes or deliberately document them; set grace days; add bot protection if open writes remain). *(C-03)*
6. **Fix the fresh-DB migration chain and RPC drift**, duplicate versions and the migration-history baseline. *(C-06/C-23)*
7. **Fix blocked/suspended account deletion**, or change the policy and route those users to support. *(C-07)*
8. **Fix admin audit gaps, DM report actions and content evidence** to match the moderation policy. *(C-08/C-09/C-10)*
9. **Fix jobs/events correctness**: transactional resume attachment, reject public verification URLs, event schedule validation, host deletion notice. *(C-11/C-12/C-21)*
10. **Rotate the exposed credentials** if the local build artifacts/backups were copied; delete them; replace the manually chosen admin credential with a generated high-entropy secret. *(C-13)*

### 8.2 Must verify before launch (staging/device)

- Full E2E matrix in §9, especially signup consent, account deletion, all report types, admin actions, appeals, revocation, private R2, signed URL expiry and realtime reconnect.
- Real Android APK: login, logout-all, password reset, account deletion (including blocked/suspended), private DM/résumé images, push routing, session revocation.
- Resend email delivery (signup/reset/moderation/appeal/decision) and FCM delivery; signed-URL expiration over HTTP.
- Production data classification: 2 users / 1 DM / 1 resume / 68 messages / 42 communities; confirm what is official, remove test data, re-consent or delete the pre-consent account. *(C-22)*
- Legal copy after product decisions: guidelines reporting sentence, verification/read-only claim, backup claim. *(C-15)*

### 8.3 Can safely be deferred (but schedule)

- CSP (start report-only), CSRF/Origin checks, cookie-domain narrowing, rate-limit fail-closed fallback.
- Mobile event push routing, notification gaps/dedupe, job-match fan-out cap, resume-key stripping.
- Mobile appeals screen, admin logout-all UI, legal links in settings, mobile block-from-profile, mobile saved-résumé viewer.
- Stale secrets (`MODERATION_IMAGE_SERVICE_URL`, `INVITATION_EXPIRY_DAYS`), r2.dev public origin, non-sensitive public orphan media cleanup.
- Admin direct suspend/lift control, company domain revoke action, raw Postgres error mapping.

---

## 9. Staging E2E test plan

**Rules:** use a dedicated staging Supabase project and separate R2 test buckets. Never run destructive tests against production or real users. Use disposable test accounts and test content; delete them after. Production gets non-destructive smoke checks only (legal pages, HTTPS, anonymous 401s).

| # | Test | Environment | Key steps / expected result |
|---|---|---|---|
| E2E-01 | Signup + 18+/Terms consent | Staging web + mobile + real device | Sign up with a new email; both checkboxes required client and server (crafted POST without flags → 422); timestamp written in the same transaction; legal links 200; grace/gate behavior matches the chosen policy; duplicate email rejected; no account without consent. |
| E2E-02 | Account deletion | Staging | User with profile, community, report, DM, résumé, avatar; enter password + `DELETE`; all cascades removed, community transferred/deleted, reports retained/anonymized, audit retained, private R2 keys removed, cookie cleared, confirmation email sent. Test blocked/suspended user (currently expected fail — document). |
| E2E-03 | Blocking/unblocking | Staging web + Android | Block from profile/DM; both directions cannot DM/comment/notify; profile reduced; unblock from each surface; messages remain; no block toast; mobile Block action exists after fix. |
| E2E-04 | Reporting all types | Staging | Report thread/showcase/resource/event post, all four comment kinds, chat message, profile, community, job, DM conversation; verify correct table/row, snapshot/excerpt, admin queue rendering, duplicate/self-report/rate-limit behavior, and invisible/private target handling. |
| E2E-05 | Admin moderation | Staging | For each queue: dismiss, remove/restore, hide community, deactivate job, warn, suspend, ban, unban, lift; verify every action writes an audit row and the target state changes; DM queue actions (after fix); admin-only access. |
| E2E-06 | Warnings/suspensions/bans | Staging | Warn/suspend 1–30 days/ban; verify notification/email, session_version bump, all rows revoked, realtime 4001 close, login behavior, suspension expiry, permanent ban, unban. |
| E2E-07 | Appeals/restoration | Staging | Member appeal from dashboard; email-token appeal for banned/suspended; one-per-report + 3/24h; admin grant/deny; content/community/job restore; audit; decision email (after fix); deleted comment/chat cannot be restored. |
| E2E-08 | Evidence after reporter deletion | LOCAL + Staging | Create reports from a disposable reporter; delete reporter; verify `reporter_id` NULL, `reporter_deleted_at` set, report/evidence/audit preserved, queue shows “Deleted user”; appeals retention decision. |
| E2E-09 | Individual/global session revocation | Staging web + Android | Logout one device; logout-all; password change; password reset; suspend/ban; old JWT 401, other devices revoked, current device behavior per design, sockets closed; reconnect rejected. |
| E2E-10 | Realtime disconnect/reconnect | Staging browser + Android | Open socket; revoke session; expect close 4001; reconnect with old token rejected; new login works; membership endpoint fail-closed with wrong `API_SECRET`. |
| E2E-11 | Private R2 authorization | Staging test buckets | Applicant/poster/other member/admin for application; owner/other for saved; owner/admin for verification; participant/other/admin for DM; expect 200/404/401 per matrix; no permanent public URL; mobile cookie-bearing image loads. |
| E2E-12 | Signed URL expiry | Staging | Wait 5 min (web/DM), 15 min (mobile résumé/verification), 30 min (preview); expect 403/expired; re-request gives a fresh URL; proxy re-checks authorization. |
| E2E-13 | Android auth/deletion | Real Android device | Fresh APK: signup/login, logout-all, password reset, account deletion with password+DELETE, blocked/suspended deletion, private DM/résumé/verification images, push routing, session revocation on socket. |
| E2E-14 | Terms/Privacy/guidelines | Production smoke | Web/mobile signup links and footer/settings links load 200; 18+ and consent text visible; updated copy matches the implementation (after C-15); delete-account page works; no dead links. |

**Environment requirements:**

| Requirement | Tests |
|---|---|
| Local disposable PostgreSQL 17 + pgtap stand-ins | E2E-08, migration/retention SQL, fresh-chain test |
| Staging Supabase project + staging web/realtime Workers | E2E-01–12, most 14 |
| Separate staging R2 public/private buckets | E2E-11/12 |
| Real Android device + staged APK | E2E-01/03/09/10/13 |
| External credentials: Resend (test domain), Expo/FCM project, Cloudflare realtime, Upstash | E2E-06/07/09/13 |
| No production destructive tests | All |

---

## 10. Final recommendation — shortest practical sequence

1. **Freeze and back up.** Create an independent encrypted PG17 dump + R2 manifest before any production change; this is the first step because there is no backup today.
2. **HTTPS.** Enable Cloudflare Always Use HTTPS/redirect for `app.uxcommunity.in`; verify `http://` login/API can no longer serve or accept credentials.
3. **Permissions.** Merge/apply the unmerged REVOKE migration and a default-privilege revoke; verify `service_role`, realtime, cron and admin paths.
4. **Verification.** Gate chat/DM writes (or make a deliberate policy change), choose the grace period (0 recommended for a verified-write model), add bot protection if any unverified write remains, and update the banner/Terms/guidelines.
5. **Migrations.** Fix the fresh chain/RPC, duplicate versions and history baseline; prove a fresh DB and a staging clone both work; update `run-local.sh` strict assertions.
6. **R2.** Delete/purge the orphan verification object; confirm no public sensitive prefix remains; do not run the migration apply/purge (0 planned objects).
7. **Moderation.** Fix audit gaps, DM queue actions, content evidence, blocked/suspended deletion and appeal decision email; re-run the SQL/unit suites.
8. **Jobs/events.** Fix transactional resume attachment, public-URL acceptance, schedule validation and host-deletion notice; add the missing notification/preference handling.
9. **Backups.** Merge the backup branch, configure secrets/age escrow, enable R2 versioning/mirror, run a real restore drill and record RPO/RTO.
10. **Verify then launch.** Run the §9 staging/Android matrix, update legal copy, clean/classify production data, and only then do a non-destructive production smoke test.

**Do not launch until items 1–6 and 9 are complete.** Items 7–8 should ship in the same release if jobs/events are enabled at launch, but they must be staging-verified. Items in §8.3 can follow.

---

### Appendix A — Live production snapshot (read-only)

| Metric | Value |
|---|---:|
| Supabase project | `ux-community` / `eauupthwlnarkauwifmw` (Sydney; `ACTIVE_HEALTHY`) |
| Users | 2 (1 has NULL consent timestamps) |
| Communities | 42 |
| Community chat messages | 68 (oldest 2026-10-25; 0 older than 15 days) |
| Events | 1 |
| DM conversations / messages | 1 / 2 (1 image key) |
| Saved résumés | 1 (private key) |
| Job posts / applications | 0 / 0 |
| Content / interaction / DM reports | 0 / 0 / 0 |
| Moderation audit rows (new/legacy) | 0 / 0 |
| Verification requests | 0 |
| Active auth sessions | 5 (all unrevoked at snapshot) |
| R2 public bucket | 4,464 objects / 26,671,052 bytes |
| R2 private bucket | 2 objects / 1,342,175 bytes |
| Supabase Storage buckets | 0 |
| Verification grace | 2 days |

### Appendix B — Evidence commands (read-only; re-runnable)

- `npx supabase projects list`, `npx supabase migration list --linked`
- `npx supabase backups list --linked`; Management API `/v1/projects/{ref}/database/backups`
- Read-only SQL: `pg_class`, `pg_policies`, `pg_constraint`, `pg_proc`, `pg_trigger`, `pg_default_acl`, `has_table_privilege`, `pg_publication_tables`
- R2: `ListObjectsV2`, `GetBucketVersioning`, `GetBucketLifecycleConfiguration`, public `HEAD`; `wrangler r2 bucket domain list <bucket>`, `wrangler r2 bucket dev-url get <bucket>`, `wrangler secret list --name <worker>`
- Public: `curl` HTTP/HTTPS headers; Playwright 390px overflow; legal page status
- Local: `npm run test:moderation-db`, `test:private-storage-sql`, `test:private-storage`, `test:moderation`, `test:signup`, `test:private-r2-migration`; disposable PG17 + the exact moderation migration sequence.

### Appendix C — Unmerged work referenced

| Branch | Commit | Contents | Status |
|---|---|---|---|
| `fix/prelaunch-audit-findings` | `843359387` | `20261030240000_revoke_client_select_on_launch_tables.sql`; `public_read_exposure` test correction; `has_column`/`col_is_null` harness; `FINAL_PRE_LAUNCH_AUDIT.md` | **Unmerged**; REVOKE and harness additions still needed |
| `feat/backup-disaster-recovery` | `3eb2c30dd` | Daily encrypted PG dump + R2 mirror, verify/restore/restore-drill scripts, backup workflow, docs | **Unmerged**; no production backup exists |

Do not recreate these migrations/fixes; merge or adapt the existing branch after review. The `feat/playground` and `feat/competitions` branches are unrelated to launch readiness and should not be merged blindly.

### Appendix D — Secret-handling note

No secret values are reproduced in this report. A local build artifact and a local `.dev.vars` backup contain plaintext production credentials; both are gitignored and absent from git history, but they should be deleted, and the affected credentials should be rotated if those files were ever copied, synced or shared. The deployed client bundle was scanned and contains no secret markers. The production admin credential is manually chosen; rotate it to a generated high-entropy value and store it in a password manager.

---

**End of report.** No fixes were implemented. Awaiting approval for any production change, migration, R2 deletion/purge, secret rotation, deployment or merge.