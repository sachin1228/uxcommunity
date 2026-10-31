# Staging Test Results

**Date:** 2026-10-31
**Branch:** `fix/production-readiness-remediation`
**Environment:** macOS 26.4, Node 24.18.0, npm, PostgreSQL 17.11 (Homebrew), local Next 16.4.3 dev server already running on port 3000, no Docker, no dedicated staging project, no Android device attached.
**Production:** inspected read-only; **no deployment, migration, R2 operation, secret change or production test was performed.**

## Verdict

# READY FOR STAGING

The branch passes the final local regression gates (web, realtime, database, mobile, production builds). It is ready to deploy to a **separate staging environment** and run this matrix. It is **not READY FOR PRODUCTION APPROVAL**: no staging, platform-load, email/FCM delivery or Android device test has run, and backup/DR, production migrations/deploy, signing and the approvals in `REMAINING_BLOCKERS.md` remain outstanding.

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
| Full unit suite | `cd apps/web && FILES=(${(f)"$(find . \( -name node_modules -o -name .next -o -name .open-next \) -prune -o -name '*.test.ts' -print \| sort)"}); npx tsx --tsconfig tsconfig.json --test "${FILES[@]}"` (zsh array split) | **PASS — 1,087/1,087**, 0 failed, 0 skipped, 5.30 s (134 files), exit 0 |
| Targeted security/deletion/schedule tests | request-origin, secure-compare, delete-credential, event-schedule, private-resume, verification policy | **PASS — 26/26** (request-origin, secure-compare, delete-credential, event-schedule, private-resume, verification policy) |
| Production build | Isolated full-workspace copy with cloned dependencies, no `.env.local`/`.dev.vars`; dummy public env | **PASS** (exit 0, compiled + type-checked + route manifest generated) |
| Production build in the live workspace | **Not run** | The running dev server owns `.next` and `.env.local` contains production credentials; building there would disrupt the server or create secret-bearing artifacts. |
| Lint on touched files | `npx eslint` on the changed routes/components/lib files | **PASS — 0 errors, 1 warning** (existing `@next/next/no-img-element` in `VerificationForm.tsx`) |
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
| `supabase/tests/migration_integrity.test.sql` | **PASS — 10/10** |
| `supabase/tests/public_read_exposure.test.sql` | **PASS — 19 ok / 0 failed** (15 planned assertions; scoped seven-table denylist, default-ACL table/function probes, explicit public-read fixture, anon/authenticated denial) |
| `supabase/tests/private_r2_storage.test.sql` | **PASS — 11/11** (after restoring `has_column`/`col_is_null` harness helpers) |
| `supabase/tests/moderation_evidence_retention.test.sql` | **PASS — 82/82** |
| `supabase/tests/moderation_appeals_retention.test.sql` | **PASS — 5/5** (appeal survives account deletion, anonymized, `user_deleted_at` set) |
| `apps/web/lib/auth/rate-limit.test.ts` | **PASS — 3/3** (critical fail-closed in production; development fallback; non-critical availability fallback) |
| `supabase/tests/moderation_evidence_concurrency.test.sql` | **PASS — 8/8** (rerun in the final combined run) |
| `supabase/tests/signup_consent_atomic.test.sql` | **PASS — 3/3** (false age consent refused; valid consent creates one account; timestamps/version persisted) |
| Combined final DB run | **PASS — 138/138 assertions, 0 failed**, exit 0, across the seven suites above |
| `npm run test:moderation` | **PASS — 75/75** |
| `npm run test:private-storage` | **PASS — 36/36** |
| `npm run test:signup` | **PASS — 7/7** |
| `npm run test:private-r2-migration` | **PASS — 6/6** |
| `supabase db push` / `db reset` | **NOT RUN** (forbidden against production; no staging). |
| Staging upgrade clone with representative data | **NOT RUN** — no staging project. |
| Production migration application | **NOT RUN** — approval required. |

Known local-harness limitations (not concealed): it is a bare PostgreSQL cluster, so `auth`/`storage` schemas and some fixtures are absent; the migration log contains expected Supabase-only errors. The 10 launch-critical assertions pass. A real Supabase staging project is still required for the complete chain and upgrade test.

## 5. Mobile

| Check | Result |
|---|---|
| TypeScript | **PASS** (exit 0) |
| `test:mobile-realtime` | **PASS — 71/71** |
| `test:mobile-cache` | **PASS — 7/7** |
| `test:mobile-signup` | **PASS — 12/12** |
| Full mobile sweep (`find … '*.test.ts'`) | **441/444**; the three failing files (`communitiesSnapshot`, `communityBootstrap`, `dmConversationsCache`) fail at load because they import React Native Flow source under `tsx`, a pre-existing harness limitation, not a changed-code failure. |
| Android production/release artifact | **BLOCKED** — see §10 for the exact configuration gap. |
| Package/version/network/deep links on a device | **NOT TESTED.** |
| Mobile verification restriction copy | Updated banner text; API enforcement is server-side. |
| Mobile verification thumbnails | `expo-image` with the session cookie and **memory-only** cache; sign-out clears the memory cache. Device behavior still needs a test. |
| Mobile appeals screen, mobile legal links | **NOT FIXED** (documented deferred items). |

## 6. Realtime

| Check | Result |
|---|---|
| Worker TypeScript | **PASS** — `npx tsc --noEmit` in `apps/realtime`, exit 0. |
| 100 clients | **PASS — 100/100**, 0 duplicates, p50 15.2 ms, p95 19.2 ms, p99 19.3 ms. |
| 500 clients | **PASS — 500/500**, 0 duplicates, p50 17.3 ms, p95 22.5 ms, p99 23.0 ms. |
| 1,000 clients | **PASS — 1,000/1,000**, 0 duplicates, p50 42.9 ms, p95 60.4 ms, p99 61.6 ms. |
| 500×100 fan-out | **PASS — 50,000/50,000**, 0 duplicates; isolated run 68.3 s; also passed inside the full suite. |
| Full ownership suite | **PASS — 21/21**, 193.7 s. |
| Previously failing multi-file run | **PASS — 39/39** after test isolation; the earlier run was **38/39** with the 1,000-client `Timeout waiting for hello`. |
| **Full Worker suite (clean run)** | **PASS — 28 files / 281 tests, 0 failed, 1,703.33 s, exit 0.** Includes 1,000 clients (85.1 s), 500×100 fan-out and the ownership suite. |
| **Final review reruns (same realtime source)** | A later full run under system memory pressure was **280/281** (one WS-open timeout); a subsequent clean full run was **278/281** with timeouts in `PERF 3: 100 × 500 burst`, `PERF 5: 10K index`, and `PERF 6: 100K index`. The exact 10K case alone **PASSED** in 41.2 s (P50 23.0 ms, P99 27.8 ms), and 27/28 files passed. Classified as a performance-test resource/environment flake, not a realtime code regression; a clean CI/staging run is still required. |
| Unauthenticated production WebSocket | Closes without opening (1006 handshake rejection); no data access. |
| Revocation on an open socket | **NOT TESTED** — no staging/test account/device. |
| Authenticated staging socket test | **NOT TESTED** — no staging environment. |

**Root cause classification:** the application fan-out path is healthy at 100/500/1,000 and 500×100 with zero duplicates, and a clean full Worker run passed 281/281. The earlier 1,000-client failure was reproduced only when it ran after other Miniflare suites in the same Vitest process; the shared process retained workers/DOs/sockets across files. The test harness now uses Vitest **forks** with `isolate: true` and `fileParallelism: false`, and the previously failing multi-file set is 39/39. Later full reruns under system memory pressure had one and then three WS-open/hello timeouts in the 10K/100K performance cases; the exact failing 10K case passed alone. This is a test-run resource/environment flake, not a change to DO ownership or fan-out architecture. A clean CI/staging/load run remains required for platform-level capacity confirmation.

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
- Platform-level realtime load and revocation on an open socket; the clean local full Worker run passes (281/281, including 1,000 clients), but a rerun under system memory pressure timed out heavy performance cases and the exact 10K case passes alone. Staging capacity is not proven.
- Production deployment, migration application, R2 deletion/purge, secret rotation.
- Backup/DR restore (out of scope).

## 9. Admin audit, appeal and security contract tests

| Check | Result |
|---|---|
| Admin audit coverage contract (static route/action map for users, DM, content, communities, jobs, events, verifications) | **PASS — 1/1** |
| Moderation contract + appeal rules + appeal tokens + rate-limit | **PASS — 25/25** combined; rate-limit separately **3/3** |
| Appeal retention after account deletion | **PASS — 5/5** |
| CSP config + cookie policy | **PASS — 3/3** (report-only directives; HttpOnly/SameSite/domain; localhost host-only) |
| Verification sample proxy paths (no keys/URLs, parser) | **PASS — 4/4** |
| Verification private access (owner/other/admin) | **PASS — 4/4** |
| Session-route audit requires the proxy to use `getSession()` + `canViewVerificationSample` | **PASS — 6/6** |
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
| Deep links | scheme `uxcommunity`; the manifest declares only the custom-scheme intent (no verified https app links); iOS associated domains not configured | Add/verify host-based app links if email/web links must open the app; test on a device. |
| Permissions | Manifest requests location (coarse/fine), record audio, system alert window, storage/media permissions | Remove unused location/audio/overlay permissions if not required, or document why; retest media/notification flows. |
| Backup / legacy storage | `allowBackup="true"`; `requestLegacyExternalStorage="true"` | Decide whether app data may be backed up; remove the legacy-storage flag if no longer needed for the target Android range, then retest. |
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

The verification evidence API was redesigned:

- `GET /api/verification` returns **proxy paths** (`/api/private/verification/<requestId>/<index>`) only. It no longer returns `work_sample_keys` or legacy public URLs.
- `GET /api/admin/verifications` returns the same proxy paths; admin responses no longer return keys or raw legacy URLs.
- The new `/api/private/verification/[id]/[index]` route requires a live registry-backed session and calls `canViewVerificationSample` (owner or admin). Unauthorized callers get 404; anonymous callers get 401.
- Key-backed samples redirect to a **5-minute** signed GET; every image request re-signs, so an expired URL refreshes on the next load. Legacy URL-backed rows are fetched server-side and streamed with `Cache-Control: no-store`, so the public URL is not returned in the API response.
- The owner form displays existing samples but submits only new upload keys plus `work_sample_refs` for existing key-backed samples. The server resolves refs to keys after verifying ownership; legacy URL-only refs must be re-uploaded through the private form.
- Mobile verification thumbnails now use `expo-image` with the session cookie and **memory-only** cache policy (including the short-lived signed upload preview); logout clears the expo-image memory cache. No disk copy is intentionally created.
- Upload responses still return the newly uploaded key (needed for the immediate submit) plus a 30-minute preview URL; the key is not returned by GET and does not authorize reads.

Tests: `samples.test.ts` (4/4) proves proxy paths never contain keys/URLs and parse correctly; `private-access.test.ts` (4/4) covers owner/other/admin; session-route audit (6/6) requires the verification proxy to use `getSession()` and `canViewVerificationSample`. A live proxy/authorization/expiry test still requires staging (no database/Next integration environment here).

Remaining limits: legacy objects are still publicly readable **at their original URLs** until the separate R2 cleanup/migration decision; this change stops the API from republishing those URLs but cannot revoke the origin. Upload preview URLs expire after 30 minutes and do not auto-refresh before submit; the submitted evidence uses the proxy path. Mobile device cache behavior and account-deletion/authorization changes still need a real-device test.

## 14. Staging setup checklist (not provisioned; no cost/resources created)

1. Create a separate Supabase project; do not reuse `ux-community` or assume the Singapore project is staging.
2. Create separate public/private R2 buckets and an R2 token scoped to them; no production bucket access. Configure a staging media host or r2.dev for the public bucket; keep the private bucket without a public domain.
3. Create staging web and realtime Workers (or a staging environment/config) with separate `SESSION_SECRET`, `API_SECRET`, `REALTIME_PUBLISH_SECRET`, Supabase service key, Upstash namespace, Resend test key/domain, FCM project, and Giphy key as appropriate.
4. Configure a Resend test recipient/domain and an FCM test device/project; never use production user emails or tokens.
5. Set mobile `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_REALTIME_URL` to staging; build a staging/dev client; do not point a release build at production for destructive tests.
6. Load only synthetic fixtures; no real user PII; clean up disposable accounts/content.
7. Run the 20-item staging matrix below; record results in this file.

### Required staging configuration (proposal; nothing provisioned)

| Component | Required staging value/integration |
|---|---|
| Supabase | Separate project; `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, DB connection for migrations; synthetic data only. |
| Cloudflare web Worker | Staging web Worker + OpenNext assets; `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_REALTIME_URL` pointing at staging; Worker secrets below. |
| Realtime Worker | Staging Worker + `COMMUNITY_DO`, `USER_DO`, `ALERT_MONITOR` migrations; `SESSION_SECRET`, `REALTIME_PUBLISH_SECRET`, `API_URL`, `API_SECRET`. |
| R2 | Separate public/private buckets, scoped token, staging public host (custom domain or r2.dev); private bucket with no public domain. |
| Worker secrets | `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `REALTIME_URL`, `REALTIME_PUBLISH_SECRET`, `API_SECRET`, `UPSTASH_REDIS_REST_URL/TOKEN`, `RESEND_API_KEY`, `EMAIL_FROM`, `GIPHY_API_KEY`, `R2_*` (5 values), `ADMIN_EMAIL/PASSWORD`, `FCM_SERVICE_ACCOUNT`, `MODERATION_IMAGE_SERVICE_URL` only if used. |
| Upstash | Separate staging database/namespace; verify fail-closed behavior with the staging keys. |
| Resend | Test domain/key and controlled recipient; no production addresses. |
| FCM/EAS | Separate Firebase app/project + `google-services.json`; EAS staging profile; controlled device. |
| Mobile | `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_REALTIME_URL` pointed at staging; staging/dev client; do not reuse the production-signed release. |
| Website | Staging deployment or local website build; its `/api/auth/me` only; legal links can point at production legal pages or staging copies. |

**Minimum estimated cost (not measured):** Supabase Free `$0` for staging (no PITR/backups), Cloudflare Workers free/paid `$0–$5`, R2 free tier likely `$0` for synthetic data, Upstash/Resend/FCM/EAS free tiers `$0` within quotas. A production-grade staging DB with PITR would cost more. No paid resource was created.

### 20-item staging test matrix

1. Signup + atomic consent (web/Android). 2. Policy A server-side write restrictions. 3. Unverified-user restricted writes. 4. Blocked/suspended account deletion. 5. Moderation reports (all target types). 6. Admin actions + audit rows. 7. Session revocation (individual/global). 8. Realtime authentication. 9. Open WebSocket revocation. 10. Private R2 access. 11. Signed URL expiry/refresh. 12. Email delivery. 13. Push notifications. 14. Community creation/joining. 15. Community chat. 16. Direct messages. 17. Posts/comments. 18. Job applications/resume uploads. 19. Event creation/cancellation. 20. Android clean-device testing.

## 15. Verification status against the live production snapshot

The code changes are **local-tested**, not production-deployed. At the audit snapshot production still showed:

- `http://app.uxcommunity.in/login` served over HTTP (the new middleware is not deployed);
- one public `verification/` orphan (not deleted);
- seven sensitive tables with client grants (REVOKE migration not applied);
- `get_resource_list_aggregates` with 6 columns (forward migration not applied);
- no verified backup/PITR and R2 versioning disabled.

These are intentionally left for the approval checklist; they are **not** claims of live remediation.
