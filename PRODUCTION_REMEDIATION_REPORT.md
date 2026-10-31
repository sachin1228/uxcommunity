# UXCommunity — Production Remediation Report

**Date:** 2026-10-31
**Branch:** `fix/production-readiness-remediation`
**Baseline audit:** `FINAL_PRODUCTION_READINESS_REPORT.md` (2026-10-31, main `1928205f`)
**Production project inspected (read-only):** `ux-community` / `eauupthwlnarkauwifmw` (Sydney)
**Staging:** not provisioned/confirmed. No staging or production write was performed during this remediation.

## Final verdict

# READY FOR STAGING

The remediation branch is code-complete and passes the final local regression gates, so it is ready to be deployed to a **separate staging environment** and run through the matrix in `STAGING_TEST_RESULTS.md`. This is **not** a production-approval claim:

- No staging environment is provisioned or was tested; no real Supabase/Workers/R2/email/FCM/Android E2E was performed.
- The production migrations, deployment, R2 deletion/purge and secret rotation are not executed.
- The production app still has the old HTTP behavior, client grants, 6-column RPC and public R2 orphan.
- Backup/DR is out of scope and unresolved.
- Android release signing/device verification is unresolved; Turnstile, CSP enforcement, cookie narrowing and some mobile appeal/screen gaps remain open decisions.

Local gates now passing: web TypeScript, **1,081/1,081** web unit tests, isolated production build, website build, **281/281** full realtime Worker tests (including 1,000 clients), mobile TypeScript and documented mobile suites, and **138/138** local database assertions over the 216-migration chain. The realtime 1,000-client failure is resolved as a test-harness isolation defect; no fan-out architecture change was needed.

**BACKUP / DISASTER RECOVERY: NOT ADDRESSED — explicitly deferred to a separate task, per instructions.** Production still has no verified backup/PITR and R2 versioning is disabled. This is a launch blocker outside this task’s scope; it must be handled before launch.

## What changed

### 1. HTTPS, CSRF, CSP and auth hardening

| Fix | Files |
|---|---|
| HTTP→HTTPS 308 redirect at the Worker/middleware layer, local-host exemption, `x-forwarded-proto`/`cf-visitor` support | `apps/web/middleware.ts`, `apps/web/lib/security/request-origin.ts` + test |
| Same-origin mutation guard (Origin/Sec-Fetch-Site); native/server requests without Origin remain allowed; internal Worker calls with API_SECRET still work | same |
| Report-only CSP (app and marketing site); HSTS/XFO/nosniff/referrer/permissions already present | `apps/web/next.config.js`, `uxcommunity-website/next.config.js` |
| Timing-safe admin email/password comparison | `apps/web/lib/auth/secure-compare.ts` + test, `app/api/auth/login/route.ts` |
| Fail-closed rate limits for login, signup, password reset/change, account deletion, reports, appeals, verification, chat/DM/content writes and company verification; read/typing/safety/global limits remain availability-oriented | `apps/web/lib/auth/rate-limit.ts`, critical call sites |
| No HSTS preload enabled | intentionally not changed |

Local verification: `curl` with `Host: app.uxcommunity.in` + `x-forwarded-proto: http` returned **308** to HTTPS; cross-origin POST returned **403**; same-origin POST reached validation (422); CSP report-only header present. See `STAGING_TEST_RESULTS.md`.

### 2. Verification policy (Policy A, with likes)

Selected policy: unverified accounts can browse, **like**, report/block, manage their own profile/verification and delete their account. All other writes require approval: posts, comments, community chat, DMs, community creation, job applications, etc.

- `assertUserState` no longer grants the old 2-day write grace; every non-approved account is gated.
- Chat send and DM send no longer pass `allowUnverified`; readlike routes keep it.
- Reporting and blocking now explicitly pass `allowUnverified` (safety actions remain available).
- Web and mobile banners in this branch and the separately committed website copy describe the policy; **neither is deployed**.
- The admin Verifications screen labels `grace_days` as **legacy** and explains it no longer gates writes.
- Tests: verification policy 4/4; 1,081/1,081 web unit tests pass.

### 2a. Verification evidence privacy (proxy)

- Owner and admin verification responses now return only authorization-gated proxy paths (`/api/private/verification/<requestId>/<index>`); no `work_sample_keys` or legacy public URLs.
- The new proxy route requires a live session and `canViewVerificationSample` (owner or admin); unauthorized callers get 404, anonymous callers 401.
- Key-backed samples redirect to a **5-minute** signed GET and are re-signed on every image request; legacy URL-backed rows are streamed server-side with `no-store`, so the public URL is no longer returned to clients.
- Resubmission sends `work_sample_refs`; the server resolves them to owned keys. Raw legacy URL-only refs are rejected and must be re-uploaded privately.
- Mobile thumbnails use expo-image with a memory-only cache policy and clear that cache on sign-out.
- Tests: proxy/path helpers 4/4, private access 4/4, session-route audit 6/6; live authorization/expiry still requires staging.

Remaining product decision: `verification_settings.grace_days` is still 2 in production and is now inert. It can be set to 0 for clarity (approval checklist).

### 3. Atomic signup consent

- New `terms_version` column on `users`.
- New `complete_signup_with_consent(...)` wraps `complete_signup`, requires both acknowledgements to be true, and writes `age_confirmed_at`, `terms_accepted_at`, `terms_version` in the **same transaction**.
- `/api/signup/avatar` uses the new RPC; the separate best-effort consent update was removed.
- Existing accounts are not back-filled; a re-consent plan is required (see approval checklist).
- Local DB test: false age confirmation refuses creation; valid consent creates exactly one account and persists both timestamps + version: **3/3 pass**.

### 4. Blocked/suspended account deletion

- Added public, deletion-only form at `/delete-account` and `POST /api/account/delete/credential`.
- Requires account email + password + literal `DELETE`; never creates a session; rate-limited; generic response for unknown email/wrong password.
- Uses the same `deleteAccountCascade`, so reports/audit evidence are retained, private R2 files are reclaimed and realtime sockets are revoked.
- The session-backed route remains for normal signed-in users.
- Parser tests 3/3; live authenticated/blocked deletion still requires staging/device testing.

### 5. Database permissions

- Added the existing unmerged `20261030240000_revoke_client_select_on_launch_tables.sql` for the seven sensitive tables.
- Added `20261031090000_harden_public_default_privileges.sql`: revokes future `anon`/`authenticated` table/sequence/function defaults for `postgres`, grants service-role defaults, and attempts the platform-owned `supabase_admin` defaults with a notice if not permitted.
- Extended `public_read_exposure.test.sql` with a future-table regression probe.
- Local result: **19 ok / 0 failed** (15 planned assertions); the seven sensitive tables are the scoped denylist, a new table gets no inherited client grant, service_role works, and an explicitly granted public-read fixture remains readable.
- **PostgreSQL limitation:** default privileges cannot remove a new function's built-in `PUBLIC EXECUTE`. The migration removes project-level anon/authenticated defaults and grants service_role, but every function migration must still explicitly revoke PUBLIC/anon/authenticated. The test checks a representative sensitive RPC; it does not claim a global function guarantee. The current Data API public-read allowlist is empty (the app is service-role-only).
- Production is still unchanged until the migration is approved/applied.

### 6. Migration chain and `get_resource_list_aggregates`

- Restored `20260814030000_community_list_aggregate_rpcs.sql` to the safe 6-column definition for fresh installs (the in-place edit had introduced a forward reference to a September column).
- Added transactional `20261031110000_fix_resource_list_aggregates.sql`: ensures `allow_replies`, drops/recreates the RPC with 7 columns, grants only service_role.
- Added `supabase/tests/migration_integrity.test.sql` (10/10) proving the 7-column RPC, `allow_replies`, atomic consent RPC, `terms_version`, transactional apply RPC, content snapshot, appeal retention column, and the expanded audit action check.
- Restored the unmerged `has_column`/`col_is_null` test harness additions and the `user_blocks` index test correction.
- Local DB: 216 migrations applied; private-storage SQL **11/11**, moderation evidence **82/82**, scoped permission exposure **19 ok/0 failed**, migration integrity **10/10**, signup consent **3/3**, appeal retention **5/5**, evidence concurrency **8/8** — **138/138** combined assertions.

Production migration history remains a brownfield ledger (see `MIGRATION_RECONCILIATION.md`). Do not run `supabase db push`; production history still needs a controlled baseline after schema diff/approval.

### 7. Moderation audit, DM actions and evidence

- Expanded `moderation_audit_log` action check with direct account/content/community/job/DM actions (`delete_user`, `review_dm_report`, `reopen_dm_report`, `restore_content`, `reopen_report`, `toggle_community`, `delete_community`, `toggle_job`, `delete_job`).
- Added shared `adminAuditActor`/`recordAdminAudit` helper.
- Wired audit writes for:
  - admin user block/unblock and delete;
  - DM report reviewed/dismissed/reopen;
  - content report remove/dismiss/reopen/restore;
  - community visibility toggle/delete;
  - job delete.
- DM queue now supports **Warn**, **Suspend 1–30 days**, **Ban**, Dismiss, Reopen; action buttons added to the admin page; subject/target is loaded from the report (not client input).
- Evidence: `content_reports.target_snapshot` column + target body/media/links/poll copy at report time; interaction comments/chat/profile now store structured snapshots (not `{}`); admin content detail exposes the snapshot.
- Appeals: decision email added for banned/suspended users; `moderation_appeals` now preserves rows on account/report deletion (`user_deleted_at`, nullable `SET NULL` FKs, anonymization trigger extended); admin queue shows “Deleted user.”
- Admin event deletion and account-verification decisions now write `delete_event`/`review_verification` audit rows (migration action check + routes); tests cover the action contract, not the routes end to end.
- Remaining limitations: a ban issued from the DM queue has **no signed appeal token** (the appeal system is report-scoped); the member is told to email support. Mobile has no appeals screen; decision email is the reliable path. Appeal retention/anonymization is tested locally (5/5).

### 8. Jobs

- Added transactional `apply_to_job_with_resume(...)`: application insertion and `resume_key` attachment now commit together; no more success-with-no-resume/orphaned key.
- Service chooses the new RPC when a private key is used; legacy URL path remains for pre-migration saved rows.
- New verification submissions reject public `work_sample_urls`; only private keys are accepted. Legacy rows remain readable.
- `resume_key` is stripped from web/mobile job/applicant responses; clients receive proxy paths or short-lived signed URLs.
- Job application status route now scopes the application to the `[id]` job.
- Job-match notifications are capped at 500 recipients and batched 25 at a time.
- Production currently has 0 job posts/applications; live flow is not exercised.

### 9. Events, reports and notifications

- Event PATCH validates end > start and a newly chosen start not in the past; pure helper + 4/4 tests.
- RSVP rejects an event that has already ended.
- Host deletion notifies attendees who RSVPed (in-app), in addition to the existing moderated-deletion notice.
- Report targets now check private-community visibility; outsiders get 404.
- Per-target report cap: 25 reports/24h per content target, in addition to per-user limits.
- Still deferred: event comments/likes/chat after end, event lifecycle FCM/preferences/quiet hours, mobile event push routing, notification dedupe gaps.

### 10. Legal/product copy

Updated the marketing site:
- Terms: Policy A wording (read-only, likes/reporting/account actions allowed; posting/commenting/chat/DM/apply require approval).
- Community Guidelines: community/job reports are now described as available; removed the “no report control yet” contradiction; aligned report-response wording with Terms.
- Privacy: removed the unsupported provider-backup-cycle claim; explicitly states no verified backup service currently, while retaining the CDN-cache caveat.
- Delete-account: added a “Delete without signing in” path to the new app form and removed the backup-copy claim.

Marketing build passes. Changes are in `uxcommunity-website` and need their own publish/approval.

## Original audit findings — status

| Audit ID | Status after remediation | Notes |
|---|---|---|
| C-01 backups/DR | **DEFERRED — NOT ADDRESSED** | Explicitly out of scope. No production backup/PITR; R2 versioning still disabled. |
| C-02 HTTP plaintext | **CODE FIXED — DEPLOY PENDING** | Middleware 308 redirect; local verified. Production still HTTP until deploy. |
| C-03 verification gate | **CODE FIXED — DEPLOY PENDING** | Policy A; likes/reports/account actions allowed; tests pass. |
| C-04 sensitive grants | **MIGRATION READY — APPLY PENDING** | Scoped seven-table test + default ACL; local 19 ok/0 failed; function-default limitation documented. |
| C-05 public R2 orphan | **PREPARED — APPROVAL PENDING** | Exact object and deletion/purge steps in checklist; object still public. |
| C-06 migration chain/RPC | **CODE FIXED — APPLY PENDING** | Fresh DB now creates 7-column RPC; integrity 10/10. |
| C-07 blocked/suspended deletion | **CODE FIXED — LIVE TEST PENDING** | Credential deletion path + public form; parser tests only. |
| C-08 admin audit gaps | **FIXED IN CODE — ROUTE E2E PENDING** | User block/delete, DM, content, community, job, event delete and verification review wired; contract test only. |
| C-09 DM report actions | **FIXED — NO SIGNED APPEAL** | Warn/suspend/ban/dismiss/reopen + audit + UI; DM bans use support-email path. |
| C-10 evidence snapshots | **FIXED** | Structured post/interaction snapshots; existing rows untouched. |
| C-11 transactional resume | **CODE FIXED — DB TEST LIMITED** | New RPC; no job fixtures for an end-to-end apply test. |
| C-12 public URLs/keys | **FIXED — LIVE TEST PENDING** | Owner/admin APIs return proxy paths only; the proxy re-signs 5-minute private GETs and streams legacy objects; resubmission uses owned refs; mobile uses memory-only thumbnails. Legacy objects remain publicly readable at their original R2 URLs until the separate cleanup. |
| C-13 secrets in artifacts | **NOT FIXED — APPROVAL** | Local `.open-next`/`.dev.vars.bak` still exist; rotate and delete; client bundle clean. |
| C-14 consent | **FIXED (new accounts)** | Atomic RPC + test; existing accounts plan pending. |
| C-15 legal copy | **FIXED IN WEBSITE — PUBLISH PENDING** | Terms/Guidelines/Privacy/Delete-account updated. |
| C-16 CSP/CSRF/cookie | **PARTIAL** | CSRF fixed; CSP report-only; cookie domain remains broad. |
| C-17 rate-limit fail-open | **FIXED FOR ABUSE-SENSITIVE WRITES** | Auth/signup/delete/reports/appeals/verification/chat/DM/content/company-verification limits fail closed; read/typing/safety/global remain availability-oriented; 3/3 tests. |
| C-18 report visibility/cap | **FIXED** | Private visibility check + 25/24h target cap. |
| C-19 admin suspension UX | **PARTIAL** | DM suspend/ban; no direct user suspend/lift control. |
| C-20 appeals | **PARTIAL** | Decision email + retention; mobile screen/content appeals still limited. |
| C-21 jobs/events | **PARTIAL** | Core fixes; event-ended interactions/push preferences/notification gaps deferred. |
| C-22 production data | **NOT TOUCHED** | 2 users / test content; data plan needs approval. |
| C-23 migration history | **NOT REPAIRED** | Three remote-only versions were fetched (temp) and mapped to local equivalents; 202 local unique versions remain unrecorded; no production repair. |

## Tests and evidence

See `STAGING_TEST_RESULTS.md` for the full matrix. Final local regression results:

- Web TypeScript: **PASS**.
- Web unit suite: **1,081/1,081 PASS** (133 files), exit 0.
- Web isolated production build: **PASS** (full copy with cloned dependencies, no production env files; dummy public env only). Lint on touched files: **0 errors, 1 existing `<img>` warning**.
- Website build: **PASS**.
- Mobile TypeScript: **PASS**; documented realtime **71/71**, cache **7/7**, signup **12/12**.
- Full mobile sweep: **441/444**; the three failures are pre-existing harness-load failures (`communitiesSnapshot`, `communityBootstrap`, `dmConversationsCache` import React Native Flow source under `tsx`), not changed-code failures.
- Realtime Worker TypeScript: **PASS**. Full Worker suite: **28 files / 281 tests PASS in 1,703 s, exit 0**, including 1,000 clients (85 s) and 500×100 fan-out. Ownership suite **21/21**; zero duplicate deliveries.
- DB local harness (216 migrations): migration integrity **10/10**, scoped permission exposure **19 ok/0 failed**, private storage **11/11**, moderation evidence **82/82**, signup consent **3/3**, appeal retention **5/5**, evidence concurrency **8/8** — **138/138**.
- Rate-limit regression **3/3**; appeal retention **5/5**; audit/CSP/sample contract tests **7/7**.
- Middleware local: HTTP→HTTPS **308**, cross-origin mutation **403**, same-origin reaches route, CSP header present.
- Not run/blocked: staging E2E, real Android release/device flows, live email/FCM delivery, platform-level load tests, live signed-URL expiry, production deploy/migration/R2 deletion.

## Remaining risks and deferred work

1. **Backup/DR remains absent** (out of scope). This is a launch prerequisite, not a staging blocker.
2. **No staging environment exists.** All results are local; a separate Supabase/Workers/R2/email/FCM/Android environment is required to verify deployment behavior, real revocation, delivery and device flows.
3. **Turnstile is not implemented.** Open signup still relies on rate limits, verification gating, creation limits and reporting. Policy A blocks most writes, but bots can still create accounts and like/report. This is a product/infrastructure decision; no active bot protection is claimed.
4. **Existing accounts with NULL consent** (1 of 2 in production) are not re-consented; production data may be test-only. Decide before launch.
5. **DM-origin bans have no signed appeal token.** Support email is the documented fallback; profile-report escalation is the alternative.
6. **Admin audit route-level verification is not exhaustive**: event deletion and verification review are wired and the action contract is tested, but no route integration test/second actor test exists; admin join-all and some non-moderation admin edits are intentionally outside the audit.
7. **No direct admin suspension/lift UI**; suspension comes from a report or the DM queue, lifting from an appeal.
8. **CSP is report-only** and the cookie domain must remain `.uxcommunity.in` for the current realtime cookie handshake; CSRF is checked. Enforcing CSP or narrowing the cookie requires tested nonce/script and realtime-token work.
9. **Android release readiness is incomplete.** Release uses `signingConfigs.debug`; package `in.uxcommunity.app`, versionCode 1/versionName 1.0.0; iOS bundle id is still the placeholder `com.sachinpatil1228.myapp`. The manifest requests location, record-audio, overlay and storage/media permissions, sets `allowBackup=true`/`requestLegacyExternalStorage`, and declares only the `uxcommunity` scheme (no verified app links). `google-services.json` exists but FCM/deep-link/env behavior, a signed release build and a clean-device test are outstanding. No key was generated or uploaded.
10. **Verification privacy is fixed in the branch, with residual origin exposure.** Owner/admin APIs return proxy paths only and the proxy re-signs 5-minute GETs; legacy rows are streamed. However, legacy objects remain publicly readable at their original R2 URLs until the approved cleanup, upload preview URLs expire after 30 minutes, and the proxy/authorization/device behavior still needs a staging test.
11. **Realtime scale is verified only locally.** The full Worker suite passed 28 files/281 tests in 1,703 s, including 1,000 clients and 500×100 fan-out with zero duplicates; the earlier 1,000-client hello timeout was test-process resource accumulation and is fixed by Vitest forks/isolation. Platform-level staging load, open-socket revocation and multi-region behavior remain unverified.
12. **Event-ended comments/likes/chat, event lifecycle FCM/preferences/quiet hours, mobile event routing, notification dedupe, mobile appeals screen and mobile legal links** remain deferred.
13. **Migration history is still brownfield**; the fresh chain and 7-column RPC are fixed, but production version history was not repaired and no full column-level schema diff exists without staging.

## Approval required

Every production operation is listed with exact commands/SQL, impact, rollback and verification in `PRODUCTION_APPROVAL_CHECKLIST.md`. No production change has been executed.

**Next gate:** deploy this branch to a **separate staging environment** and run the matrix in `STAGING_TEST_RESULTS.md`. Production approval is requested only after staging, backup/DR, Android signing and the remaining product decisions are complete.

**BACKUP / DISASTER RECOVERY: NOT ADDRESSED — explicitly deferred to a separate task.** See `REMAINING_BLOCKERS.md` for the consolidated launch-blocker list.
