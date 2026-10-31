# Production Approval Checklist

**Branch:** `fix/production-readiness-remediation`
**Status:** **READY FOR STAGING** — local code and regression gates pass; **nothing below has been executed against production.** Deploy to a separate staging environment and complete §8 before requesting production approval.
**Backup / DR:** NOT ADDRESSED — explicitly deferred to a separate task. Do not apply production migrations until a recoverable backup exists (the separate task or an approved one-off dump).

Each item is independently approvable. Stop and obtain approval before executing any production operation.

---

## 0. Publish the branch / open the PR

The branch is committed locally. `gh` is **not authenticated** in this environment, so the agent cannot push/open the PR. Publish the branch and open the PR from GitHub Desktop (or an authenticated `gh`), then paste the PR body below.

Suggested PR title: `fix: production readiness remediation`

Suggested PR body:

```
Production-readiness remediation branch:
- enforce HTTP→HTTPS redirect + same-origin mutation checks + report-only CSP
- Policy A verification gate (likes/reports/account actions allowed; other writes require approval)
- atomic signup consent + versioned consent
- deletion-only credential path for blocked/suspended accounts
- revoke client grants on seven sensitive tables + harden default ACLs
- repair fresh migration chain / resource aggregate RPC
- audit admin actions, DM report actions, evidence snapshots, appeal retention/email
- transactional resume attachment, reject public verification URLs, strip resume keys
- verification evidence proxy (owner/admin paths, 5-minute re-signed GETs, legacy streaming, memory-only mobile thumbnails)
- event schedule validation, attendee cancellation notices, report visibility/caps

Tests: web tsc, 1,087 web unit tests, isolated production build, website build,
mobile tsc + realtime/cache/signup tests (71/71, 7/7, 12/12), full realtime Worker
suite clean run 281/281 (including 1,000 clients); later review reruns under system
memory pressure timed out 1 and then 3 heavy performance cases, while the exact
10K case passes alone), local 216-migration DB suites 138/138.
No production deploy/migration/R2/secret change was performed.
Backup/DR is deferred to a separate task.
```

**Approval required:** yes (publishing/pushing/opening PR). No merge/deploy until the items below are approved.

---

## 1. Production migrations — apply in this exact order

**Preconditions:**

- A recoverable independent backup exists (separate task or approved one-off dump).
- Staging clone has applied the same sequence successfully.
- Run during a low-write window; use one SQL editor/psql session per file; stop on the first error.
- **Do not run `supabase db push` or `db reset`.**
- **Do not re-run** `20261030220000_complete_moderation_system.sql` or `20261030230000_preserve_moderation_evidence.sql`; production is already in the repaired state (new `moderation_audit_log` + `moderation_audit_log_legacy_20261030`, both 0 rows).

**Do not re-run** `20260814030000_community_list_aggregate_rpcs.sql` after `20261031110000_fix_resource_list_aggregates.sql`; its restored fresh-install form would overwrite the 7-column production function. It is for fresh databases only.

The three remote-only ledger versions (`20261005140518`, `20261008145053`, `20261012205406`) were fetched read-only into a temp directory and mapped to local equivalents in `MIGRATION_RECONCILIATION.md`; do not insert ledger records or re-apply them.

| # | File | Purpose | Reversible? |
|---|---|---|---|
| 1 | `20261030240000_revoke_client_select_on_launch_tables.sql` | Revoke `public/anon/authenticated` on the seven sensitive tables; service_role untouched | Re-grant (not recommended) |
| 2 | `20261031090000_harden_public_default_privileges.sql` | Revoke future client table/sequence/function defaults; grant service_role defaults; notice if `supabase_admin` cannot be altered | Re-grant defaults |
| 3 | `20261031100000_signup_consent_atomic.sql` | Add `users.terms_version`; add `complete_signup_with_consent` | Additive |
| 4 | `20261031110000_fix_resource_list_aggregates.sql` | Transactional drop/create 7-column RPC; ensure `allow_replies` | Keep old definition for rollback |
| 5 | `20261031120000_expand_moderation_audit_actions.sql` | Expand audit action check | Revert check |
| 6 | `20261031130000_report_evidence_snapshots.sql` | Add `content_reports.target_snapshot` | Additive |
| 7 | `20261031140000_apply_to_job_with_resume.sql` | Transactional resume-apply RPC | Additive |
| 8 | `20261031150000_moderation_appeals_retention.sql` | Appeal retention columns/FKs + anonymization trigger | Additive; FKs can be restored |

**Deploy order:** migrations **before** the web Worker, then realtime. The new web code calls `complete_signup_with_consent` and `apply_to_job_with_resume`, inserts `target_snapshot`, and writes new audit actions; deploying it first would fail those paths.

**Exact verification SQL (run after each group, as postgres):**

```sql
-- 1. 7-column resource RPC
select pg_get_function_result('public.get_resource_list_aggregates(uuid,uuid[])'::regprocedure);
-- expect: TABLE(id uuid, save_count bigint, comment_count bigint, bookmark_count bigint,
--               user_saved boolean, user_bookmarked boolean, allow_replies boolean)

-- 2. new columns/functions
select column_name from information_schema.columns
 where table_schema='public' and table_name='users' and column_name='terms_version';
select column_name from information_schema.columns
 where table_schema='public' and table_name='content_reports' and column_name='target_snapshot';
select column_name from information_schema.columns
 where table_schema='public' and table_name='moderation_appeals' and column_name='user_deleted_at';
select proname from pg_proc where proname in ('complete_signup_with_consent','apply_to_job_with_resume');

-- 3. scoped sensitive-table denylist (do NOT assert a blanket zero)
with sensitive(name) as (
  values ('content_reports'), ('content_removals'), ('fcm_tokens'),
         ('account_verification_requests'), ('verification_email_codes'),
         ('verification_settings'), ('member_resumes')
)
select count(*) from pg_class c
 join pg_namespace n on n.oid = c.relnamespace
 join sensitive s on s.name = c.relname
where n.nspname = 'public' and c.relkind in ('r','p')
  and (has_table_privilege('anon', c.oid, 'SELECT')
       or has_table_privilege('authenticated', c.oid, 'SELECT'));
-- expect 0

with sensitive(name) as (
  values ('content_reports'), ('content_removals'), ('fcm_tokens'),
         ('account_verification_requests'), ('verification_email_codes'),
         ('verification_settings'), ('member_resumes')
)
select count(*) from pg_class c
 join pg_namespace n on n.oid = c.relnamespace
 join sensitive s on s.name = c.relname
where n.nspname = 'public' and c.relkind in ('r','p')
  and has_table_privilege('service_role', c.oid, 'SELECT');
-- expect 7

-- 3b. default-ACL probes (transaction + cleanup; staging test covers this)
-- create table public.__acl_probe(id int);
-- anon/authenticated SELECT = false; service_role SELECT = true
-- create function public.__acl_fn_probe() returns int language sql as 'select 1';
-- service_role EXECUTE = true; anon EXECUTE is STILL true by PostgreSQL built-in
-- PUBLIC EXECUTE. Default privileges cannot remove that built-in. Every
-- sensitive function migration must explicitly revoke PUBLIC/anon/auth and
-- grant service_role; the regression test checks a representative RPC.

-- 3c. intentional public-read allowlist
-- Current allowlist is EMPTY (the app is service-role-only). A future public
-- table must be granted explicitly; the default ACL will not grant it. The
-- test creates an explicit anon read policy + grant fixture to prove that path.

-- 4. service role still works
select has_table_privilege('service_role','public.community_messages','SELECT'); -- true

-- 5. audit action check
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.moderation_audit_log'::regclass
   and conname='moderation_audit_log_action_check';
-- expect 'delete_user', 'review_dm_report', 'toggle_community', 'delete_event', 'review_verification' among the values

-- 6. appeals retention
select is_nullable from information_schema.columns
 where table_schema='public' and table_name='moderation_appeals' and column_name='user_id';
-- expect YES
```

**Rollback:** keep a pre-change dump and the old 6-column function definition. The moderation repair is rename-based; never drop `moderation_audit_log_legacy_20261030` in this release. If a migration fails, stop, restore the approved dump, and re-run from the last verified file. Do not attempt `db push` recovery.

**Approval required:** yes, per file group. Expected impact: brief RPC drop/create within a transaction; no table data rewrite except additive columns and FK metadata. Production has 0 reports/appeals/jobs, so data risk is low, but back up first.

---

## 2. Deploy the web + realtime Workers

After the migrations and after the PR is merged:

- The repository deploy workflow (`Deploy to Cloudflare`) runs on `main`; it type-checks, tests, verifies secrets, deploys web, pushes secrets, deploys realtime, and smoke-tests realtime.
- Confirm the Worker build includes the new middleware and routes.
- **Do not run a local production build with `apps/web/.env.local`**; it contains production credentials and would create secret-bearing artifacts. The isolated build in this branch used dummy public env and passed.

**Post-deploy verification:**

```bash
curl -sSI http://app.uxcommunity.in/login | head -5     # expect 308 to https
curl -sSI https://app.uxcommunity.in/login | head -5    # expect 200
curl -sSI http://app.uxcommunity.in/api/auth/me         # expect 308 to https
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' \
  --data '{}' https://app.uxcommunity.in/api/auth/login # expect 403
```

**Rollback:** redeploy the previous Worker version if the middleware breaks a legitimate client; the old version is available in Cloudflare. Do not revert the migrations unless the business decision is to drop the corresponding code too.

**Approval required:** yes (deploy/merge/publish).

---

## 3. R2 public verification orphan — secure copy, delete, purge

**Exact object (read-only listing, 2026-10-31):**

- Bucket: `drafthub`
- Key: `verification/2e98842e-b3f3-4a9a-8517-380ee74bd613/2a81b3cd-3b6e-4ed9-882b-1ceef541d400.png`
- Size: `878801` bytes
- Last modified: `2026-10-26T06:14:28.777Z`
- Public URLs:
  - `https://media.uxcommunity.in/verification/2e98842e-b3f3-4a9a-8517-380ee74bd613/2a81b3cd-3b6e-4ed9-882b-1ceef541d400.png`
  - `https://pub-923ef24d1eca4d4ea1424abc040cb5ed.r2.dev/verification/2e98842e-b3f3-4a9a-8517-380ee74bd613/2a81b3cd-3b6e-4ed9-882b-1ceef541d400.png`

It has **no `account_verification_requests` row** and its owner prefix does not resolve to a `users.id`. It is an orphaned test/legacy artifact.

**3.1 Preservation copy (before deletion):**

Use the R2 credentials from the approved secret store without echoing them. Copy the object to the private bucket (no public domain, r2.dev disabled), e.g.:

```bash
aws s3 cp \
  's3://drafthub/verification/2e98842e-b3f3-4a9a-8517-380ee74bd613/2a81b3cd-3b6e-4ed9-882b-1ceef541d400.png' \
  's3://uxcommunity-private/verification-quarantine/2a81b3cd-3b6e-4ed9-882b-1ceef541d400.png' \
  --endpoint-url "https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com"
```

Verify the private object exists with the same size/ETag (or SHA-256 if downloading) before the next step. The private bucket is the preservation copy; do not create a public URL for it. If `aws s3 cp` cross-bucket is unsupported in the account, use `aws s3api copy-object` with the same source/destination, or download + encrypt locally and store off-app.

**3.2 Delete only the exact object:**

```bash
aws s3api delete-object \
  --bucket drafthub \
  --key 'verification/2e98842e-b3f3-4a9a-8517-380ee74bd613/2a81b3cd-3b6e-4ed9-882b-1ceef541d400.png' \
  --endpoint-url "https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com"
```

Do **not** delete the bucket or any `companies/`, `master-data/`, `events/`, `threads/` or `playground/` object. Do not run the private-R2 migration script: its read-only plan has **0 objects / 0 DB references**.

**3.3 Purge the public URLs:**

Cloudflare dashboard → Caching → Purge by URL, for **both** exact URLs above (custom domain and r2.dev). Public objects carry `Cache-Control: public, max-age=31536000, immutable`; origin deletion alone does not evict an edge copy. Do not purge the whole zone.

**3.4 Verify:**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' 'https://media.uxcommunity.in/verification/2e98842e-b3f3-4a9a-8517-380ee74bd613/2a81b3cd-3b6e-4ed9-882b-1ceef541d400.png'
curl -sS -o /dev/null -w '%{http_code}\n' 'https://pub-923ef24d1eca4d4ea1424abc040cb5ed.r2.dev/verification/2e98842e-b3f3-4a9a-8517-380ee74bd613/2a81b3cd-3b6e-4ed9-882b-1ceef541d400.png'
```

Expect 404/403 on both. Confirm no `verification/` prefix remains in a fresh public listing.

**Approval required:** yes (R2 copy/delete/purge). The delete is irreversible at origin once the preservation copy is verified; the CDN purge is separate.

---

## 4. Cloudflare HTTPS settings

The Worker middleware now returns 308 for HTTP when deployed. If a request still reaches the app over HTTP after deploy:

1. Cloudflare dashboard → SSL/TLS → Edge Certificates → **Always Use HTTPS: On** for the zone; or add a Redirect Rule `http://app.uxcommunity.in/*` → `https://app.uxcommunity.in/$1` (308).
2. Verify `curl -I http://app.uxcommunity.in/login` returns 308 and `https://` returns 200.
3. HSTS is already `max-age=31536000; includeSubDomains`. **Do not add `preload` yet**; validate all subdomains (including `rt`, `media`, marketing) over HTTPS first.
4. Do not change DNS unless the redirect cannot be applied at the edge.

**Approval required:** yes (Cloudflare setting).

---

## 5. Rotate credentials exposed by the local build artifact

The file `apps/web/.open-next/cloudflare/next-env.mjs` (gitignored, untracked, mtime 2026-10-24) contains plaintext production credentials. `.dev.vars.bak-20261030151132` also exists. No values are reproduced here.

- Delete both local files after confirming nothing else needs them.
- If either file was ever copied, synced or shared, rotate the following **without printing values**:
  - Supabase service-role key (Worker secret + local `.dev.vars`; update the Worker secret and redeploy).
  - `SESSION_SECRET` (invalidates all sessions; expected).
  - `ADMIN_PASSWORD` (admin epoch changes; old admin tokens invalid).
  - Resend, Upstash, GIPHY, R2 access key/secret, `REALTIME_PUBLISH_SECRET`, `API_SECRET`.
- Update the values in GitHub Actions secrets; the deploy workflow pushes web/realtime secrets. Keep the old values only until the smoke test passes, then revoke at the providers.
- The deployed client bundle scan found **no** secret markers; this is a local-artifact/secret-hygiene exposure, not a public JS leak.

**Approval required:** yes (secret rotation/redeploy).

---

## 6. Verification policy and existing accounts

- **Policy A is implemented in the remediation branch and locally verified. Production enforcement begins only after the relevant code is deployed.** It is not active in production today.
- `verification_settings.grace_days` remains 2 and is now **inert** for writes/banner. Optional clarity change (approval): `update public.verification_settings set grace_days = 0 where id is true;` — data change, no schema change.
- Existing accounts: production has **2 users; 1 has NULL `terms_accepted_at`/`age_confirmed_at`**. Do not back-fill or fabricate timestamps. Recommended safe approach:
  - Add a post-authentication `consent_required` gate that redirects only affected accounts to a consent page; record `terms_version`, `terms_accepted_at` and `age_confirmed_at` only when the member actively accepts. Keep logout, export and account deletion available while consent is pending; block new writes.
  - If the two accounts are test-only, delete them under the approved data plan instead.
  - No bulk update without a signed product/data decision.
- Production content is test-seeded (2 users, 42 communities, 68 messages, 1 event, 1 DM, 1 saved resume, 0 jobs/reports). Confirm which communities are official and remove test content under a written data plan.

**Approval required:** yes (product/data decision).

---

## 7. Items not implemented — product/infrastructure decisions

1. **Turnstile / CAPTCHA is not implemented.** Policy A blocks most writes, but open signup still permits account creation, likes, reports and account/verification actions. If required before launch, add Cloudflare Turnstile site/secret, server-side `siteverify` (fail closed; test hostname/action, single-use, expired/invalid/missing), web/mobile widgets, and staging tests. Do not enable enforcement until keys/rollout are approved.
2. **DM-origin suspend/ban has no signed appeal token.** The member is told to email `hello@uxcommunity.in`; the signed appeal system is report-scoped. Decide whether to auto-create a profile report for DM bans or accept the support-email path.
3. **Admin audit route-level verification is incomplete.** Admin event deletion and verification decisions are wired to `moderation_audit_log`, but only a static/action-contract test exists; no staging route E2E. Direct user suspend/lift UI and some non-moderation admin edits remain outside the audited set. Add before launch if the policy requires “every moderator decision.”
4. **CSP is report-only; cookie domain remains `.uxcommunity.in`.** CSRF checking is live in code; the session cookie must stay on the parent domain for the current realtime cookie handshake. A strict CSP/host-only cookie/realtime-token redesign is future hardening, tested in staging.
5. **Event comments/likes/chat after end, event lifecycle FCM/preferences/quiet hours, mobile event push routing, notification dedupe, mobile appeals screen and mobile legal links** remain deferred (documented in the remediation report).
6. **Backup/DR** remains out of scope and unaddressed. Do not apply production migrations until the separate backup task is complete or an approved one-off recoverable dump exists.
7. **Android production signing is not configured.** `android/app/build.gradle` uses `signingConfigs.debug` for release; `app.json` Android package is `in.uxcommunity.app`, versionCode 1/versionName 1.0.0, scheme `uxcommunity`; iOS bundle identifier is still `com.sachinpatil1228.myapp`. The manifest requests location, record-audio, overlay and storage/media permissions, sets `allowBackup=true`/`requestLegacyExternalStorage`, and declares only the custom scheme (no verified app links); `google-services.json` is present. A production upload keystore, release signing config/EAS credentials, permission cleanup, FCM/API/realtime env verification, deep-link review and a clean-device test are required. Do not generate or replace keys here.
8. **Verification privacy is fixed in the branch.** Owner/admin responses now return proxy paths only, the proxy re-signs 5-minute GETs, legacy rows are streamed, resubmission uses owned refs, and mobile thumbnails are memory-only. Residual work: legacy objects remain publicly readable at their original URLs until the approved R2 cleanup; upload previews expire after 30 minutes; live proxy authorization/expiry and device-cache behavior need a staging/device test.

---

## 8. Staging verification required before launch

**Current verdict: READY FOR STAGING.** The next gate is deploying this branch to a separate staging environment and running the matrix. Production approval must not be requested until these results are recorded.

Provision a **separate** Supabase project, R2 public/private buckets, Workers environment, Resend/FCM configuration and test recipients. Do not use production credentials or real users. Run the full matrix in `STAGING_TEST_RESULTS.md` / the audit §9, especially:

- signup/consent (web + Android), including crafted requests without consent;
- unverified chat/DM/comment/apply → 403; likes/reports/account actions → allowed;
- blocked/suspended account deletion via `/delete-account`;
- reports for every target type, private-community visibility, 25/24h cap;
- admin actions and audit rows; DM warn/suspend/ban; appeal grant/deny/email;
- session revocation, logout-all, password change/reset; realtime reconnect rejection;
- private R2 auth, signed-URL expiry, mobile cookie images;
- email/FCM delivery, quiet hours/preferences;
- Android release artifact with the actual signing configuration (currently only debug signing exists).

**Approval required:** yes (staging resources/cost, test recipients, device).

---

## 9. Post-change production smoke (non-destructive)

- `GET https://app.uxcommunity.in/login` → 200; `http://` → 308.
- Cross-origin POST → 403; same-origin invalid login → 422/401 (no credentials).
- Signup page consent links → all 200; no submission.
- `/delete-account` form loads; do not submit.
- Private proxies with random IDs → 401.
- Website `/terms`, `/privacy`, `/community-guidelines`, `/delete-account`, `/support` → 200 and updated copy.
- R2 orphan URLs → 404/403.
- No destructive tests against production users/reports.

---

## 10. Rollback summary

| Change | Rollback |
|---|---|
| HTTPS/CSRF middleware | Redeploy previous Worker; Cloudflare redirect rule can be removed. |
| Verification policy | Revert code; no DB change required (grace remains 2). |
| Consent RPC | Additive column/function; leave in place; revert web route if needed. |
| Deletion credential route | Remove route/page; no DB change. |
| Permission revokes | Re-grant only if a legitimate client path is discovered (not expected; service_role unaffected). |
| RPC/columns | Pre-change dump; forward fix preferred; old 6-column function snapshot retained. |
| Audit/evidence/appeals | Additive; keep data. |
| R2 orphan | Preservation copy in private bucket; deletion at origin is irreversible; CDN purge is not reversible, so verify the copy first. |
| Secret rotation | Keep old values in a password manager until smoke passes; then revoke. |
| Page copy | Revert the website commit and redeploy. |

**Everything above requires your explicit approval before execution.**
