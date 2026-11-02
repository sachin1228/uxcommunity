# Environment variable and configuration inventory

This document preserves the Phase 1 source snapshot. See the current
[implementation and verification status](environment-isolation-implementation.md)
for changes made after the audit.

Companion to the [Phase 1 audit](environment-isolation-audit.md), captured on
1 November 2026 from revision `48215d4f`. **Names and source locations only; no
secret values.** This inventory is not an environment template or permission to
reuse a credential across environments.

## Configuration surfaces inspected

| Surface | Configuration source / behavior |
| --- | --- |
| Web Next development / builds | `apps/web/.env.local`; `.env.production.local` also exists. Next picks environment files according to build mode; inherited shell variables can override file values. No safe development launcher or complete tracked example exists. |
| Web Cloudflare local runtime | `apps/web/.dev.vars`; secret-bearing `.dev.vars.bak-20261030151132` also exists. `.dev.vars*` and `.env*` are ignored. Wrangler vars and build-time public vars must match the selected environment. |
| Realtime local runtime | `apps/realtime/.dev.vars`, with the same local web session/API/publish values and localhost API URL. No staging-specific ignored variable file was found. |
| Supabase | `supabase/config.toml`, CLI/service pins, baseline, initializer and schema artifacts; ignored `.temp/project-ref` still links production. No production link was changed. |
| Deployments | `.github/workflows/{ci,database,deploy,preview}.yml`, root/web/realtime package scripts, web/realtime Wrangler configs and OpenNext config. Production and preview reference the same repository secret names. |
| Mobile | `expo-app-standalone 3/.env`, `eas.json`, `app.json`, checked-in Firebase client configuration and Android copy. Firebase client JSON is not a server service-account private key; separate test project/app identity is still required. |
| Standalone tools | Some explicitly load web `.dev.vars` / `.env.local`; others read inherited variables only. Seed/import/cleanup/maintenance scripts need the same target guard as the application. |
| Vercel | No tracked Vercel deployment config, declared platform dependency, CLI deploy step, platform variable consumer or linked local project found. Account-side integration/secret scope not verified. |

## Service variables and secret classification

Public URLs and identifiers may be published; the corresponding credentials must
be generated separately and scoped separately for each environment. Only public
configuration may use `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` prefixes.

| Group | Names | Isolation requirement |
| --- | --- | --- |
| Environment identity | No common application data-environment selector found | Add explicit identity and a matching public build marker; `NODE_ENV` is an optimization mode. |
| Web/browser | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_REALTIME_URL` | Match web/API, DB and realtime environment; never inline a private key. |
| Supabase application | `SUPABASE_SERVICE_ROLE_KEY`; script alias `SUPABASE_URL` | Privileged server key, bypasses RLS; dedicated project/localhost target. |
| Supabase management | `SUPABASE_ACCESS_TOKEN` | Metadata capture tool only; do not make management credentials part of app or preview configuration. |
| PostgreSQL tool inheritance | `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPASSFILE`, `PGSERVICE`, `PGSERVICEFILE`, `PGOPTIONS` | libpq/psql can consume these without explicit source reads. Imports and benchmarks that inherit the shell need target verification; the fresh DB harness deliberately removes inherited `PG*` settings. Password/passfile contents are secrets. |
| Sessions / internal API | `SESSION_SECRET`, `API_URL`, `API_SECRET`, `REALTIME_URL`, `REALTIME_PUBLISH_SECRET` | New random secrets per environment; internal endpoint URLs must also be validated. |
| Admin | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Dedicated synthetic nonproduction admin; password is secret, email is an identifier. |
| R2 media | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `R2_PRIVATE_BUCKET_NAME` | Access/secret keys are private; public/private media and cache buckets all need isolation. S3 account endpoint is constructed in code. |
| Cloudflare control plane | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Deployment token must not authorize production from nonproduction CI. No local data runtime need for a deployment token. |
| Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Dedicated local/staging service and credentials; namespace keys as defense in depth. |
| Email | `RESEND_API_KEY`, `EMAIL_FROM`, `SIGNUP_EXPIRY_DAYS` | Secret key; separate sender/capture transport and restricted recipients. Production deploy also writes `INVITATION_EXPIRY_DAYS`; no runtime consumer found for that name. Reconcile this mismatch without changing production policy implicitly. |
| Company verification | `COMPANY_VERIFICATION_PEPPER` | Secret, falls back to session key then a static literal; use an independent nonproduction value. |
| FCM | `FCM_SERVICE_ACCOUNT` | Server service-account JSON includes private key; dedicated staging project only for approved delivery tests. |
| Expo | Fixed send/receipt endpoints in `lib/push/{expo,receipts}.ts` | Sending is possible without an FCM secret or an Expo access-token setting. Add transport-level denial/capture rather than relying on missing credentials. |
| Push tuning | `PUSH_BATCH_SIZE`, `PUSH_MAX_CONCURRENCY`, `PUSH_RATE_LIMIT`, `PUSH_MAX_RETRIES`, `PUSH_RETRY_BASE_MS`, `PUSH_RETRY_MAX_MS`, `PUSH_REQUEST_TIMEOUT_MS`, `PUSH_MAX_DELIVERIES`, `PUSH_TIME_BUDGET_MS`, `PUSH_RECEIPT_CHECK`, `PUSH_RECEIPT_GRACE_MS` | Delivery/receipt controls, **not** environment isolation switches. |
| Third-party media | `GIPHY_API_KEY` | Separate restricted nonproduction key or fixture response; API calls currently use the configured key. |
| Mobile endpoints | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_REALTIME_URL` | Both are public, compiled build configuration; validate them together with mobile build identity. |

## Bindings and schedules (not dotenv secrets)

| Name/configuration | Consumer / target |
| --- | --- |
| `ASSETS` | OpenNext static assets generated under `.open-next/assets`. |
| `IMAGES` | Cloudflare image optimization binding. |
| `WORKER_SELF_REFERENCE` | Web service binding currently targets production `uxcommunity-web`, including when only preview Worker name is overridden. |
| `NEXT_INC_CACHE_R2_BUCKET` | OpenNext R2 incremental cache, currently `uxcommunity-web-next-cache`. |
| `COMMUNITY_DO` → `Room` | Realtime community-scoped DO; both production and staging configs declare a class binding. Verify actual namespace/Worker ownership. |
| `USER_DO` → `UserDO` | Realtime user-scoped DO; same namespace verification requirement. |
| `ALERT_MONITOR` → `AlertMonitor` | Production config only, migration v4; staging config is behind. |
| Cron `*/5 * * * *` | Dependency health/alert monitor → web internal API, potentially email. |
| Cron `0 */6 * * *` | Community message retention → web internal API → DB and R2 deletion. |
| Cron `* * * * *` | Event lifecycle notifications plus verification-reapply email → web internal API. |
| Staging triggers | None declared; live trigger list and manual route isolation unverified. |
| D1 / KV / queues | No current application bindings found. D1 is future work; Redis is the present remote rate-limit dependency. |

## Named reads and workflow references

The table below enumerates direct named environment reads, GitHub secret
references and literal push-helper keys found in tracked source/configuration,
including test and operational knobs. It excludes documentation-only examples,
generated schema types, lock files, vendored assets and Firebase client JSON.
`env[key]`, inherited shell/libpq settings and provider dashboard values require
manual review; this is a source inventory, not proof of live credential scopes.
A representative non-test source is preferred; test-only variables are marked.

| Name | Representative source | References |
| --- | --- | ---: |
| `ADMIN_EMAIL` | [.github/workflows/deploy.yml:88](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L88) | 6 |
| `ADMIN_PASSWORD` | [.github/workflows/deploy.yml:89](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L89) | 6 |
| `ALLOW_NON_STAGING` | [k6/loadtest-5k.mjs:1330](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L1330) | 2 |
| `API_BASE_URL` | [k6/loadtest-5k.mjs:138](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L138) | 1 |
| `API_SECRET` | [.github/workflows/deploy.yml:76](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L76) | 29 |
| `API_URL` | [.github/workflows/deploy.yml:75](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L75) | 14 |
| `BASE_URL` | [k6/config.js:16](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/config.js#L16) | 1 |
| `CLOUDFLARE_ACCOUNT_ID` | [.github/workflows/deploy.yml:32](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L32) | 5 |
| `CLOUDFLARE_API_TOKEN` | [.github/workflows/deploy.yml:31](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L31) | 5 |
| `COMPANY_IMPORT_DEBUG` | [scripts/import-company-directory.mjs:877](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/scripts/import-company-directory.mjs#L877) | 1 |
| `COMPANY_VERIFICATION_PEPPER` | [apps/web/lib/companies/codes.ts:21](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/companies/codes.ts#L21) | 5 |
| `CONCURRENT_VUS` | [k6/scenarios/chat_concurrent.js:38](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/scenarios/chat_concurrent.js#L38) | 1 |
| `CONNECT_TIMEOUT_MS` | [k6/loadtest-5k.mjs:109](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L109) | 1 |
| `CONTROL_COMMUNITY_ID` | [k6/loadtest-5k.mjs:98](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L98) | 1 |
| `CONTROL_GROUP_SIZE` | [k6/loadtest-5k.mjs:104](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L104) | 1 |
| `DELIVERY_TIMEOUT_MS` | [k6/loadtest-5k.mjs:130](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L130) | 1 |
| `E2E_APP_URL` | [apps/web/e2e/event-host-going.test.mjs:191](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/event-host-going.test.mjs#L191) (test only) | 2 |
| `E2E_EMAIL` | [apps/web/e2e/realtime-sockets.test.mjs:230](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L230) (test only) | 1 |
| `E2E_KEEP_SEED` | [apps/web/e2e/realtime-sockets.test.mjs:214](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L214) (test only) | 1 |
| `E2E_MOCK_COMMUNITIES` | [apps/web/e2e/realtime-sockets.test.mjs:200](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L200) (test only) | 1 |
| `E2E_PASSWORD` | [apps/web/e2e/realtime-sockets.test.mjs:231](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L231) (test only) | 1 |
| `E2E_PATH` | [apps/web/e2e/realtime-sockets.test.mjs:184](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L184) (test only) | 1 |
| `E2E_REALTIME_URL` | [apps/web/e2e/realtime-sockets.test.mjs:185](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L185) (test only) | 1 |
| `E2E_REQUIRE_COMMUNITY_SOCKETS` | [apps/web/e2e/realtime-sockets.test.mjs:191](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L191) (test only) | 1 |
| `E2E_SEED_ALLOW_REMOTE` | [apps/web/e2e/seed-member.mjs:135](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/seed-member.mjs#L135) | 1 |
| `E2E_SEED_COMMUNITIES` | [apps/web/e2e/realtime-sockets.test.mjs:211](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L211) (test only) | 1 |
| `E2E_SEED_MEMBER` | [apps/web/e2e/realtime-sockets.test.mjs:208](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L208) (test only) | 1 |
| `E2E_SESSION_COOKIE` | [apps/web/e2e/realtime-sockets.test.mjs:279](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L279) (test only) | 2 |
| `E2E_SETTLE_MS` | [apps/web/e2e/realtime-sockets.test.mjs:188](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L188) (test only) | 1 |
| `E2E_STRICT` | [apps/web/e2e/realtime-sockets.test.mjs:182](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L182) (test only) | 1 |
| `E2E_TIMEOUT_MS` | [apps/web/e2e/realtime-sockets.test.mjs:189](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L189) (test only) | 1 |
| `E2E_USER_ID` | [apps/web/e2e/realtime-sockets.test.mjs:288](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/realtime-sockets.test.mjs#L288) (test only) | 1 |
| `EMAIL_FROM` | [.github/workflows/deploy.yml:80](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L80) | 4 |
| `EVENT_COUNT` | [k6/loadtest-5k.mjs:127](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L127) | 1 |
| `EXPO_PUBLIC_API_URL` | [expo-app-standalone 3/lib/api.ts:23](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/expo-app-standalone%203/lib/api.ts#L23) | 2 |
| `EXPO_PUBLIC_COLOR_SCHEME` | [expo-app-standalone 3/hooks/useColors.ts:20](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/expo-app-standalone%203/hooks/useColors.ts#L20) | 3 |
| `EXPO_PUBLIC_REALTIME_URL` | [expo-app-standalone 3/lib/realtime.ts:41](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/expo-app-standalone%203/lib/realtime.ts#L41) | 1 |
| `FCM_SERVICE_ACCOUNT` | [.github/workflows/deploy.yml:90](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L90) | 13 |
| `FLOOD_DURATION` | [k6/scenarios/chat_flood.js:40](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/scenarios/chat_flood.js#L40) | 1 |
| `FLOOD_VUS` | [k6/scenarios/chat_flood.js:39](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/scenarios/chat_flood.js#L39) | 1 |
| `GIPHY_API_KEY` | [.github/workflows/deploy.yml:81](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L81) | 8 |
| `GITHUB_ACTIONS` | [scripts/audit-comments.mjs:933](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/scripts/audit-comments.mjs#L933) | 2 |
| `HEARTBEAT_MS` | [k6/loadtest-5k.mjs:124](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L124) | 1 |
| `HELLO_TIMEOUT_MS` | [k6/loadtest-5k.mjs:110](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L110) | 1 |
| `INVITATION_EXPIRY_DAYS` | [.github/workflows/deploy.yml:175](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L175) | 1 |
| `JSON_OUT` | [k6/loadtest-5k.mjs:141](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L141) | 1 |
| `K6_RSVP_TEST_EMAIL` | [k6/scripts/rsvp-regression-test.mjs:53](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/scripts/rsvp-regression-test.mjs#L53) | 1 |
| `K6_USER_COUNT` | [k6/scripts/seed-users.js:51](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/scripts/seed-users.js#L51) | 1 |
| `K6_USER_PASSWORD` | [k6/scripts/rsvp-regression-test.mjs:69](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/scripts/rsvp-regression-test.mjs#L69) | 2 |
| `K6_USER_PREFIX` | [k6/scripts/cleanup-users.js:29](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/scripts/cleanup-users.js#L29) | 3 |
| `MIN_CONNECT_RATE` | [k6/loadtest-5k.mjs:133](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L133) | 1 |
| `MIN_DELIVERY_RATE` | [k6/loadtest-5k.mjs:134](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L134) | 1 |
| `NEXT_PUBLIC_APP_URL` | [apps/web/app/layout.tsx:52](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/app/layout.tsx#L52) | 7 |
| `NEXT_PUBLIC_REALTIME_URL` | [apps/web/lib/realtime/client.ts:50](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/realtime/client.ts#L50) | 1 |
| `NEXT_PUBLIC_SUPABASE_URL` | [apps/web/lib/supabase/service.ts:24](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/supabase/service.ts#L24) | 7 |
| `NODE_ENV` | [apps/web/lib/auth/session.ts:276](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/auth/session.ts#L276) | 3 |
| `PGOPTIONS` | [scripts/db/capture.py:34](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/scripts/db/capture.py#L34) | 1 |
| `PREFLIGHT_TIMEOUT_MS` | [k6/loadtest-5k.mjs:125](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L125) | 1 |
| `PREVIEW_URL` | [preview workflow at audit revision](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/preview.yml#L196) | 1 |
| `PUBLISH_BASE_URL` | [k6/loadtest-5k.mjs:93](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L93) | 1 |
| `PUBLISH_INTERVAL_MS` | [k6/loadtest-5k.mjs:128](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L128) | 1 |
| `PUBLISH_MODE` | [k6/loadtest-5k.mjs:137](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L137) | 1 |
| `PUBLISH_SECRET` | [apps/realtime/__tests__/staging-test.mjs:23](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/realtime/__tests__/staging-test.mjs#L23) (test only) | 1 |
| `PUBLISH_TIMEOUT_MS` | [k6/loadtest-5k.mjs:132](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L132) | 1 |
| `PUSH_BATCH_SIZE` | [apps/web/lib/push/expo.ts:112](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/push/expo.ts#L112) | 1 |
| `PUSH_MAX_CONCURRENCY` | [apps/web/lib/push/expo.ts:113](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/push/expo.ts#L113) | 1 |
| `PUSH_MAX_DELIVERIES` | [apps/web/lib/push/chat.ts:678](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/push/chat.ts#L678) | 1 |
| `PUSH_MAX_RETRIES` | [apps/web/lib/push/expo.ts:115](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/push/expo.ts#L115) | 1 |
| `PUSH_RATE_LIMIT` | [apps/web/lib/push/expo.ts:114](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/push/expo.ts#L114) | 1 |
| `PUSH_RECEIPT_CHECK` | [apps/web/lib/push/chat.ts:670](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/push/chat.ts#L670) | 5 |
| `PUSH_RECEIPT_GRACE_MS` | [apps/web/lib/push/chat.ts:673](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/push/chat.ts#L673) | 1 |
| `PUSH_REQUEST_TIMEOUT_MS` | [apps/web/lib/push/expo.ts:118](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/push/expo.ts#L118) | 1 |
| `PUSH_RETRY_BASE_MS` | [apps/web/lib/push/expo.ts:116](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/push/expo.ts#L116) | 1 |
| `PUSH_RETRY_MAX_MS` | [apps/web/lib/push/expo.ts:117](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/push/expo.ts#L117) | 1 |
| `PUSH_TIME_BUDGET_MS` | [apps/web/lib/push/chat.ts:686](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/push/chat.ts#L686) | 1 |
| `QUIESCE_MAX_FRAMES_PER_SECOND` | [k6/loadtest-5k.mjs:121](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L121) | 1 |
| `QUIESCE_TIMEOUT_MS` | [k6/loadtest-5k.mjs:119](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L119) | 1 |
| `R2_ACCESS_KEY_ID` | [.github/workflows/deploy.yml:83](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L83) | 8 |
| `R2_ACCOUNT_ID` | [.github/workflows/deploy.yml:82](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L82) | 8 |
| `R2_BUCKET_NAME` | [.github/workflows/deploy.yml:85](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L85) | 8 |
| `R2_PRIVATE_BUCKET_NAME` | [.github/workflows/deploy.yml:87](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L87) | 3 |
| `R2_PUBLIC_URL` | [.github/workflows/deploy.yml:86](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L86) | 22 |
| `R2_SECRET_ACCESS_KEY` | [.github/workflows/deploy.yml:84](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L84) | 8 |
| `RAMP_BATCH` | [k6/loadtest-5k.mjs:107](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L107) | 1 |
| `RAMP_DELAY_MS` | [k6/loadtest-5k.mjs:108](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L108) | 1 |
| `REALTIME_PUBLISH_SECRET` | [.github/workflows/deploy.yml:74](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L74) | 28 |
| `REALTIME_URL` | [.github/workflows/deploy.yml:73](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L73) | 9 |
| `RESEND_API_KEY` | [.github/workflows/deploy.yml:79](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L79) | 7 |
| `ROOM_MODE` | [k6/loadtest-5k.mjs:151](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L151) | 1 |
| `SESSION_SECRET` | [.github/workflows/deploy.yml:71](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L71) | 27 |
| `SETTLE_MS` | [k6/loadtest-5k.mjs:111](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L111) | 1 |
| `SIGNUP_EXPIRY_DAYS` | [apps/web/app/api/admin/signup-attempts/[id]/resume/route.ts:8](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/app/api/admin/signup-attempts/[id]/resume/route.ts#L8) | 2 |
| `STAGING_URL` | [apps/realtime/__tests__/staging-test.mjs:21](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/realtime/__tests__/staging-test.mjs#L21) (test only) | 1 |
| `STRICT_QUIESCE` | [k6/loadtest-5k.mjs:122](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L122) | 1 |
| `SUPABASE_ACCESS_TOKEN` | [scripts/db/capture.py:17](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/scripts/db/capture.py#L17) | 1 |
| `SUPABASE_EXPERIMENTAL_STACK` | [scripts/db/test_fresh.py:50](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/scripts/db/test_fresh.py#L50) | 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | [.github/workflows/deploy.yml:72](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L72) | 15 |
| `SUPABASE_URL` | [apps/web/e2e/seed-member.mjs:114](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/e2e/seed-member.mjs#L114) | 4 |
| `SUPABASE_USE_SLIM_IMAGES` | [scripts/db/test_fresh.py:56](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/scripts/db/test_fresh.py#L56) | 1 |
| `TEST_COMMUNITY_ID` | [apps/web/app/api/admin/load-test/impl.ts:150](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/app/api/admin/load-test/impl.ts#L150) | 11 |
| `TEST_EVENT_ID` | [k6/tests/06_events.js:23](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/tests/06_events.js#L23) (test only) | 1 |
| `TEST_THREAD_ID` | [k6/tests/05_threads.js:23](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/tests/05_threads.js#L23) (test only) | 1 |
| `TEST_USER_EMAIL` | [k6/scenarios/chat_load.js:67](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/scenarios/chat_load.js#L67) | 5 |
| `TEST_USER_PASSWORD` | [k6/scenarios/chat_load.js:68](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/scenarios/chat_load.js#L68) | 5 |
| `TEST_USER_SESSION_TOKEN` | [k6/loadtest-5k.mjs:139](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L139) | 1 |
| `TOPIC` | [k6/loadtest-5k.mjs:99](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L99) | 2 |
| `TOTAL_CLIENTS` | [k6/loadtest-5k.mjs:103](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L103) | 2 |
| `TZ` | [apps/web/lib/communities/event-display.test.ts:15](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/apps/web/lib/communities/event-display.test.ts#L15) (test only) | 15 |
| `UPSTASH_REDIS_REST_TOKEN` | [.github/workflows/deploy.yml:78](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L78) | 9 |
| `UPSTASH_REDIS_REST_URL` | [.github/workflows/deploy.yml:77](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/.github/workflows/deploy.yml#L77) | 8 |
| `USER_PREFIX` | [k6/loadtest-5k.mjs:105](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L105) | 1 |
| `WS_BASE_URL` | [k6/loadtest-5k.mjs:88](https://github.com/sachin1228/uxcommunity/blob/48215d4f0d6ef724bc058f51ca5f22caaf1e3b9a/k6/loadtest-5k.mjs#L88) | 2 |

Local file inspection also checked blank/nonblank presence and equality without
copying values. No relevant service credentials were present in this audit
process's inherited environment. No credential validation or provider delivery
was inferred from that absence. The expired Wrangler credential is separately
recorded in the audit's access limits.
