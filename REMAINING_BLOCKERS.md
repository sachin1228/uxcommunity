# Remaining Blockers

**Date:** 2026-10-31
**Branch:** `fix/production-readiness-remediation`
**Overall status:** **READY FOR PR REVIEW** — code and local tests are review-ready, but this is **not** staging- or production-ready.

Legend for “Type”: **CODE** = implementation/test change; **CONFIG** = production/infra configuration; **INFRA** = provisioning; **PRODUCT** = policy decision; **APPROVAL** = manual production action.

## Launch blockers

| ID | Severity | Issue and evidence | Required action | Type | Timing |
|---|---|---|---|---|---|
| RB-01 | **CRITICAL** | **No recoverable backup/DR.** Supabase PITR false and zero physical backups; R2 versioning disabled; backup work is explicitly out of scope. Evidence: `supabase backups list --linked`, Management API `backups=0`, `pitr_enabled=false`. | Complete the separate backup/DR task; prove a restore of DB + both R2 buckets; define RPO/RTO. Do not apply production migrations before a recoverable dump exists. | INFRA / APPROVAL | Before deployment |
| RB-02 | **CRITICAL** | **Production migrations are not applied.** Eight remediation migrations are unapplied; app code expects the new RPCs/columns/audit actions. Applying web code first would break signup, job apply, content reports and audit writes. | Follow the exact order in `PRODUCTION_APPROVAL_CHECKLIST.md` §1 after backup + staging validation. | APPROVAL | Before deployment |
| RB-03 | **HIGH** | **Production code is not deployed.** HTTP login still returns 200 over plaintext, Policy A is not active, CSRF/CSP/rate-limit changes are branch-only. Evidence: live `http://app.uxcommunity.in/login` 200. | Merge/publish and deploy web + realtime via the approved workflow; verify HTTP→308 and HTTPS login. | APPROVAL / CONFIG | Before launch |
| RB-04 | **HIGH** | **One sensitive public R2 orphan** remains: `drafthub/verification/2e98842e-b3f3-4a9a-8517-380ee74bd613/2a81b3cd-3b6e-4ed9-882b-1ceef541d400.png` (878,801 B), public on `media.uxcommunity.in` and r2.dev; no DB row/user. | Preserve to private bucket, delete exact object, purge both URLs; verify 404/403. Checklist §3. | APPROVAL / CONFIG | Before launch |
| RB-05 | **HIGH** | **Seven sensitive tables still grant client roles in production** (`content_reports`, `content_removals`, `fcm_tokens`, `account_verification_requests`, `verification_email_codes`, `verification_settings` full; `member_resumes` authenticated). RLS currently blocks rows. | Apply `20261030240000` + `20261031090000` (after fixing/validating function defaults); verify scoped seven-table test. | APPROVAL | Before launch |
| RB-06 | **HIGH** | **Default ACLs are still project-wide permissive** for `postgres` public tables/sequences/functions, and `supabase_admin` public defaults remain permissive. PostgreSQL cannot remove a new function's built-in PUBLIC EXECUTE; every function migration must revoke explicitly. | Apply default-ACL migration; decide/perform platform-privileged `supabase_admin` change; adopt explicit function revoke convention. | CONFIG / CODE / APPROVAL | Before deployment |
| RB-07 | **HIGH** | **Migration history is still brownfield.** 202 unique local versions are unrecorded; no full column-level production schema diff; no verified staging upgrade. Three remote-only versions are now fetched/mapped to local equivalents, not unknown. | Provision staging; run controlled upgrade/schema diff; establish a verified baseline/ledger. Do not run `db push` or speculative repair. | INFRA / APPROVAL | Before production migration |
| RB-08 | **HIGH** | **No verified staging environment.** The only other Supabase project is not confirmed staging; no staging R2/Workers/Resend/FCM/device. | Follow the staging checklist in `STAGING_TEST_RESULTS.md` §14; use synthetic users/recipients only. | INFRA / APPROVAL | Before staging |
| RB-09 | **HIGH** | **No Android production signing or device verification.** Release uses `signingConfigs.debug`; package `in.uxcommunity.app`, versionCode 1/versionName 1.0.0; FCM/deep links/permissions untested; iOS bundle id is `com.sachinpatil1228.myapp`. | Provide upload keystore/EAS credentials, release signing config, FCM/deep-link/env verification, and a clean-device test. Do not upload to Play. | CONFIG / APPROVAL | Before launch |
| RB-10 | **HIGH** | **Open signup has no Turnstile/CAPTCHA.** Policy A limits writes but accounts can still be created and like/report; no server-side bot token verification exists. | Decide whether Turnstile is required; if yes, implement server `siteverify` (hostname/action, expiry/single-use/missing tests) + web/mobile widgets, test in staging. | PRODUCT / CODE / CONFIG | Before launch (decision) |
| RB-11 | **MEDIUM** | **Existing account consent is unresolved.** 1 of 2 production users has NULL age/terms consent; no re-consent flow. | Use the approved consent-gate plan in the checklist, or delete test-only accounts under a data plan; never fabricate timestamps. | PRODUCT / APPROVAL | Before launch |
| RB-12 | **MEDIUM** | **DM-origin suspend/ban has no signed appeal token.** DM actions are audited and notify support email, but the appeal system is report-scoped; mobile has no appeals screen (decision email is the alternative). | Decide whether to auto-create a profile report for DM bans or accept support-email path; document. | PRODUCT / CODE | Before launch |
| RB-13 | **MEDIUM** | **CSP is report-only; session cookie remains `.uxcommunity.in`.** The broad cookie is required by the current realtime WebSocket cookie handshake. | Enforce a tested nonce/hash CSP and introduce a short-lived realtime token before narrowing the cookie. | CODE / CONFIG | After staging |
| RB-14 | **MEDIUM** | **Verification privacy limits:** owner GET returns own `work_sample_keys` (resubmit form), admin strips keys; legacy rows return public URLs; signed URLs expire in 15 min without auto-refresh; mobile verification images use disk caching; public evidence cannot be cleaned here. | Decide owner-key policy; add signed-URL refresh; use private media loader on mobile; migrate/purge legacy public objects under approved R2 work. | PRODUCT / CODE / APPROVAL | Before/after staging |
| RB-15 | **MEDIUM** | **Event/notification gaps remain:** event comments/likes/chat after end; lifecycle push ignores FCM/preferences/quiet hours; mobile event push routing misses the event; notification dedupe/type gaps; mobile legal links. | Implement and test in staging; no production change made. | CODE | After staging |
| RB-16 | **MEDIUM** | **Admin audit/direct-suspension gaps:** event delete and verification review are now wired and contract-tested, but no route integration test; direct user suspend/lift UI and some non-moderation admin edits remain outside the audit. | Add route-level tests; add direct suspend/lift with duration validation; decide audit scope for remaining admin edits. | CODE / PRODUCT | Before launch / after staging |
| RB-17 | **MEDIUM** | **Rate-limit global limiter still fails open; some read/typing/safety endpoints fail open by design.** Abuse-sensitive writes are fail-closed, but the global middleware limiter is availability-oriented. | Accept/ document; monitor Upstash; consider a scoped fail-closed global policy for mutations after staging. | CODE / CONFIG | After staging |
| RB-18 | **MEDIUM** | **Production data is test-seeded / unclassified:** 2 users, 42 communities, 68 messages, 1 event, 1 DM, 1 saved resume, 0 jobs/reports. One consent-null account. | Confirm official communities; remove/retain test accounts/content under a written data plan; no destructive test. | APPROVAL | Before launch |
| RB-19 | **MEDIUM** | **Legal copy is not published.** Terms/Privacy/Guidelines/Delete-account changes are in the separate website branch `fix/production-readiness-legal-copy`; live pages still show the old copy. | Review/merge/publish the website branch; verify live copy after deployment. | APPROVAL | Before launch |
| RB-20 | **HIGH (local)** | **Secret-bearing local artifacts remain:** `apps/web/.open-next/cloudflare/next-env.mjs` and `apps/web/.dev.vars.bak-20261030151132` are gitignored/untracked but contain plaintext production credentials; deployed client bundle scan is clean. | Delete local artifacts after approval; rotate listed secrets if the artifacts were copied/shared; never print values. Do not rotate automatically. | APPROVAL / CONFIG | Before launch |
| RB-21 | **INFO** | **PR not created/pushed.** `gh` is logged out; branches are local: app `b2c2aff5`, website `7223681`. | Publish via GitHub Desktop/authenticated git; open the two PRs using the compare links/checklist body. | APPROVAL | Before review |
| RB-22 | **INFO** | **Backup/DR remains a separate task** and is a prerequisite for production migrations/launch; no backup work was started. | Complete separately. | INFRA / APPROVAL | Before launch |

## Status of the original audit’s critical items

| Item | Current state |
|---|---|
| HTTPS | Code/local test PASS; production not deployed. |
| Policy A | Code/local test PASS; production enforcement not active until deploy. |
| Sensitive grants | Migration/test ready; production not applied. |
| R2 orphan | Exact operation prepared; not deleted/purged. |
| Migration chain/RPC | Fresh chain + 7-column RPC verified locally; production old until migration. |
| Blocked/suspended deletion | Credential route implemented; parser test only; live test blocked. |
| Admin audit | Major actions + event/verification wired; no route E2E; see RB-16. |
| DM actions | Warn/suspend/ban/dismiss/reopen wired; appeal token gap (RB-12). |
| Evidence/appeals | Structured snapshots + decision email + retention test (5/5); legacy/owner-key/mobile gaps (RB-14/RB-12). |
| Jobs/resume | Transactional RPC + strict public-URL rejection + key stripping; no live job fixtures. |
| Events/reports | Core validation/visibility/caps fixed; remaining gaps (RB-15). |
| Secrets | Local artifacts found and documented; no rotation/deletion. |
| Android | Debug signing only; see RB-09. |

## Required before deployment

1. Independent, recoverable backup (RB-01).
2. Staging provision + full upgrade/schema/permission test (RB-07/RB-08).
3. Production migration approval/order (RB-02).
4. R2 orphan removal/purge + seven-table REVOKE/default ACL (RB-04/RB-05/RB-06).
5. Secret rotation decision (RB-20).
6. Production data/consent decision (RB-11/RB-18).
7. Android signing/device test (RB-09).
8. Deploy + post-deploy HTTP/Policy A verification (RB-03).

**No production operation was performed in this task.**
