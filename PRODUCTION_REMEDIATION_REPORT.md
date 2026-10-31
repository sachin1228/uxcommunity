# UXCommunity — Production Remediation Report

**Date:** 2026-10-31
**Branch:** `fix/production-readiness-remediation`
**Baseline audit:** `FINAL_PRODUCTION_READINESS_REPORT.md` (2026-10-31, main `1928205f`)
**Production project inspected (read-only):** `ux-community` / `eauupthwlnarkauwifmw` (Sydney)
**Staging:** not provisioned/confirmed. No staging or production write was performed during this remediation.

## Final verdict

# READY FOR PR REVIEW

The in-scope code and local tests are complete enough for human review. This is **not** a staging or production-readiness claim:

- The production migrations, deployment, R2 deletion/purge and secret rotation are not executed.
- No verified staging environment or Android device was available.
- The production app still has the old HTTP behavior, client grants, 6-column RPC and public R2 orphan.
- Backup/DR is out of scope and unresolved.
- Turnstile, CSP enforcement, cookie narrowing, mobile appeal/screen gaps and Android production signing remain open decisions.

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
- Tests: verification policy 4/4; 1,080/1,080 web unit tests pass.

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
- Added `supabase/tests/migration_integrity.test.sql` (9/9) proving the 7-column RPC, `allow_replies`, atomic consent RPC, `terms_version`, transactional apply RPC, content snapshot, appeal retention column, and the expanded audit action check.
- Restored the unmerged `has_column`/`col_is_null` test harness additions and the `user_blocks` index test correction.
- Local DB: 216 migrations applied; private-storage SQL **11/11**, moderation evidence **82/82**, scoped permission exposure **19 ok/0 failed**, migration integrity **9/9**, signup consent **3/3**, appeal retention **5/5**.

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
- Still deferred: event comments/likes/chat after end, event lifecycle FCM/preferences/quiet hours, mobile event push routing, notification dedupe gaps, mobile private-verification disk cache.

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
| C-06 migration chain/RPC | **CODE FIXED — APPLY PENDING** | Fresh DB now creates 7-column RPC; integrity 9/9. |
| C-07 blocked/suspended deletion | **CODE FIXED — LIVE TEST PENDING** | Credential deletion path + public form; parser tests only. |
| C-08 admin audit gaps | **FIXED IN CODE — ROUTE E2E PENDING** | User block/delete, DM, content, community, job, event delete and verification review wired; contract test only. |
| C-09 DM report actions | **FIXED — NO SIGNED APPEAL** | Warn/suspend/ban/dismiss/reopen + audit + UI; DM bans use support-email path. |
| C-10 evidence snapshots | **FIXED** | Structured post/interaction snapshots; existing rows untouched. |
| C-11 transactional resume | **CODE FIXED — DB TEST LIMITED** | New RPC; no job fixtures for an end-to-end apply test. |
| C-12 public URLs/keys | **PARTIAL** | New verification URLs rejected; legacy read fallback remains for existing rows; admin responses strip keys, while the owner still receives own keys for the resubmit form; keys do not authorize reads. |
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

See `STAGING_TEST_RESULTS.md` for the full matrix. Highlights:

- Web TypeScript: **PASS**.
- Web unit suite: **1,080/1,080 PASS** (133 files).
- Web isolated production build: **PASS** (no production env files; dummy public env only).
- Website build: **PASS**.
- Mobile TypeScript: **PASS**; mobile realtime **71/71**, cache **7/7**, signup **12/12**.
- Realtime Worker TypeScript: **PASS**. Full Worker suite: **TIMEOUT at 600 s** (killed during 500×100 fan-out). Targeted critical subset: **38/39**, with the 1,000-client ownership test failing `Timeout waiting for hello`; rerun not performed. This is a staging/load verification gap, not claimed as a pass.
- DB local harness (216 migrations): migration integrity **9/9**, scoped permission exposure **19 ok/0 failed**, private storage **11/11**, moderation evidence **82/82**, signup consent **3/3**, appeal retention **5/5**.
- Rate-limit regression **3/3**; appeal retention **5/5**; audit/CSP/sample contract tests **7/7**.
- Middleware local: HTTP→HTTPS **308**, cross-origin mutation **403**, same-origin reaches route, CSP header present.
- Not run/blocked: staging E2E, real Android release/device flows, live email/FCM delivery, load tests, live signed-URL expiry, production deploy/migration/R2 deletion.

## Remaining risks and deferred work

1. **Backup/DR remains absent** (out of scope).
2. **Turnstile is not implemented.** Open signup still relies on rate limits, verification gating, creation limits and reporting. Policy A blocks most writes, but bots can still create accounts and like/report. This is a product/infrastructure decision; no active bot protection is claimed.
3. **Existing accounts with NULL consent** (1 of 2 in production) are not re-consented; production data may be test-only. Decide before launch.
4. **DM-origin bans have no signed appeal token.** Support email is the documented fallback; profile-report escalation is the alternative.
5. **Admin audit route-level verification is not exhaustive**: event deletion and verification review are wired and the action contract is tested, but no route integration test/second actor test exists; admin join-all and some non-moderation admin edits are intentionally outside the audit.
6. **No direct admin suspension/lift UI**; suspension comes from a report or the DM queue, lifting from an appeal.
7. **CSP is report-only** and the cookie domain must remain `.uxcommunity.in` for the current realtime cookie handshake; CSRF is checked. Enforcing CSP or narrowing the cookie requires tested nonce/script and realtime-token work.
8. **Android release signing is not configured.** Release uses the debug keystore; package `in.uxcommunity.app`, versionCode 1/versionName 1.0.0; iOS bundle id is still the placeholder `com.sachinpatil1228.myapp`; FCM/deep-link/env verification and a real device build remain outstanding.
9. **Verification privacy has accepted limits:** the owner GET returns own `work_sample_keys` for resubmit; admin responses strip keys; legacy rows return public URLs; signed URLs expire after 15 minutes without auto-refresh; mobile verification images use disk caching.
10. **Realtime scale is not verified:** the local 1,000-client ownership test failed with a hello timeout and the full Worker suite timed out; a real staging/load run is required before claiming realtime readiness.
10. **Account re-consent is a recommendation, not implemented:** production has one account with NULL consent; no timestamp was fabricated. See the approval checklist for a consent-gated plan.
8. **Event-ended comments/likes/chat, event lifecycle FCM/preferences, mobile event routing, notification dedupe, mobile private-verification disk cache, mobile legal links** remain deferred.
9. **Migration history is still brownfield**; the fresh chain is fixed, but production version history was not repaired.
10. **No staging/device verification** was possible; treat the code as local-tested, not staging-verified.

## Approval required

Every production operation is listed with exact commands/SQL, impact, rollback and verification in `PRODUCTION_APPROVAL_CHECKLIST.md`. No production change has been executed.

**BACKUP / DISASTER RECOVERY: NOT ADDRESSED — explicitly deferred to a separate task.** See `REMAINING_BLOCKERS.md` for the consolidated launch-blocker list.
