# Staging Test Results

**Date:** 2026-10-31
**Branch:** `fix/production-readiness-remediation`
**Environment:** macOS 26.4, Node 24.18.0, npm, PostgreSQL 17.11 (Homebrew), local Next 16.4.3 dev server already running on port 3000, no Docker, no dedicated staging project, no Android device attached.
**Production:** inspected read-only; **no deployment, migration, R2 operation, secret change or production test was performed.**

## 1. Environment status

| Environment | Status |
|---|---|
| Local code/tests | Available and used. |
| Disposable local PostgreSQL 17 | Available and used (schema + 216 migrations). |
| Staging Supabase project | **Not confirmed/provisioned.** The only other project visible (`sachin1228's Project`, `wrlbykrjgoulfjqpqkoj`, Singapore) is not referenced by shipped config; not assumed to be staging. |
| Dedicated staging R2 buckets | **Not provisioned.** Production buckets were inspected read-only only; no staging writes. |
| Staging Worker/Realtime environment | **Not provisioned.** |
| Real Android device | **Not available.** |
| Resend/FCM test recipients | **Not available; no email or push was sent.** |
| Load-test environment | **Not available.** No 100/500/1,000-connection tests were run against production. |

## 2. Web

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` in `apps/web` | **PASS** (exit 0) |
| Full unit suite | `cd apps/web && FILES=$(find . \( -name node_modules -o -name .next -o -name .open-next \) -prune -o -name '*.test.ts' -print \| sort); npx tsx --tsconfig tsconfig.json --test $FILES` | **PASS — 1,080/1,080**, 0 failed, 0 skipped, 5.28 s (133 files) |
| Targeted security/deletion/schedule tests | request-origin, secure-compare, delete-credential, event-schedule, private-resume, verification policy | **PASS — 26/26** (request-origin, secure-compare, delete-credential, event-schedule, private-resume, verification policy) |
| Production build | Isolated full-workspace copy, no `.env.local`/`.dev.vars`; dummy public env | **PASS** (exit 0, compiled + type-checked + route manifest generated) |
| Production build in the live workspace | **Not run** | The running dev server owns `.next` and `.env.local` contains production credentials; building there would disrupt the server or create secret-bearing artifacts. |
| Middleware HTTP→HTTPS | Local dev server, `Host: app.uxcommunity.in`, `x-forwarded-proto: http` | **PASS — 308 Permanent Redirect to HTTPS** |
| Middleware CSRF (cross-origin) | `Origin: https://evil.example`, POST `/api/auth/login` | **PASS — 403 `Cross-origin request denied`** |
| Middleware CSRF (same-origin) | `Origin: https://app.uxcommunity.in`, POST `/api/auth/login` | **PASS — reached route validation (422)** |
| CSP report-only | local response headers | **PASS — header present** |
| HSTS/XFO/nosniff/referrer/permissions | local response headers | **PASS — present** |

Notes: the local redirect included `:3000` because the dev server's host carried the local port; production Host is `app.uxcommunity.in` without a port. The middleware uses the browser-facing host header.

## 3. Website

| Check | Result |
|---|---|
| `npm run build` in `uxcommunity-website` | **PASS** (exit 0; routes incl. `/terms`, `/privacy`, `/community-guidelines`, `/delete-account`, `/support`) |
| Legal copy changes | Terms Policy A, Guidelines community/job reporting, Privacy no-backup-service statement, Delete-account form + link, report-only CSP config |
| Live production `www`/apex legal pages | Last read-only audit: all 200; **not re-deployed** (changes are in the separate website repo) |
| 390px overflow audit | Last read-only audit: no horizontal overflow on `/`, `/terms`, `/privacy`, `/community-guidelines`, `/delete-account`, `/support`; **not re-run on the changed copy** |

## 4. Database

| Check | Result |
|---|---|
| Fresh local schema application | **216 migrations applied** (with expected Supabase-only harness errors for `auth`, `storage`, `companies`; documented harness limitation) |
| `supabase/tests/migration_integrity.test.sql` | **PASS — 9/9** |
| `supabase/tests/public_read_exposure.test.sql` | **PASS — 19 ok / 0 failed** (15 planned assertions; scoped seven-table denylist, default-ACL table/function probes, explicit public-read fixture, anon/authenticated denial) |
| `supabase/tests/private_r2_storage.test.sql` | **PASS — 11/11** (after restoring `has_column`/`col_is_null` harness helpers) |
| `supabase/tests/moderation_evidence_retention.test.sql` | **PASS — 82/82** |
| `supabase/tests/moderation_appeals_retention.test.sql` | **PASS — 5/5** (appeal survives account deletion, anonymized, `user_deleted_at` set) |
| `apps/web/lib/auth/rate-limit.test.ts` | **PASS — 3/3** (critical fail-closed in production; development fallback; non-critical availability fallback) |
| `supabase/tests/moderation_evidence_concurrency.test.sql` | **PASS — 8/8** (earlier run on the same chain; not rerun after the final additive migrations) |
| `supabase/tests/signup_consent_atomic.test.sql` | **PASS — 3/3** (false age consent refused; valid consent creates one account; timestamps/version persisted) |
| `npm run test:moderation` | **PASS — 75/75** |
| `npm run test:private-storage` | **PASS — 36/36** |
| `npm run test:signup` | **PASS — 7/7** |
| `npm run test:private-r2-migration` | **PASS — 6/6** |
| `supabase db push` / `db reset` | **NOT RUN** (forbidden against production; no staging). |
| Staging upgrade clone with representative data | **NOT RUN** — no staging project. |
| Production migration application | **NOT RUN** — approval required. |

Known local-harness limitations (not concealed): it is a bare PostgreSQL cluster, so `auth`/`storage` schemas and some fixtures are absent; the migration log contains expected Supabase-only errors. The 9 launch-critical assertions pass. A real Supabase staging project is still required for the complete chain and upgrade test.

## 5. Mobile

| Check | Result |
|---|---|
| TypeScript | **PASS** (exit 0) |
| `test:mobile-realtime` | **PASS — 71/71** |
| `test:mobile-cache` | **PASS — 7/7** |
| `test:mobile-signup` | **PASS — 12/12** |
| Android production/release artifact | **BLOCKED** — see §10 for the exact configuration gap. |
| Package/version/network/deep links on a device | **NOT TESTED.** |
| Mobile verification restriction copy | Updated banner text; API enforcement is server-side. |
| Mobile private verification disk cache, mobile appeals screen, mobile legal links | **NOT FIXED** (documented deferred items). |

## 6. Realtime

| Check | Result |
|---|---|
| Unauthenticated production WebSocket | Closes without opening (1006 handshake rejection); no data access. |
| Session validation endpoint | Code/live schema verified; requires `API_SECRET`, fails closed; no authenticated socket test. |
| Revocation on an open socket | **NOT TESTED** — no staging/test account/device. |
| 100/500/1,000 concurrent connection load tests | **NOT RUN** — no staging infrastructure; production intentionally untouched. |

## 7. Email and push

| Check | Result |
|---|---|
| Resend domain | Live read-only audit: `uxcommunity.in` **verified**. |
| Upstash | Live read-only: `PONG`, `dbsize=0`; fail-closed auth limits compile/tested by code inspection only. |
| GIPHY | Live read-only: API 200. |
| FCM Worker secret | Name present on `uxcommunity-web`; deploy gate exists. |
| Actual signup/reset/moderation/appeal emails | **NOT SENT** — no staging/test recipient; production was not used. |
| Actual FCM/Expo delivery, quiet hours, notification preferences | **NOT TESTED.** |
| Appeal decision email | Implemented/template build; **not sent** in this test run. |

## 8. Not run / blocked summary

- Staging E2E (signup, login, delete, reports, admin actions, appeals, private R2, signed URL expiry).
- Real Android device auth/session/deletion/push/private media.
- Real email/FCM delivery and notification preferences.
- Realtime revocation on an open socket and load tests.
- Production deployment, migration application, R2 deletion/purge, secret rotation.
- Backup/DR restore (out of scope).

## 9. Admin audit, appeal and security contract tests

| Check | Result |
|---|---|
| Admin audit coverage contract (static route/action map for users, DM, content, communities, jobs, events, verifications) | **PASS — 1/1** |
| Moderation contract + appeal rules + appeal tokens + rate-limit | **PASS — 25/25** combined; rate-limit separately **3/3** |
| Appeal retention after account deletion | **PASS — 5/5** |
| CSP config + cookie policy | **PASS — 3/3** (report-only directives; HttpOnly/SameSite/domain; localhost host-only) |
| Verification sample presentation (signed private URL, legacy URL fallback, owner keys separate) | **PASS — 3/3** |
| Admin event/verification route behavior end-to-end | **NOT TESTED** — contract/static test only; route integration remains blocked by no staging. |

### Exact commands used for the focused suites

```bash
npx tsx --tsconfig apps/web/tsconfig.json --test   apps/web/lib/auth/rate-limit.test.ts   apps/web/lib/moderation/admin-audit-coverage.test.ts   apps/web/lib/moderation/moderation-contract.test.ts   apps/web/lib/moderation/appeals.test.ts   apps/web/lib/moderation/appeal-token.test.ts   apps/web/lib/security/csp-cookie.test.ts   apps/web/lib/verification/samples.test.ts
bash supabase/tests/run-local.sh   supabase/tests/migration_integrity.test.sql   supabase/tests/public_read_exposure.test.sql   supabase/tests/private_r2_storage.test.sql   supabase/tests/signup_consent_atomic.test.sql   supabase/tests/moderation_appeals_retention.test.sql   supabase/tests/moderation_evidence_retention.test.sql
```

## 10. Android release readiness (code/config inspection only)

| Item | Current state | Required action |
|---|---|---|
| Application ID | `in.uxcommunity.app` | Confirm final Play package; do not change after upload without a migration plan. |
| Version code / name | local Gradle `versionCode 1` / `versionName 1.0.0`; EAS production `autoIncrement: true` | Use EAS remote versioning or set an explicit incremented release value; verify the generated artifact. |
| Release signing | `signingConfigs.debug` is used for **release**; only `debug.keystore`/`androiddebugkey` exists | Generate/use an upload keystore (or EAS-managed credentials) and configure `signingConfigs.release`; never commit keys. No key was generated. |
| iOS identifier | `com.sachinpatil1228.myapp` (placeholder) | Change before any iOS/App Store build; not part of Android-only launch. |
| API endpoint | EAS sets `EXPO_PUBLIC_API_URL=https://app.uxcommunity.in` | Verify the release environment also has `EXPO_PUBLIC_REALTIME_URL=wss://rt.uxcommunity.in`; inspect `.env`/EAS secrets (not printed). |
| FCM | `android/app/google-services.json` exists (670 bytes); `app.json` points at `./google-services.json` | Confirm the root/prebuild resource path, Firebase project, and Android app ID; validate push on a device. |
| Deep links | scheme `uxcommunity`; manifest https intent present | Verify host/path filters and test email/app links; iOS associated domains not configured. |
| Permissions | Manifest requests location (coarse/fine), record audio, system alert window, storage/media permissions | Remove unused location/audio/overlay permissions if not required, or document why; retest media/notification flows. |
| R8/ProGuard | `minifyEnabled` uses the root Gradle property; `shrinkResources` defaults false | Build with the intended release flags and test; document reproducibility. |
| Build/signing verification | **NOT RUN** — no production signing credentials; no device. | Build a signed release on a clean machine/device once credentials are available; do not upload. |

## 11. Permission model / migration evidence

- Live read-only ACL inspection confirmed the seven sensitive tables still carry client grants today; `member_resumes` is authenticated-only with own-row policies, the other six have no policies, and all seven have RLS enabled. No other public table currently grants anon/authenticated SELECT.
- The remediation test is scoped to those seven (not a blanket public-table zero), creates an explicit anon public-read fixture to prove intentional public reads can still be granted, and probes the default ACL. Local result: **19 ok / 0 failed**.
- PostgreSQL gives every new function a built-in `PUBLIC EXECUTE`; `ALTER DEFAULT PRIVILEGES` cannot remove it. The migration removes project-level client function defaults and grants service_role, but future sensitive functions still need explicit revokes. The test checks a representative sensitive RPC; this is documented as a convention/limitation, not a global guarantee.
- Three remote-only migration versions were fetched read-only into a temp dir and mapped to local equivalents; no production ledger write or migration execution occurred. See `MIGRATION_RECONCILIATION.md`.

## 12. CSP, CSRF, cookies and rate limits

- **CSRF:** local middleware returned 403 for a cross-origin POST and let a same-origin POST reach route validation. Native/server requests without Origin remain allowed.
- **CSP:** report-only in app and website; not enforced. Enforcing it requires a tested nonce/hash strategy for Next's inline bootstrap and third-party media; report-only is the safe current state. See §13 for cookie coupling.
- **Cookies:** HttpOnly, Secure in production, SameSite=Lax, 7 days, domain `.uxcommunity.in`. The parent domain is currently required for the web realtime WebSocket handshake to `rt.uxcommunity.in`; narrowing it would break that handshake unless a short-lived realtime token is introduced. No cookie change was made; no narrowing claim is made.
- **Rate limits:** authentication, signup, password reset/change, account deletion, reports, appeals, verification, chat/DM writes, content creation and company verification now pass `{ failClosed: true }`. Reads, typing, safety block actions and company search remain availability-oriented/fail-open; the global middleware limiter remains fail-open by design. Regression test 3/3 passes. This is a risk classification, not a blanket fail-closed policy.

## 13. Verification evidence privacy

- Owner verification GET returns raw `work_sample_keys` (needed by the resubmit form) plus 15-minute signed URLs or legacy public URLs; admin verification GET strips keys and returns signed URLs. Owner keys alone do not authorize object reads; the private bucket and signed URL are the capabilities.
- New submissions reject public `work_sample_urls`; legacy rows can still return their old public URLs until cleanup/migration, which was not performed.
- Signed verification URLs expire after 15 minutes; the UI does not auto-refresh them, so an open page may show broken thumbnails after expiry. Legacy public evidence remains publicly readable by URL; this is a known migration/cleanup gap.
- Mobile verification images bypass the private-media memory-only loader and use a plain image component with default disk caching (deferred finding).

## 14. Staging setup checklist (not provisioned; no cost/resources created)

1. Create a separate Supabase project; do not reuse `ux-community` or assume the Singapore project is staging.
2. Create separate public/private R2 buckets and an R2 token scoped to them; no production bucket access. Configure a staging media host or r2.dev for the public bucket; keep the private bucket without a public domain.
3. Create staging web and realtime Workers (or a staging environment/config) with separate `SESSION_SECRET`, `API_SECRET`, `REALTIME_PUBLISH_SECRET`, Supabase service key, Upstash namespace, Resend test key/domain, FCM project, and Giphy key as appropriate.
4. Configure a Resend test recipient/domain and an FCM test device/project; never use production user emails or tokens.
5. Set mobile `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_REALTIME_URL` to staging; build a staging/dev client; do not point a release build at production for destructive tests.
6. Load only synthetic fixtures; no real user PII; clean up disposable accounts/content.
7. Run the 15-item staging matrix in `REMAINING_BLOCKERS.md`/the approval checklist; record results in this file.

## 15. Verification status against the live production snapshot

The code changes are **local-tested**, not production-deployed. At the audit snapshot production still showed:

- `http://app.uxcommunity.in/login` served over HTTP (the new middleware is not deployed);
- one public `verification/` orphan (not deleted);
- seven sensitive tables with client grants (REVOKE migration not applied);
- `get_resource_list_aggregates` with 6 columns (forward migration not applied);
- no verified backup/PITR and R2 versioning disabled.

These are intentionally left for the approval checklist; they are **not** claims of live remediation.
