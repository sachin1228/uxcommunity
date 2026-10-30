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
| Full unit suite | `npx tsx --tsconfig tsconfig.json --test <129 test files>` | **PASS — 1,070/1,070**, 0 failed, 0 skipped, 4.99 s |
| Targeted security/deletion/schedule tests | request-origin, secure-compare, delete-credential, event-schedule, private-resume, verification policy | **PASS — 13/13 + 32/32 earlier runs** |
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
| `supabase/tests/public_read_exposure.test.sql` | **PASS — 11/11** (including future-table default-ACL probe) |
| `supabase/tests/private_r2_storage.test.sql` | **PASS — 11/11** (after restoring `has_column`/`col_is_null` harness helpers) |
| `supabase/tests/moderation_evidence_retention.test.sql` | **PASS — 82/82** |
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
| Android production/release artifact | **BLOCKED** — `android/app/build.gradle` has only `signingConfigs.debug` (`debug.keystore`, `androiddebugkey`); no production signing configuration is present. No APK was built or uploaded. |
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

## 9. Verification status against the live production snapshot

The code changes are **local-tested**, not production-deployed. At the audit snapshot production still showed:

- `http://app.uxcommunity.in/login` served over HTTP (the new middleware is not deployed);
- one public `verification/` orphan (not deleted);
- seven sensitive tables with client grants (REVOKE migration not applied);
- `get_resource_list_aggregates` with 6 columns (forward migration not applied);
- no verified backup/PITR and R2 versioning disabled.

These are intentionally left for the approval checklist; they are **not** claims of live remediation.
