# Overall Repository Audit — UXCommunity

**Audit date:** 2026-11-06
**Repository:** `/Users/sachin/Documents/GitHub/uxcommunity`
**Revision audited:** `c5926c80` (`main`, working tree clean)
**Type:** Independent, read-only audit. No application code, migration, configuration, data, infrastructure or deployment was changed. This document is the only file written.

> **Evidence rule.** Every finding below was checked against the current tree, not against older audit documents, PR descriptions or comments. Where a claim could not be verified without live production access, it is marked **UNVERIFIED** and is not counted as a defect. Where a prior audit finding was checked and is now fixed, that is stated with the current evidence.

---

## 0. Scope, method and verification log

### What was audited

| Area | Scope |
|---|---|
| Web | `apps/web` — Next.js App Router, 195 API route handlers, 72 pages, 173 components, 376 `lib` modules |
| Mobile | `expo-app-standalone 3` — Expo SDK 54 / React Native, 35 screens, 61 test files |
| Realtime | `apps/realtime` — Cloudflare Worker, `Room` + `UserDO` + `AlertMonitor` Durable Objects, 35 test files |
| Database | `supabase/migrations/*` — one production-schema baseline + 5 forward migrations, RPCs, triggers, grants, RLS |
| Infrastructure | GitHub Actions (`ci`, `staging`, `deploy`, `database`), `wrangler.toml` configs, environment isolation, R2, secrets |
| Product | Web and mobile UI/UX states, navigation, accessibility, empty/error/loading behaviour |

### Commands actually run (safe, local, read-only)

| Check | Result |
|---|---|
| `apps/web: npx tsc --noEmit` | **PASS** (clean) |
| Web unit suite (CI glob, `APP_ENV=production`): 141 files | **1149 / 1149 pass** (`tsx --test`) |
| Same suite without `APP_ENV` | 48 failures — environment-fixture only, reproduced green with the CI env |
| `expo-app-standalone 3: npx tsc --noEmit` | **PASS** (clean) |
| Mobile realtime suites (`realtimeCore`, `realtimeCatchUp`, `realtimeWindow`, `realtimeScale`, `realtimeAuth`) | **72 / 72 pass** |
| Mobile cache suites (`chatCache`, `screenDataCache`, `profileCache`, `nameCache`) | **45 / 45 pass** |
| `node scripts/audit-comments.mjs` | **PASS** — 1,590 files, 7 rules, 3 stale exemptions |
| `npm audit --omit=dev` | **2 high, 4 low, 0 critical** production-tree advisories |
| `apps/realtime: npx tsc --noEmit` | **PASS** (clean) |
| `apps/realtime: npm test` (all 35 suites incl. perf) | Started; the 1,000-socket perf suites did not finish inside ~7 minutes on this laptop and were stopped. |
| `apps/realtime`: non-perf suites (20 files) | **252 / 257 pass, 5 fail.** The 5 failures are **test-harness/environment failures, not verified product regressions**: (a) three `ws-session-revocation` tests time out/401 because the harness reads the generated `.dev.vars` values verbatim, including their surrounding quotes, so the JWT it signs cannot match the unquoted secret the Worker receives (both `SESSION_SECRET` and `REALTIME_PUBLISH_SECRET` are quoted in the local file); (b) the "API_URL missing" fail-closed test expects 401/403 but the Worker now asserts `API_URL` at the fetch entry and returns 500 — still fail-closed, but the assertion is stale. Neither failure demonstrates an authorization bypass. |
| `pg`, production DB, Cloudflare, R2, staging | **Not contacted.** No credentials used; no live state changed. |

### What could not be verified

- Live Supabase backup/PITR status, actual row counts, `EXPLAIN` plans, index usage, and whether the five forward migrations are applied in production. The repository documents, not live checks, are the evidence for backup status.
- Whether the eight credentials exposed in the deleted `.open-next` artifact were ever copied or shared outside this machine.
- Actual EAS-built Android artifact (signing, manifest, versioning); only the checked-in/generated local Android project was inspected.
- Real-device behaviour on slow networks, background/foreground transitions and Android 15 keyboard handling.
- Production runtime latency/error rates; no production probing was performed.

---

## A. Executive Summary

### Overall engineering quality

This is a **substantial, well-engineered application**, not a prototype. The strongest parts are unusually disciplined for a project of this size: a server-side session registry that makes logout/reset/block/delete take effect immediately; fail-closed realtime membership checks; a WebSocket client-publish allow-list; direct-to-R2 video uploads with a bounded proxy fallback; materialised community member counts; cursor-paginated chat and DM pages; revocation propagation to live sockets; environment isolation enforced in code and CI; credential guards before every deploy; structured logs and a dependency-health monitor.

The weaknesses are not "the code is bad". They are **operational readiness, release safety, and scale-specific bottlenecks**:

1. **There is still no recoverable backup or disaster-recovery path.** The database has no PITR/physical backup and R2 versioning is disabled; this is documented as explicitly deferred in `PRODUCTION_REMEDIATION_REPORT.md` and `REMAINING_BLOCKERS.md`. A database loss or an accidental R2 delete is unrecoverable. This alone is a production blocker.
2. **Eight credentials exposed in a local build artifact were still live at the last recorded check, and rotation is deferred.** The artifact was deleted on 2026-11-03, but deletion is not rotation (`PRODUCTION_REMEDIATION_REPORT.md:158`, `project-open-next-secret-leak` memory).
3. **Release gating is thinner than it looks.** CI runs the full web unit suite and type check, but never runs the 35 realtime worker suites (including the WebSocket security and ownership suites). The production deploy job runs only two web test files plus a seeder test before shipping.
4. **Abuse protection is intentionally fail-open.** Login, reset, signup, chat, DM and content limits all return success when Upstash is missing, unreachable or over quota. In production, a missing Upstash configuration boots silently with every throttle disabled.
5. **Known scale ceilings are documented but unaddressed.** A single hot community room collapses between ~2,500 and ~4,000 attached sockets; the home-feed RPC scans and JSON-encodes all four content tables before its LIMIT; sidebar unread counts grow with unread volume; member search has no supporting index.

### Production readiness

**NO-GO for general availability.** The application can continue a limited, pre-launch/soft-launch existence only with an explicit, written acceptance of the data-loss risk. It should not be marketed, onboarded at scale, or treated as a system of record until backup/DR, credential rotation, mobile release signing and the release-test gate are resolved.

### Biggest risks

| Rank | Risk | Why |
|---|---|---|
| 1 | No backup/DR | A bad migration, Supabase incident or accidental delete is unrecoverable. |
| 2 | Exposed live credentials | Eight production secrets were written in plaintext to a local artifact; rotation is deferred. |
| 3 | Rate-limit fail-open | Credential stuffing and abuse are unthrottled during any Redis outage or misconfiguration. |
| 4 | Release gate gaps | Realtime security regressions can ship without a single realtime test running in CI. |
| 5 | Mobile release not production-ready | Local release builds are debug-signed, versioned 1/1.0.0, request unnecessary permissions, and allow plaintext app-data backup. |
| 6 | Scale ceilings | Single hot-room DO ceiling, full-scan feed RPC, unbounded unread counts, no trigram search. |

### Strongest architectural decisions

- **Session registry + `session_version`** rather than trusting a JWT until expiry: logout, logout-all, password reset, block, suspension and deletion revoke immediately across HTTP, realtime and private-file access.
- **Realtime authorization is fail-closed**: a missing `API_URL` refuses community sockets instead of allowing every room; user-scoped room names are forced to the caller's own ID; client publishes are limited to `typing` with a validated payload and per-socket/per-user token buckets.
- **Media path**: videos go direct to R2 against a one-shot presigned PUT; the proxy path refuses video bytes and caps any request body at 10 MB; private files (DM, résumés, verification samples) are in a separate bucket with 5-minute signed GETs and object-level access rules.
- **Database correctness**: materialised `member_count` with triggers, unique partial notification-dedupe index, compound `(created_at, id)` cursors, advisory locks for membership/creation caps, reports retained with evidence snapshots and anonymised on user deletion.
- **Environment isolation**: `APP_ENV` is mandatory; staging refuses production/local destinations; development refuses non-loopback service URLs; media bucket names are environment-scoped; the deploy pipeline pushes the same `API_SECRET` to both Workers so they cannot drift.
- **Release plumbing**: credential-health guards run before every deploy, `/stats` counters exist, the dependency monitor emails on R2/Supabase/realtime/Resend outages, and the deploy smoke test proves a real WebSocket handshake and fan-out after each release.

### Areas requiring immediate attention

1. Backup/DR with a proven restore of Postgres + both R2 buckets.
2. Rotate the eight live credentials and re-issue the session secret.
3. Make auth/report/signup/chat limits fail closed when Upstash is absent in production; alert on limiter failure.
4. Put the realtime suites in CI and the full web suite in the deploy job.
5. Sanitize `linkedin_url` / `portfolio_url` before they reach any `href`.
6. Cap presigned video PUT size and verify the landed object's real length.
7. Fix Android release signing/versioning and detach push on implicit sign-out.

---

## B. Overall Quality Score

Scores are 0–10. "10" means I would ship it to a large production audience with no audit caveats; "5" means materially below what a production system needs; scores are deliberately not inflated.

| Category | Score | Reasoning |
|---|---:|---|
| **Architecture** | **7.5** | Clear layers (App Router → `lib` domain → Supabase; separate realtime Worker; shared packages), one realtime system for web and mobile, and explicit environment isolation. Deductions: 195 route handlers, service-role-only data access with no RLS backstop, duplicated web/mobile domain logic, no job queue. |
| **Code quality** | **7.0** | Strict TypeScript, generated DB types, zero `TODO/FIXME`, a comment audit that blocks dead references, and generally excellent explanatory comments. Deductions: 249 `any`/unsafe casts, 632 lint/TS suppressions, 43 advisory ESLint errors, several very large components/routes. |
| **Frontend** | **6.0** | Server-first feed and thread pages, real skeletons, disciplined caching, prefetching and stale-while-revalidate. Deductions: no `error.tsx`/`not-found.tsx`, chat open duplicates the read model, zero `next/image`, 61 raw `<img>`, no list virtualisation, dark-only styling mixed with light tokens. |
| **Mobile** | **6.0** | SecureStore token storage with migration, bounded and identity-scoped caches, realtime reconnect/catch-up, socket cap, unsubscribe parity, private media memory-only. Deductions: no request timeouts, push not detached on implicit sign-out, `allowBackup=true`, release signed with debug key, location/audio/overlay permissions with no using feature, limited CI coverage. |
| **Backend** | **7.0** | Every admin route guarded, DM/upload/job access checks are consistently modelled in `lib`, private-file rules are pure and tested, internal endpoints are secret-gated. Deductions: rate-limit fail-open, public GIPHY proxy, raw DB error messages in several routes, ad-hoc validation instead of Zod in most routes, unauthenticated comment-room sockets. |
| **Security** | **6.5** | Excellent session/authorization core and media access rules; no verified IDOR or SQL injection; zero `dangerouslySetInnerHTML`; SSRF allow-list and redirect re-validation. Deductions: exposed credentials still live, `javascript:` profile URL rendered in an admin link, report-only CSP with `unsafe-inline`/`unsafe-eval`, parent-domain cookie, fail-open limits, uncapped presigned upload, mobile backup exposure. |
| **Database** | **7.5** | Strong constraints, triggers and concurrency controls (unique partial indexes, advisory locks, atomic reset/apply RPCs); correct member-count materialisation; cursor pagination for chat/DM. Deductions: full-scan home feed, unread counts proportional to volume, no trigram index for member search, a blocking `NO ACTION` FK on account deletion, event-room orphans, duplicate indexes. |
| **Realtime** | **7.5** | Targeted topic fan-out, count-only lap-budgeted presence, event-id dedupe, bounded retry, session revocation, fail-closed membership, hibernation-safe registry, strong test inventory. Deductions: single-DO ceiling at ~2,500–4,000 sockets, no sharding, no durable replay, comment rooms skip membership, query-string JWT still accepted, no server-side socket cap, membership removal does not close live sockets. |
| **Cloudflare infrastructure** | **7.0** | Workers + three DO classes, R2 with separate public/private buckets, cron monitor/retention/lifecycle jobs, observability enabled, credential guards, cost model from actual code. Deductions: no queue/durable job system, no error tracking, Cloudflare Images binding configured but unused, no backup story for Supabase (the system of record). |
| **Performance** | **5.5** | Realtime fan-out and presence are genuinely fixed and measured; chat/DM cursors are good. Deductions: home-feed full scan, unread-count scans, RSVP full-row counts, duplicate chat read model, unoptimised images, no virtualisation, N+1 sender-profile fetches. |
| **Testing** | **6.0** | 1,149 web tests, 72 mobile realtime + 45 mobile cache tests all pass; realtime has 35 suites including security/ownership/scale harnesses; SQL suites exist; comment audit is real. Deductions: realtime suites are not in CI, 5 non-perf realtime tests currently fail on harness issues, no browser E2E, no device matrix, no load-test gate, no coverage thresholds, critical journeys are tested in units with fakes rather than end to end. |
| **CI/CD** | **7.0** | Blocking type check + full web unit suite + isolation + comment audit + credential guards; automatic staging on `main`; production requires `DEPLOY_PRODUCTION` and the protected environment; migrations apply before deploy; deploy smoke proves realtime. Deductions: production deploy runs only two web test files; realtime tests never run in any workflow; Android release is manual. |
| **UI/UX** | **6.5** | Polished chat/feed, real skeletons, good aria-label coverage, focus-managed photo viewer, reduced motion, error/empty states on major lists. Deductions: no error boundaries, Explore failure reads as "no communities", mouse-only cards, modal focus not trapped, dead "Google coming soon", developer-facing GIPHY error copy, missing skip link, inconsistent loading language. |
| **Maintainability** | **6.5** | Extensive docs, pure helpers, generated types, named logs, comment audit. Deductions: doc drift (Next 14 vs 16, 187 vs 195 routes, stale `?token=`, stale 7-day session claim), 632 suppressions, large components, duplicated mobile/web logic, no dependency-update policy. |
| **Overall** | **6.7** | A strong codebase with a credible architecture and real test discipline, held back by unresolved operational safety (no backups, unrotated secrets), thin release gating, and known scale limits. |

---

## C. Findings

Severity: **P0** critical security/data-loss/outage; **P1** high-impact, immediate attention; **P2** important quality/scalability; **P3** minor improvement/technical debt.
Effort: **XS** <1h, **S** 1–4h, **M** 1–2d, **L** 3–5d, **XL** >1w.

### P0

#### AUD-01 — No recoverable backup or disaster-recovery path

- **Severity:** P0 · **Category:** Data integrity / Infrastructure
- **Description:** Production has no verified Postgres PITR or physical backup and no R2 versioning/replication. The repository contains no backup or restore automation. This is documented as explicitly deferred, not accidentally omitted: `PRODUCTION_REMEDIATION_REPORT.md:23` ("BACKUP / DISASTER RECOVERY: NOT ADDRESSED — explicitly deferred"), `REMAINING_BLOCKERS.md:13` (Supabase `pitr_enabled=false`, `backups=0`, R2 versioning disabled).
- **Impact:** A bad migration, Supabase incident, operator error or accidental delete is unrecoverable. This is a system-of-record failure, not a feature outage.
- **Evidence:** `PRODUCTION_REMEDIATION_REPORT.md:23,146,188`; `REMAINING_BLOCKERS.md:13,34,61`; no `scripts/*backup*` or `*restore*` exists; `docs/DEPLOYMENT.md:88` states production has no PITR.
- **Repro:** `find scripts -iname '*backup*' -o -iname '*restore*'` → empty; read the documents above.
- **Recommended fix:** Enable Supabase PITR (or scheduled logical dumps with off-site storage), enable R2 versioning/object lock, write and execute a restore drill, and define RPO/RTO. Document the restore procedure and run it at least quarterly.
- **Estimated effort:** M (1–2 days + provider plan change).
- **Blocks production:** **Yes.**

### P1

#### AUD-02 — Eight exposed credentials were still live; rotation is deferred

- **Severity:** P1 · **Category:** Security / Secrets
- **Description:** `apps/web/.open-next/cloudflare/next-env.mjs` previously contained ten production credentials in plaintext. The R2 pair was rotated (and is dead), but the other eight — Supabase service-role key, `SESSION_SECRET`, `ADMIN_PASSWORD`, Resend key, Upstash token, GIPHY key, realtime publish secret, internal API secret — were still live and unrotated at the last recorded check (2026-11-03). The artifact was deleted on 2026-11-03, but deletion is not rotation, and the repository contains no evidence of a later rotation. The current `.open-next` was rebuilt under the development environment (it contains no `app.uxcommunity.in` marker), but that does not change the exposed values.
- **Impact:** Anyone who copied, synced or shared the artifact has full database access (service role), the ability to forge sessions (`SESSION_SECRET`), admin access (`ADMIN_PASSWORD`), and server-to-server publish rights. Exposure may have been local-only; that is **UNVERIFIED**.
- **Evidence:** `PRODUCTION_REMEDIATION_REPORT.md:158` ("C-13 secrets in artifacts — NOT FIXED — APPROVAL … rotate and delete"); `FINAL_PRODUCTION_READINESS_REPORT.md:69` (C-13); project memory `project-open-next-secret-leak` (8 live, rotation deferred); current `.open-next` exists (137 MB) and is gitignored.
- **Repro:** Not reproducible without the old artifact; the documents and the recorded inventory list the values. Never print artifact contents.
- **Recommended fix:** Rotate all eight values; update GitHub Environment secrets, local env files and Worker secrets in one pass; re-issue user sessions by changing `SESSION_SECRET`; verify with `npm run verify:services`, `verify:cloudflare`, `verify:r2`, `verify:fcm`; delete local build artifacts and add a pre-commit/secret-scanning guard.
- **Estimated effort:** S (1–4h, mostly provider dashboards).
- **Blocks production:** **Yes** (until rotation is complete).

#### AUD-03 — Android release configuration is not production-ready

- **Severity:** P1 · **Category:** Mobile / Release
- **Description:** The generated Android project signs the `release` variant with `signingConfigs.debug`, hardcodes `versionCode 1` / `versionName "1.0.0"`, sets `allowBackup="true"` with no backup rules, and requests `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`, legacy storage and media permissions. `expo-location` has no import site; no feature needs location or audio. Only the custom `uxcommunity://` scheme is declared (no verified universal/app links).
- **Impact:** A locally built release APK/AAB is debug-signed (rejected by Play; the debug key is public), every build collides on version code, and users are asked for sensitive permissions the app does not use. `allowBackup=true` lets Google Drive backups include plaintext chat caches and the auth snapshot (also AUD-10). An EAS-built artifact may differ; its signing/manifest were **UNVERIFIED**.
- **Evidence:** `expo-app-standalone 3/android/app/build.gradle:95-96,110,115`; `expo-app-standalone 3/android/app/src/main/AndroidManifest.xml:2-13,21`; `expo-app-standalone 3/package.json` (`expo-location` present, no imports); `app.json:8` (custom scheme only).
- **Repro:** `./gradlew assembleRelease` and inspect `apksigner verify --print-certs`; `aapt dump permissions`.
- **Recommended fix:** Configure a real upload keystore or EAS credentials; set `autoIncrement`/versioning; remove unused permissions and `SYSTEM_ALERT_WINDOW` from the main manifest (debug manifest only); set `allowBackup=false` or restrictive backup rules; add app links if share/invite deep links are required; produce and test a signed release on a clean device.
- **Estimated effort:** M (1–2d plus store setup).
- **Blocks production:** **Yes** for a Play/production release.

#### AUD-04 — Release gate does not run the full or realtime test suites

- **Severity:** P1 · **Category:** CI/CD / Testing
- **Description:** CI (`.github/workflows/ci.yml`) runs a blocking web type check, the full web unit suite, isolation, comment audit and credential-guard tests — but it **never runs `apps/realtime` tests**. The production deploy job (`.github/workflows/deploy.yml`) runs `npx tsc --noEmit` and exactly two web test files (`lib/read-manager.test.ts`, `lib/request-cache.test.ts`) plus the seeder test before shipping. The 35 realtime suites include the WebSocket ownership, publish-security, session-revocation, multi-device and sub-entity isolation tests — the security boundary of the product.
- **Impact:** A regression in room authorization, revocation, publish validation or fan-out can reach production with a green deploy. CI green on a PR does not prove the realtime worker builds/tests, and the deploy job does not depend on CI results. The suite is not currently green even when run locally: 5 of 257 non-perf tests fail for harness reasons (quoted `.dev.vars` secrets and a stale fail-closed status assertion), which is exactly the kind of drift a CI job would have surfaced.
- **Evidence:** `.github/workflows/ci.yml` jobs `mobile-chat`, `isolation`, `typecheck`, `tests`, `comments`, `deployment`, `lint`; `.github/workflows/deploy.yml:264-277` (`Run unit tests` runs two files); `apps/realtime/package.json` test script exists but is not referenced in any workflow; local non-perf run 252/257 with the failures described in §0.
- **Repro:** `grep -rn "apps/realtime" .github/workflows/*.yml` → only deploy paths, no test invocation.
- **Recommended fix:** Add a blocking `realtime` CI job (`npx tsc --noEmit`, non-perf `npm test`), with the perf suites in a separate scheduled job. Make the deploy job run the full web suite and the realtime non-perf suite, or make it depend on a successful CI run for the exact SHA.
- **Estimated effort:** S (2–4h).
- **Blocks production:** **Yes** for safe releases (not for runtime).

#### AUD-05 — Rate limiting fails open and can be silently absent in production

- **Severity:** P1 · **Category:** Security / Abuse prevention
- **Description:** `rateLimit()` returns `success: true` when Upstash is unconfigured, unreachable, or over quota. The missing-configuration branch is the dangerous one: in production there is no boot assertion for `UPSTASH_REDIS_REST_URL`/`_TOKEN`, so a deploy missing either value starts normally with **every** throttle disabled — login (10/15m IP, 20/15m account), password reset, signup, chat/DM sends, content creation and reports. This was deliberately reintroduced by commit `da49fe90` ("fail open on rate-limit infrastructure errors (#733)") after the remediation branch had made abuse-sensitive routes fail closed.
- **Impact:** Credential stuffing and spam are unthrottled during any Redis outage or misconfiguration. The only remaining brake on login is bcrypt cost; there is no CAPTCHA/Turnstile gate.
- **Evidence:** `apps/web/lib/auth/rate-limit.ts:81-88` (missing env → success), `:96-108` (catch → success); no `assertWebEnvironment` check for Upstash in production (`packages/shared/src/environment.ts:85-98` only checks it for non-production); login/reset call sites as above.
- **Repro:** Start the app with `APP_ENV=production` and no Upstash vars; login 100 times — all attempts proceed.
- **Recommended fix:** In production, fail startup (or fail closed for `login:`, `reset:`, `signup:`, `report:`, `chat:` keys) when Upstash is absent; add a health-check alert for limiter errors; consider a conservative in-memory per-isolate fallback for the auth routes only.
- **Estimated effort:** S (2–4h).
- **Blocks production:** **Yes** (abuse exposure).

### P2

#### AUD-06 — Stored `javascript:` profile URL is rendered as an admin link (XSS)

- **Severity:** P2 · **Category:** Security / XSS
- **Description:** `PATCH /api/profile` stores `linkedin_url` and `portfolio_url` with only `.trim()`, no scheme/host validation. The admin user card renders those values directly into `href` with no sanitizer. React 18.3.1 only warns on `javascript:` URLs; it still sets the attribute (verified in `react-dom.development.js`). A member can store `javascript:fetch('/api/admin/users')...` and it executes in the app origin if an admin clicks the link.
- **Impact:** An admin-session compromise (read/modify users, moderation, master data) if an admin clicks a member-controlled link. Exploitability is reduced because the link text is the raw URL, so the scheme is visible; it is not a drive-by. The public profile card is safe because it uses `externalUrl()`.
- **Evidence:** `apps/web/app/api/profile/route.ts:92-93`; `apps/web/components/admin/users/UserInfoCard.tsx:73,91`; safe reference `app/dashboard/profile/components/ProfileCard.tsx:85-95`.
- **Repro:** As a member, PATCH `{"linkedin_url":"javascript:alert(document.cookie)"}`; open `/admin/users/<id>` and click LinkedIn.
- **Recommended fix:** Validate both fields with the existing `normalizeLinkedInUrl` (or a shared `safeHttpUrl`) on write; render through `externalUrl()`/`safeHref()` on every surface; add a unit test that `javascript:`/`data:` are rejected.
- **Estimated effort:** XS–S (1–2h).
- **Blocks production:** No, but fix before GA.

#### AUD-07 — Presigned video PUT has no size bound; finalize trusts the client's size

- **Severity:** P2 · **Category:** Media / Abuse
- **Description:** `presignR2Put` signs only `Bucket`, `Key` and `ContentType` — no `ContentLength`/range condition. The upload-ticket route validates the *declared* size ≤ 50 MB, but the presigned URL accepts any body R2 permits. The completion endpoint then accepts the client-reported `size` (≤50 MB) and only `HEAD`s the object for existence; it never compares the real `ContentLength`.
- **Impact:** A member can store multi-gigabyte objects in the public media bucket while the product records a ≤50 MB video. This is a direct storage/egress cost and abuse vector, and the immutable CDN caching makes repeat downloads cheap for the attacker but billable to the project.
- **Evidence:** `apps/web/lib/r2.ts:257-269`; `apps/web/app/api/communities/[id]/showcase/upload-ticket/route.ts:52-56`; `apps/web/app/api/communities/[id]/showcase/upload/route.ts:139-180` (size comes from body; `r2ObjectExists` only).
- **Repro:** Request a ticket for 1 KB; PUT a 1 GB file to the signed URL with the pinned content type; finalize with `size: 1024`.
- **Recommended fix:** Sign `ContentLength` in `presignR2Put` and/or issue a POST-policy with a size range; on finalize, `HEAD` the object and reject if `ContentLength` exceeds `MAX_VIDEO_BYTES` or differs materially from the reported size; delete the object on rejection.
- **Estimated effort:** S (2–4h).
- **Blocks production:** No, but fix before GA.

#### AUD-08 — Implicit sign-out/revocation leaves push registered

- **Severity:** P2 · **Category:** Mobile / Privacy
- **Description:** Explicit logout calls `performLogout`, which detaches the push token before clearing the session. The `createSignOutCoordinator` used for 401 / session expiry / realtime 4001 does **not** call `unregisterPush`. The foreground notification handler and the native Android FCM service display whatever arrives without checking that a session is active.
- **Impact:** After a session expires or is revoked, the device shows the login screen but continues to receive message pushes (including content) for the previous account. On a shared or resold device this is a privacy leak.
- **Evidence:** `expo-app-standalone 3/context/AuthContext.tsx:223-240` (coordinator steps), `:475-490` (explicit logout includes `unregisterPush`); `lib/sessionLifecycle.ts:185-189`; native handler `plugins/chat-notifications/ChatFirebaseMessagingService.kt:113-140`.
- **Repro:** Revoke the session server-side; trigger any API call → login screen; send a message to the old account → push arrives.
- **Recommended fix:** Run `unregisterStoredPushTokenAsync` inside the implicit sign-out coordinator while the cookie still exists (bounded by the existing timeout), and suppress notification presentation when no authenticated session is present.
- **Estimated effort:** S (2–4h).
- **Blocks production:** No, but fix before GA.

#### AUD-09 — Mobile API requests have no timeout or cancellation

- **Severity:** P2 · **Category:** Mobile / Reliability
- **Description:** `apiFetch` and `apiFormUpload` call `fetch` with no default `AbortSignal` deadline. Only user-cancelled chat sends pass a signal. On a blackholed or lossy network, login, list loads, chat loads and 50 MB video PUTs can hang until the OS TCP timeout while `isLoading` remains true.
- **Impact:** The app can appear permanently loading with no retry; force-quit is the only recovery. Uploads cannot be cancelled.
- **Evidence:** `expo-app-standalone 3/lib/api.ts:140-145,239-244`; `lib/showcaseVideo.ts:94-135`; only `hooks/useSendMessage.ts:130-152` passes a signal.
- **Repro:** Throttle to 100% packet loss after dispatch; spinner never resolves.
- **Recommended fix:** Wrap the core fetch/upload helpers with `AbortSignal.timeout` (e.g. 15 s read, 120 s upload) plus one bounded retry for idempotent GETs; abort on unmount; surface a timeout message.
- **Estimated effort:** S (2–4h).
- **Blocks production:** No, but fix before GA.

#### AUD-10 — Android Auto Backup includes plaintext chat and auth caches

- **Severity:** P2 · **Category:** Mobile / Privacy at rest
- **Description:** `allowBackup="true"` with no `dataExtractionRules`/`fullBackupContent` exclusions. AsyncStorage holds full message text (`chatCache`, `chatCacheStore`) and the auth snapshot (email/name/role). The SecureStore token itself is not usable after restore (Keystore key is not backed up), but the plaintext caches are.
- **Impact:** Google Drive backups and restored devices can contain another member's readable chat history and account PII.
- **Evidence:** `expo-app-standalone 3/android/app/src/main/AndroidManifest.xml:21`; `lib/chatCache.ts:88-108`; `lib/authSnapshot.ts:14,42-45`; `app.json:23-33` (no backup rules).
- **Repro:** `adb backup` (on a debuggable build) or inspect Google Drive app data after backup.
- **Recommended fix:** `allowBackup=false`, or exclude `@chat-cache/*`, `@auth/*`, `@uxcommunity/*` via `dataExtractionRules`/`fullBackupContent`; optionally encrypt the chat cache.
- **Estimated effort:** S (1–2h).
- **Blocks production:** No, but fix before GA.

#### AUD-11 — No web error, not-found or global-error boundaries

- **Severity:** P2 · **Category:** Frontend / Reliability
- **Description:** `find app -name "error.tsx" -o -name "not-found.tsx" -o -name "global-error.tsx"` returns nothing. A failed RSC/route render falls through to Next's unstyled "Application error" page with no nav, retry or brand; unknown URLs get the default 404.
- **Impact:** A transient database/RPC failure strands the user with no way back; 404s look like a broken product.
- **Evidence:** absence in `apps/web/app`; `app/layout.tsx` mounts guards but no boundary.
- **Repro:** Force an RSC throw (bad RPC) or visit an unknown path.
- **Recommended fix:** Add `app/error.tsx` (client, retry + "Back to feed"), `app/not-found.tsx`, and segment boundaries for `/dashboard` and `/admin`; reuse the design-system surfaces.
- **Estimated effort:** S (2–4h).
- **Blocks production:** No.

#### AUD-12 — Chat open duplicates the read model and defers messages

- **Severity:** P2 · **Category:** Performance / Frontend
- **Description:** The community page fetches a header snapshot via `fetchCommunityMetaSSR` (which runs `loadCommunityChatReadModel`) and deliberately passes no `initialMessages`. On mount the client calls `/bootstrap`, which runs `loadCommunityChatReadModel` again plus the message page. The user sees a loading animation while the second round trip completes.
- **Impact:** The most-used screen pays two read-model round trips per open; navigation is fast but content is spinner-first, and server/DB work is duplicated.
- **Evidence:** `apps/web/app/dashboard/communities/[id]/page.tsx:27-31,89-97`; `apps/web/app/api/communities/[id]/bootstrap/route.ts:86-100`; `components/communities/chat/useChatData.ts:42,281-296`.
- **Repro:** Open a community chat on a cold cache and observe the bootstrap request after hydration.
- **Recommended fix:** Use one loader on the server and pass `initialMessages`/`initialSections` into the client (the seeding path exists via `seedCommunityRequestCache`), keeping the cache for revisits.
- **Estimated effort:** M (1–2d).
- **Blocks production:** No.

#### AUD-13 — Home-feed RPC scans and JSON-encodes all four content tables before LIMIT

- **Severity:** P2 · **Category:** Database / Scalability
- **Description:** `get_home_feed_page(p_scope='all')` unions threads/events/resources/showcase filtered by `(community_id IN my_communities OR is_public)`, projects `to_jsonb(t)` inside the candidate CTE, then orders and limits 30. The `OR` prevents use of the partial public indexes; `to_jsonb` is evaluated for every matching row, not the 30 survivors.
- **Impact:** Every dashboard load scans and serialises four tables. Tolerable at current data volume; at ~1M content rows every home load is a multi-table scan + sort, and the Worker payload is built from far more rows than delivered.
- **Evidence:** `supabase/migrations/20261031163000_production_schema_baseline.sql:5811-5864`; default scope `all` (`apps/web/lib/feeds/home-feed-options.ts:26`).
- **Repro:** `EXPLAIN (ANALYZE, BUFFERS)` on the RPC with production-like row counts — **UNVERIFIED** locally.
- **Recommended fix:** Split by scope so each branch uses an indexed predicate (`community_id = ANY(...)` / partial public index), and select IDs in an inner `LIMIT 30` CTE before projecting JSON (the thread-list RPC already uses this shape).
- **Estimated effort:** M (1–2d).
- **Blocks production:** No.

#### AUD-14 — Sidebar unread counts grow with unread volume; Explore is unpaginated

- **Severity:** P2 · **Category:** Database / Scalability
- **Description:** `get_sidebar_activity` counts every message since `greatest(last_read_at, joined_at)` per membership and evaluates `jsonb_array_elements(mentions)` per row; `get_unread_message_totals` repeats the count. The 15-day chat retention bounds chat messages, but unread *content* (threads/showcase/resources/events) has no retention and is counted from the member's join date. `get_all_communities` has no LIMIT and returns every active community with description and two EXISTS probes per row.
- **Impact:** A member away from a busy room can make the sidebar do thousands of index entries per load; Explore returns the whole catalogue as JSON on every visit.
- **Evidence:** baseline `:6581-6619` (`message_stats`), `:6726-6752` (`content_items`), `:4878-4973` (`get_all_communities`, no limit); hot callers `apps/web/lib/communities/sidebar-server.ts`, `app/api/communities/all/route.ts`.
- **Repro:** Seed 100k messages in one room, set `last_read_at` 30 days back, call the RPC — **UNVERIFIED** live.
- **Recommended fix:** Saturate unread at "99+" with a bounded subquery (`LIMIT 100`), or maintain per-membership unread counters; paginate Explore with a `(name, id)` cursor and fetch viewer flags for the returned page only.
- **Estimated effort:** M (2–3d).
- **Blocks production:** No.

#### AUD-15 — RSVP capacity check-then-insert race and full-row counts

- **Severity:** P2 · **Category:** Database / Correctness
- **Description:** The RSVP route counts capacity by selecting **all** `event_rsvps` rows for the event, then inserts. There is no transaction, row lock or database constraint. Two concurrent "going" taps for the last seat both pass the check, overselling the event. A double-tap hits the primary key and returns a 500 instead of being idempotent. The response count and the un-RSVP count also fetch every row to call `.length`.
- **Impact:** Oversold events, opaque 500s on double taps, and O(attendees) reads per RSVP toggle. At 5k attendees this is the hottest event write path.
- **Evidence:** `apps/web/app/api/communities/[id]/events/[eventId]/rsvp/route.ts:105,114-127,180`.
- **Repro:** Fire two concurrent RSVP requests at `max_attendees-1`; both return 200 and the count exceeds the limit.
- **Recommended fix:** One SQL function: `insert … on conflict do nothing` under a `SELECT … FOR UPDATE` on the event row or an advisory lock, returning `count(*)` from the same statement; add a trigger/constraint enforcing capacity; make repeats idempotent.
- **Estimated effort:** S–M (1d).
- **Blocks production:** No.

#### AUD-16 — Single hot-community Durable Object ceiling (~2,500–4,000 sockets)

- **Severity:** P2 · **Category:** Realtime / Scalability
- **Description:** Presence is fixed (count-only, 256-send lap budget), but one Room DO still owns every socket in a community. The re-measured staging ladder shows 2,500 stable, 4,000 with the DO replaced mid-publish, and 5,000 with the DO reset mid-ramp (4,750 connected, 1,500 survived); the 5,000-socket control spread over 5,000 rooms passed. No sharding/directory-DO partition exists.
- **Impact:** A community above ~2.5–4k concurrently connected members has a realtime availability ceiling. The failure is structural (instance replacement), not an application error, and affects every member of that community.
- **Evidence:** `docs/realtime-presence-scaling.md:267-278,332-337`; `apps/realtime/src/room.ts` (one Room per community, no partition).
- **Repro:** `TOTAL_CLIENTS=5000 node k6/loadtest-5k.mjs` against staging (script refuses non-staging).
- **Recommended fix:** Partition hot communities across multiple Room DOs behind a directory/coordinator; define subscription routing, presence aggregation across partitions and message ordering; keep the current single-DO path for small rooms. Until then, document a hard per-community live-socket cap and degrade gracefully.
- **Estimated effort:** XL (multi-week architecture change).
- **Blocks production:** No at current scale; gate for large communities.

#### AUD-17 — Push fan-out is bounded but not durable

- **Severity:** P2 · **Category:** Reliability / Push
- **Description:** Chat push fan-out now dedupes recipients, batches, parallelises, retries 429/5xx with backoff, respects a 20 s `PUSH_TIME_BUDGET_MS` and a 10,000-delivery cap, and logs a `ChatPushReport`. It is still best-effort inside `after()`: there is no persisted job/queue, no retry after the request ends, and recipients beyond the cap/time budget are left untouched.
- **Impact:** For communities above the budget/cap, a message can silently reach only part of the membership. The report is logged, not stored or alerted on.
- **Evidence:** `apps/web/lib/push/chat.ts:101-102,257-282,637,682-690`; no `push_jobs` table or Queue binding in the baseline/wrangler configs.
- **Repro:** Simulate a 15k-recipient community with a slow Expo endpoint; observe `truncated: "deliveries"|"time"` in logs.
- **Recommended fix:** Persist the report (and/or a `push_jobs` table), alert when truncated, and move fan-out to Cloudflare Queues or a cron drain when any community exceeds the bound.
- **Estimated effort:** M–L (2–5d).
- **Blocks production:** No, but before large communities.

#### AUD-18 — No durable realtime event replay

- **Severity:** P2 · **Category:** Realtime / Reliability
- **Description:** Publish fan-out retries transient failures three times with a stable `event_id`, and the DO dedupes replays. There is no persisted per-room cursor or replay-on-subscribe. An outage longer than the retry budget loses the event for an offline/live client; recovery relies on the client's next reconnect/focus/visibility catch-up reading the database.
- **Impact:** A connected client on a flaky link can miss a message until it refocuses or reconnects. This is a documented boundary, not an accidental bug, but it is a real gap for kiosk-like or long-lived connections.
- **Evidence:** `apps/realtime/src/index.ts:35-48` (durability boundary comment); `apps/realtime/src/event-dedupe.ts`; no client cursor in `apps/realtime`.
- **Repro:** Stop the room DO / block publishes for >retry budget; the client receives nothing until its next catch-up trigger.
- **Recommended fix:** Add a persisted room event cursor and replay-on-subscribe (`?after=`), or make the client's catch-up interval bounded and guaranteed independent of visibility.
- **Estimated effort:** L (3–5d).
- **Blocks production:** No.

#### AUD-19 — CSP is report-only with `unsafe-inline`/`unsafe-eval`; cookie is parent-domain

- **Severity:** P2 · **Category:** Security / Headers
- **Description:** The app ships `Content-Security-Policy-Report-Only` with `script-src 'self' 'unsafe-inline' 'unsafe-eval'` and no enforcing policy. The session cookie is scoped to `.uxcommunity.in`, so every subdomain (including the marketing site) receives it. The origin check prevents cross-origin *use*, but any subdomain XSS/takeover can overwrite or clear the cookie (session fixation/logout DoS) and receives it on every request.
- **Impact:** CSP provides no actual blocking; broad cookie scope increases the blast radius of any subdomain compromise.
- **Evidence:** `apps/web/next.config.js:69-84`; `apps/web/lib/auth/cookie-domain.ts:8-18`; `apps/web/lib/security/request-origin.ts:57-70`.
- **Repro:** Inspect response headers on the live app — **UNVERIFIED** live, but the config is explicit.
- **Recommended fix:** Move to a nonce-based enforcing CSP after testing; prefer a host-only app cookie and a short-lived realtime token/handshake header instead of a parent-domain session cookie.
- **Estimated effort:** M (1–2d).
- **Blocks production:** No, but security hardening before GA.

#### AUD-20 — No error tracking and no alerting on application metrics

- **Severity:** P2 · **Category:** Observability
- **Description:** Structured `logEvent` lines, `Server-Timing` headers and `/stats` counters exist, and the dependency monitor emails on R2/Supabase/realtime/Resend outages. But there is no Sentry/error tracker, no log scraping, no dashboard, and nothing pages on the named failure events (`push.*`, `realtime.membership.check_failed`, `api.timing`) or on the two new counters.
- **Impact:** Application exceptions and slow routes are only visible if someone reads Worker logs. Error budgets cannot be monitored; alerting covers dependencies, not the app.
- **Evidence:** `apps/web/lib/observability/log.ts:32`; `apps/realtime/src/alert-monitor.ts` (dependency health only); no Sentry/OTel dependency in `apps/web/package.json`.
- **Repro:** Throw an unhandled API error; nothing is alerted.
- **Recommended fix:** Add error tracking (Sentry/Cloudflare Logpush + alert), scrape `/stats` and `api.timing` into a small metrics sink, and alert on error rate/latency SLOs.
- **Estimated effort:** M (2–4d).
- **Blocks production:** No, but strongly recommended before GA.

#### AUD-21 — Member search is `ILIKE '%term%'` with no index, and pages by OFFSET

- **Severity:** P2 · **Category:** Database / Scalability
- **Description:** `get_community_members_page` filters `u.name ILIKE '%' || v_search || '%'`; `users` has no index on `name` (only email/blocked/suspended/verification). The non-search page is well indexed, but any search seq-scans `users` and joins. Pagination uses an unbounded OFFSET, so deep pages walk the offset.
- **Impact:** Member search becomes a full scan of the user table. A 100k-member community's page 3,000 walks 90k index entries per request.
- **Evidence:** baseline `:4976-5016`; user indexes `:2179-2185`; search call `apps/web/app/api/communities/[id]/members/route.ts:50-56`.
- **Repro:** `EXPLAIN` a search for a common name — **UNVERIFIED** live.
- **Recommended fix:** Add `pg_trgm` GIN on `users.name` (extension is installed) and/or switch to prefix search; replace OFFSET with a `(role_rank, joined_at, user_id)` cursor.
- **Estimated effort:** M (1–2d).
- **Blocks production:** No.

#### AUD-22 — Media and long lists are unoptimised on web

- **Severity:** P2 · **Category:** Frontend / Performance
- **Description:** There are zero `next/image` imports despite the configured image loader; 61 raw `<img>` occurrences (only 19 lazy) render originals stored up to 2560 px at q90 WebP in a ~40 rem column with no `srcset` or intrinsic dimensions. Chat and DM message lists map every loaded row with no virtualisation (catch-up can retain ~1,000 rows); `MessageBubble` is memoised but layout cost remains.
- **Impact:** Feed/DM users download 2–4× the pixels they display, incur CLS on feed/thread cards, and long chat sessions degrade on weak devices.
- **Evidence:** no `next/image` imports; `apps/web/components/communities/CommunityDp.tsx:51-59`, `threads/ThreadCard.tsx:595`, `events/EventCard.tsx:575`; `lib/image-geometry.ts:14-17`; `components/communities/chat/MessageList.tsx:292-325`; `useChatData.ts:33,50`.
- **Repro:** Load the feed on a throttled connection and inspect transferred image bytes vs rendered size.
- **Recommended fix:** Use `next/image` or a width-transform for feed/thread/showcase media with explicit aspect boxes; window the chat/DM timeline or cap retained rows behind "load earlier".
- **Estimated effort:** M (2–4d).
- **Blocks production:** No.

#### AUD-23 — The service-role key is used for every database query; RLS is not a backstop

- **Severity:** P2 · **Category:** Architecture / Security
- **Description:** Every API route and server component uses the Supabase service-role client, which bypasses RLS. The baseline correctly revokes `anon`/`authenticated` grants and enables RLS, but the application never uses those roles. Authorization therefore depends entirely on 195 route handlers and the `lib` functions they call.
- **Impact:** A single missing membership/ownership check is a direct data breach; there is no second line of defence. The codebase's route-audit test is the main guard.
- **Evidence:** `apps/web/lib/supabase/service.ts:27-35`; baseline RLS/grants (all tables revoked from anon/authenticated); `apps/web/lib/auth/session-route-audit.test.ts` invariant.
- **Repro:** Static: `grep -rn "createServiceClient" app/api | wc -l` — used across the API.
- **Recommended fix:** For the highest-risk domains (DM, reports, private files), consider scoped database roles/RLS policies so a missing route check fails closed; at minimum, encode the access rules in a small number of shared, tested `lib` functions (already partly done) and add route-level authorization tests.
- **Estimated effort:** L (3–5d).
- **Blocks production:** No, but the architecture's largest security assumption.

#### AUD-24 — Account deletion can be blocked by `company_domain_reviews.reviewer_id`

- **Severity:** P2 · **Category:** Database / Data lifecycle
- **Description:** `company_domain_reviews.reviewer_id` references `users(id)` with the default `NO ACTION`. `deleteAccountCascade` deletes the `users` row and relies on cascades/triggers; no step reassigns or deletes reviews. A user who has reviewed a company domain cannot be deleted (`23503` foreign-key violation), contradicting the deletion audit's claim that everything else cascades.
- **Impact:** Admin/operator accounts that reviewed domains are undeletable through both the member and admin deletion paths; the error surfaces as a generic 500.
- **Evidence:** baseline `:1606`; `apps/web/lib/account/delete.ts:99-113`; no `company_domain_reviews` handling in `delete.ts`.
- **Repro:** Insert a review for a user, call `DELETE /api/admin/users/<id>` → FK violation — **UNVERIFIED** live.
- **Recommended fix:** Make `reviewer_id` nullable with `ON DELETE SET NULL` (preserving the decision), or reassign reviews to a system/admin account before deletion; add a deletion test for a reviewer account.
- **Estimated effort:** S (2–4h + migration).
- **Blocks production:** No.

#### AUD-49 — No server-side per-user socket cap or connection rate limit

- **Severity:** P2 · **Category:** Realtime / Abuse
- **Description:** The Worker authenticates every WebSocket upgrade and the Room DO accepts every authenticated member's socket; the only socket cap is client-side (web's `SIDEBAR_REALTIME_LIMIT` and mobile's `COMMUNITY_REALTIME_LIMIT`). A single valid session can open an arbitrary number of sockets to one community, each consuming DO memory/connection state and each triggering the internal session-validation call. At the measured 2,500–4,000-socket room ceiling, one authenticated attacker can push a hot community over the edge.
- **Impact:** A cheap, authenticated denial of service against any community room; memory/connection pressure and extra web-API load. No unauthenticated access is gained.
- **Evidence:** `apps/realtime/src/index.ts:173-294` (upgrade accepts after auth + registry validation, no cap); `apps/realtime/src/room.ts:200-248` (no per-user socket limit); client caps only in `apps/web/lib/realtime/client.ts` and `expo-app-standalone 3/lib/realtimeWindow.ts:49`.
- **Repro:** With one member session, open 4,000 sockets to `chat:<communityId>`; observe the DO replacement/reset documented in `docs/realtime-presence-scaling.md`.
- **Recommended fix:** Enforce a per-user (and per-session) socket cap per room in the DO, with eviction of the oldest socket; add a per-IP/per-user upgrade rate limit at the Worker; expose both counters in `/stats`.
- **Estimated effort:** S–M (1d).
- **Blocks production:** No at current scale; important before large communities.

#### AUD-50 — Removing a member does not terminate their live community socket

- **Severity:** P2 · **Category:** Realtime / Authorization
- **Description:** Community membership is checked only when the WebSocket upgrades (`room.ts:209-219`). Removing a member (self-leave, owner removal, admin removal, ban) deletes the `community_members` row and permission grants, but no call tells the Room DO to close that user's socket. The removed member's existing socket stays subscribed and keeps receiving new chat/content events until the client disconnects or the session itself is revoked. The API correctly blocks their writes, so this is a read-only confidentiality gap.
- **Impact:** A removed or banned member can keep reading a private community's realtime chat indefinitely on an open tab/app. The window is as long as the socket lives (mobile can keep it for days), not the 60 s membership cache.
- **Evidence:** `apps/realtime/src/room.ts:209-219` (membership only at upgrade); `apps/web/app/api/communities/[id]/members/[userId]/route.ts:138-160` (membership delete, no realtime call); `apps/web/lib/realtime/revoke.ts` only closes by session selector, not by room membership.
- **Repro:** Join a community, open chat, have the owner remove you; new messages continue to arrive on the existing socket.
- **Recommended fix:** Add a room-scoped revocation path: on membership removal/ban, call the Room DO's `/revoke` with the user's id and close their sockets for that room only (keep the session valid for other communities). Add a test that removal stops fan-out immediately.
- **Estimated effort:** S (2–4h).
- **Blocks production:** No, but important for private communities.

### P3

#### AUD-25 — Sub-entity comment rooms skip membership authorization

- **Severity:** P3 · **Category:** Realtime / Authorization
- **Description:** `thread-comments:*` and `resource-comments:*` rooms deliberately skip `checkMembership` because the room name has no community ID. Any authenticated member who knows a thread/resource UUID can open a socket to that room and receive its publish events. Those events carry only `{ user_id }` / `{ user_id, reaction }` nudges; comment content is still gated by the HTTP API, so the leak is activity metadata rather than content.
- **Impact:** Activity and commenter IDs for private-community threads/resources can be observed by a removed or unrelated member; no content disclosure verified.
- **Evidence:** `apps/realtime/src/room.ts:209-219`; publish payloads in `app/api/communities/[id]/threads/[threadId]/comments/route.ts:160-164` and resource equivalent.
- **Repro:** Connect to `wss://rt.../ws?room=thread-comments:<known-uuid>` as a non-member; post a comment; receive the nudge.
- **Recommended fix:** Resolve the parent community for these rooms (join the comment row or store a community segment in the room name) and run the same membership check; or include the community in the room name (`thread-comments:<communityId>:<threadId>`).
- **Estimated effort:** S (2–4h).
- **Blocks production:** No.

#### AUD-26 — Admin image upload trusts declared MIME and stores SVG publicly

- **Severity:** P3 · **Category:** Media / Security
- **Description:** `/api/admin/upload` allows `image/svg+xml`, validates only `file.type`, derives the extension from it, and uploads with the declared Content-Type. No magic-byte sniffing (contrast member uploads). A script-bearing SVG is stored in the public bucket and served as `image/svg+xml`.
- **Impact:** Admin-only; practical risk is a rogue/compromised admin hosting active content under a trusted domain, plus arbitrary bytes stored with an image type.
- **Evidence:** `apps/web/app/api/admin/upload/route.ts:7,24,37-41`.
- **Repro:** Upload an SVG with a `<script>`; open its R2 URL.
- **Recommended fix:** Sniff with `detectImageMime`; drop SVG or sanitize/reject script/event attributes; store with a canonical content type.
- **Estimated effort:** XS–S (1h).
- **Blocks production:** No.

#### AUD-27 — Signup avatar accepts any existing key; pending avatars are never reclaimed

- **Severity:** P3 · **Category:** Media / Abuse
- **Description:** `signup/avatar` accepts a client-provided `avatar_url` if it parses as a key on the media bucket; it is not scoped to the `avatars/pending/<uuid>` object the flow just issued. Separately, `signup/picture` writes pending avatars with no cleanup path; 20 uploads/h/IP × 3 MB become permanent orphan public objects.
- **Impact:** A new account can point its avatar at another member's photo or a master-data asset (impersonation/cosmetic), and unauthenticated uploads accumulate storage.
- **Evidence:** `apps/web/app/api/signup/avatar/route.ts:82,113`; `signup/picture/route.ts:56`; no cleanup reference to `avatars/pending/`.
- **Repro:** Complete signup with `avatar_url` set to another member's avatar key.
- **Recommended fix:** Bind the accepted key to the pending media id/UUID issued to this signup attempt; add pending-avatar orphans to the R2 sweep.
- **Estimated effort:** S (2–4h).
- **Blocks production:** No.

#### AUD-28 — `image-download` accepts any `*.r2.dev` / `*.supabase.co` host and buffers unbounded bodies

- **Severity:** P3 · **Category:** Security / SSRF / Memory
- **Description:** The authenticated download proxy allows any host ending in `.r2.dev` or `.supabase.co`, follows no redirects, echoes the upstream Content-Type and buffers the whole body with `arrayBuffer()` and no size cap or read timeout.
- **Impact:** Any Cloudflare user can host content under `*.r2.dev` and have the app serve it from its own trusted origin; a multi-GB object can exhaust the 128 MB Worker and cause 1102 errors.
- **Evidence:** `apps/web/app/api/image-download/route.ts:25,61,70,75`.
- **Repro:** Pass a URL to a large object on an arbitrary r2.dev bucket.
- **Recommended fix:** Accept only keys/URLs on the project's own bucket (use `getR2KeyFromUrl`), cap Content-Length (e.g. 25 MB), stream the body, and allowlist image content types.
- **Estimated effort:** S (2–3h).
- **Blocks production:** No.

#### AUD-29 — Push token upsert can reassign another device's token

- **Severity:** P3 · **Category:** Security / Push
- **Description:** `push_tokens` is upserted on `token` alone. A member who learns another device's Expo token can re-point it to their own `user_id` and receive that device's notifications (or suppress the original owner's).
- **Impact:** Requires a leaked token; impact is notification redirection/privacy.
- **Evidence:** `apps/web/app/api/push/register/route.ts:63-71`.
- **Repro:** Register a token already owned by another user; observe the owner change.
- **Recommended fix:** Key ownership by `(user_id, token)` or refuse to reassign a token owned by another user without an explicit device-unregister.
- **Estimated effort:** S (1–2h + migration).
- **Blocks production:** No.

#### AUD-30 — Internal endpoint secrets compared with plain `===`

- **Severity:** P3 · **Category:** Security / Timing
- **Description:** Several internal endpoints compare `Authorization` to `Bearer <secret>` with `===`; the repo already ships `secureEqual` used for admin login.
- **Impact:** Theoretical remote timing recovery of a high-entropy secret; low practical risk, but inconsistent with the project's own standard.
- **Evidence:** `app/api/internal/session/validate/route.ts:22`; `internal/event-notifications/route.ts:25`; `internal/community-message-retention/route.ts:36`; `internal/dependency-health/route.ts:37`; `internal/verification-reapply/route.ts:18`; `communities/[id]/members/[userId]/check/route.ts:38`.
- **Repro:** Static.
- **Recommended fix:** Use `secureEqual` on the full header or the token portion.
- **Estimated effort:** XS (30m).
- **Blocks production:** No.

#### AUD-31 — Raw PostgREST errors returned to members

- **Severity:** P3 · **Category:** Security / Error handling
- **Description:** Several event/comment routes return `{ error: error.message }` from PostgREST, leaking table/column/constraint names and hints.
- **Impact:** Information disclosure useful for targeted abuse; inconsistent with neighbouring routes that log and return generic strings.
- **Evidence:** `app/api/communities/[id]/events/route.ts:220`; `events/[eventId]/route.ts:182`; `events/[eventId]/comments/route.ts:42,126`; `comments/[commentId]/route.ts:32`; `app/api/communities/all/route.ts:33-43` also returns the raw Supabase `code/message/details/hint` object to the member on a 500.
- **Repro:** Trigger a unique/FK violation and read the response.
- **Recommended fix:** Log the error server-side; return a generic message.
- **Estimated effort:** XS (30m).
- **Blocks production:** No.

#### AUD-32 — Admin list search strings are interpolated into PostgREST `or()` filters

- **Severity:** P3 · **Category:** Security / Input handling
- **Description:** Admin list endpoints build `name.ilike.%${search}%,email.ilike.%${search}%` strings. `,`, `(`, `)` and `%` enter PostgREST's filter grammar. Admin-only, so the realistic impact is filter rewriting/DoS, not privilege escalation.
- **Impact:** Self-inflicted broken/expensive queries by an admin searching with crafted input.
- **Evidence:** `app/api/admin/users/route.ts:32`; `admin/jobs/route.ts:56,61,71`; `admin/events/route.ts:52,63`; `admin/signup-attempts/route.ts:33`; `admin/dm-reports/route.ts:47`; `admin/reports/route.ts:66`.
- **Repro:** Search `x,or(id.neq.0)` in the admin users box.
- **Recommended fix:** Strip `,()%` or issue two `.ilike()` queries and merge.
- **Estimated effort:** S (1–2h).
- **Blocks production:** No.

#### AUD-33 — Community hard delete orphans event rooms

- **Severity:** P3 · **Category:** Database / Data lifecycle
- **Description:** `communities.event_id` is `ON DELETE SET NULL`. Deleting a community cascades `community_events`, which nulls the event room's `event_id` instead of deleting the room. The event-deletion service unlinks/cleans rooms, but a community cascade bypasses it. Event rooms and their members/messages survive forever.
- **Impact:** Dead event rooms in members' sidebars, orphan memberships and wasted storage; no way to find them except a manual audit.
- **Evidence:** baseline `:1540`; no trigger on `community_events` delete; admin delete `app/api/admin/communities/[id]/route.ts:197-206`.
- **Repro:** Create community + event with chat; delete the community via admin; query `communities where type='event' and event_id is null`.
- **Recommended fix:** Add a `BEFORE/AFTER DELETE` trigger on `community_events` that deletes (or marks deleted) its room; or delete rooms explicitly before the community cascade.
- **Estimated effort:** S (2–4h + migration).
- **Blocks production:** No.

#### AUD-34 — Global fetch guard collapses `read`/`mark-read` mutations by URL, dropping newer watermarks

- **Severity:** P3 · **Category:** Frontend / Correctness
- **Description:** `TOGGLE_PATH` includes `read` and `mark-read`; those mutations use `cooldownMode: "url"`, which replays the previous response for any same-URL request within 2 s regardless of body. `PATCH /api/dm/conversations/:id/read` sends `{ last_read_at }`; a newer timestamp inside the window never reaches the server. The community read route is a body-less timestamp so it is idempotent, but DM is not.
- **Impact:** Unread badges can remain until the next read; a read receipt can be lost.
- **Evidence:** `apps/web/lib/global-fetch.ts:44,98`; `apps/web/lib/dedupe-fetch.ts:124-149,196`; `app/api/dm/conversations/[id]/read/route.ts:8`.
- **Repro:** Call DM mark-read twice within 2 s with increasing timestamps; only the first request hits the network.
- **Recommended fix:** Remove `read`/`mark-read` from URL-mode (use exact-body mode) or make the server use `greatest()` and accept the collapse as safe.
- **Estimated effort:** XS (30m).
- **Blocks production:** No.

#### AUD-35 — "Mark all notifications read" selects and publishes per row

- **Severity:** P3 · **Category:** Performance / API
- **Description:** The bulk-read route selects every unread notification, updates them, then publishes one realtime event per row. A member returning after a month with thousands of unread gets thousands of rows and messages.
- **Impact:** Large payloads and fan-out for a single click; unnecessary DB transfer.
- **Evidence:** `apps/web/app/api/notifications/route.ts:67-113`.
- **Repro:** Seed 3k unread notifications and click "mark all read".
- **Recommended fix:** `UPDATE … RETURNING count` only; publish one `{type:'bulk-read'}` event; paginate the historical list.
- **Estimated effort:** S (2–3h).
- **Blocks production:** No.

#### AUD-36 — Community read watermark can move backwards

- **Severity:** P3 · **Category:** Database / Concurrency
- **Description:** `PATCH /api/communities/:id/read` reads the previous watermark, then writes `new Date()` from the app clock with no `greatest()` and no transaction. A delayed/retried request can move it backwards, resurrecting unread counts; clock skew has the same effect. DM read correctly uses `greatest()` server-side.
- **Impact:** Occasional inflated unread counts; no data loss.
- **Evidence:** `apps/web/app/api/communities/[id]/read/route.ts:31-52`; contrast baseline `:7288-7330` (`mark_dm_conversation_read`).
- **Repro:** Send two reads out of order (older after newer).
- **Recommended fix:** One `UPDATE … SET last_read_at = greatest(coalesce(last_read_at, joined_at), now()) … RETURNING`.
- **Estimated effort:** XS (30m).
- **Blocks production:** No.

#### AUD-37 — DM list is capped at 200; job applicants are unbounded

- **Severity:** P3 · **Category:** Scalability / API
- **Description:** `get_dm_conversations` has a hard `limit 200` with no cursor/`has_more`, silently hiding conversations beyond 200. `get_job_applicants` has no LIMIT or pagination, returning every applicant (with URLs) for a popular job.
- **Impact:** Silent data omission for heavy DM users; large payloads/queries for popular jobs.
- **Evidence:** baseline `:5228-5318` (`limit 200`), `:5928` (`get_job_applicants`).
- **Repro:** Seed 250 DM conversations; the 50 oldest never appear.
- **Recommended fix:** Keyset cursor on `last_message_at`; paginate applicants and cache counts.
- **Estimated effort:** M (1d).
- **Blocks production:** No.

#### AUD-38 — Report tables lack plain reporter indexes; duplicate indexes add write amplification

- **Severity:** P3 · **Category:** Database / Performance
- **Description:** Account deletion runs `UPDATE … WHERE reporter_id = ?` on `interaction_reports`, `content_reports`, `dm_reports`; each table only has a *partial* unique index `WHERE status='pending'`, which cannot serve an unfiltered lookup. Separately, `community_messages` has three near-identical `(community_id, created_at…)` indexes plus a standalone `created_at`; `event_saves` has three indexes on the same columns; `thread_saves` has two.
- **Impact:** Every account deletion scans three report tables and holds locks; every chat message pays ~4 index writes.
- **Evidence:** baseline `:2853-2881` (anonymisation), `:2024,2054,2096` (partial indexes), `:1926-1940`, `:2065-2073`, `:2216-2220`.
- **Repro:** `EXPLAIN` the delete trigger query; inspect `pg_stat_user_indexes`.
- **Recommended fix:** Add btree `(reporter_id)` on the three report tables; drop redundant indexes after checking `idx_scan`.
- **Estimated effort:** S (2–4h + migration).
- **Blocks production:** No.

#### AUD-39 — Type-safety and lint debt

- **Severity:** P3 · **Category:** Code quality / Maintainability
- **Description:** 249 `any`/unsafe-cast occurrences in non-test web code and 632 `eslint-disable`/`ts-ignore`/`ts-expect-error` comments. `strict` is on and the build blocks type errors, so this is not a correctness failure today, but it weakens the compiler where explicit types were bypassed. ESLint is advisory and carries 43 pre-existing errors (`react-hooks/set-state-in-effect` 28, `no-unescaped-entities` 6, `refs` 5, `immutability` 4).
- **Impact:** Higher regression risk in refactors; lint cannot be made blocking until the existing debt is cleared.
- **Evidence:** measured counts (`grep`/`rg`), `apps/web/tsconfig.json` (`strict: true`), `.github/workflows/ci.yml` lint job (`continue-on-error: true`).
- **Repro:** `grep -rn ": any\\|<any>\\|as any" apps/web --include='*.ts*' | wc -l`.
- **Recommended fix:** Burn down `any` in domain models/RPC results first; make ESLint blocking after the hook-rule cleanup; pin `eslint-config-next`.
- **Estimated effort:** L (3–5d).
- **Blocks production:** No.

#### AUD-40 — Unused dependencies and unnecessary Android permissions

- **Severity:** P3 · **Category:** Dependencies / Mobile
- **Description:** Web lists `@ffmpeg/ffmpeg`, `@ffmpeg/util` and `@lottiefiles/dotlottie-react` with no import sites. Mobile lists `expo-location` (no imports), `@expo-google-fonts/inter`, `expo-blur`, `zod` and an unrelated `start@^5.1.0` package; the manifest requests location/audio/overlay/storage permissions accordingly.
- **Impact:** Larger attack surface and bundle, unnecessary user-facing permission prompts, supply-chain risk from an unrelated package.
- **Evidence:** `apps/web/package.json` dependencies; `expo-app-standalone 3/package.json`; `AndroidManifest.xml:2-13`.
- **Repro:** `grep -rl "<dep>" app components lib` → zero for the listed packages.
- **Recommended fix:** Remove unused packages and permissions; add a dependency-review step.
- **Estimated effort:** S (1–2h).
- **Blocks production:** No.

#### AUD-41 — Documentation drift

- **Severity:** P3 · **Category:** Documentation / Maintainability
- **Description:** README says Next.js 14 and 187 API routes; the app uses Next 16.4.3 and 195 routes. `docs/mobile-architecture.md:184` still shows `?token=<jwt>` even though clients now send the cookie header, and `audit/SESSION_REVOCATION_*.md` still describe a 7-day user token while the current policy is 365 days with sliding renewal. Database docs disagree on whether production adoption happened: `docs/database-baseline.md:191` says "NOT EXECUTED", `docs/database-adoption-review.md:3` and `docs/DEPLOYMENT.md:60` say completed 2026-11-03, and `docs/database-verification.md:115` says not performed.
- **Impact:** Reviewers and operators can make wrong assumptions about release safety and transport auth; a mistaken belief about ledger adoption can stall or mis-run a deploy.
- **Evidence:** `README.md:27,50`; `docs/mobile-architecture.md:184`; the three database docs above; actual `apps/web/package.json` (`next ^16.4.3`).
- **Repro:** Read the cited lines.
- **Recommended fix:** One dated status section per doc; state the ledger digest/capture timestamp; correct the Next version/route count, the WS transport description and the session-lifetime claim.
- **Estimated effort:** XS–S (1–2h).
- **Blocks production:** No.

#### AUD-42 — Accessibility and UX polish gaps

- **Severity:** P3 · **Category:** UI/UX / Accessibility
- **Description:** `Modal` sets `role="dialog"` but never moves focus in, traps Tab, restores focus or links `aria-labelledby`; Explore cards are `<div onClick>` with no role/tabIndex/key handler; there is no skip-to-content link; the login page shows a disabled "Continue with Google (coming soon)"; the GIPHY picker shows developer copy ("Set a `GIPHY_API_KEY` env var"); `ConfirmDialog` says "Deleting…" for positive actions; Explore's lock reason map is empty and its explanation appears only on hover.
- **Impact:** Keyboard/screen-reader users cannot operate dialogs/cards reliably; dead controls and developer copy reduce product trust.
- **Evidence:** `components/ui/Modal.tsx:97-143`; `app/dashboard/communities/page.tsx:64-73,109-131`; `app/login/LoginForm.tsx:161-170`; `components/communities/chat/EmojiGifPicker.tsx:64-72`; `components/ui/ConfirmDialog.tsx:72`.
- **Repro:** Tab through a dialog; tab to an Explore card.
- **Recommended fix:** Adopt the `PhotoViewer` focus pattern in `Modal`; make cards real links/buttons; hide unshipped controls; replace developer copy; add `pendingLabel`; add a skip link.
- **Estimated effort:** M (1–2d).
- **Blocks production:** No.

#### AUD-43 — No SEO metadata, robots or sitemap; auth pages indexable

- **Severity:** P3 · **Category:** SEO / Frontend
- **Description:** No `app/sitemap.ts`, `app/robots.ts` or `public/robots.txt`; only `/appeals/[token]` is `noindex`. `/login` has no metadata and `/signup` is a client component that cannot export it, so both inherit the marketing title and are indexable. `/` redirects anonymous visitors to `/login`.
- **Impact:** Search engines can index auth screens and see no public landing content; the product has no crawlable surface.
- **Evidence:** absence of the files; `app/login/page.tsx`; `app/signup/page.tsx:1`; `app/page.tsx:4-9`.
- **Repro:** Request `/robots.txt` → 404.
- **Recommended fix:** Add `robots.ts` disallowing `/dashboard`, `/admin`, `/login`, `/signup`; add `noindex` to auth/utility routes; decide whether `/` should be a public landing page.
- **Estimated effort:** S (2–3h).
- **Blocks production:** No.

#### AUD-44 — WebSocket server still accepts a JWT in the query string

- **Severity:** P3 · **Category:** Security / Realtime
- **Description:** Clients stopped putting the JWT in the URL (web sends the cookie; mobile sends the cookie as a handshake header), but the Worker still accepts `?token=<JWT>` as a fallback for old clients.
- **Impact:** Legacy clients leak a long-lived credential into access logs — member tokens are valid for **365 days** and slide forward while used (`lib/auth/session-lifetime.ts:9-13`; the older audit docs still say 7 days). Registry revocation limits the damage, but a captured URL token remains usable until the session is revoked. No current client needs the fallback.
- **Evidence:** `apps/realtime/src/index.ts:180-183`; mobile `lib/realtimeCore.ts:125-129` and `lib/realtime.ts:66-89`.
- **Repro:** Connect with `?token=`; the handshake succeeds.
- **Recommended fix:** Remove the query-token fallback after the minimum supported mobile version no longer uses it; log a deprecation counter in the meantime.
- **Estimated effort:** XS (30m) after client sunset.
- **Blocks production:** No.

#### AUD-45 — Two high-severity dependency advisories

- **Severity:** P3 · **Category:** Dependencies
- **Description:** `npm audit --omit=dev` reports 2 high and 4 low advisories: `source-map-js` event-loop DoS via indexed source-map section offsets (fix available), and `zod` memory exhaustion while validating oversized constrained collections (fix requires zod 4, a major upgrade). Both are in the production tree.
- **Impact:** Low practical exploitability in this app (source maps are build-time; JSON bodies are already parsed before zod), but the advisories are real and the zod fix is a major upgrade that should be planned.
- **Evidence:** `npm audit --omit=dev` on the audited revision.
- **Repro:** `npm audit --omit=dev`.
- **Recommended fix:** Apply the `source-map-js` patch; plan the zod 4 migration and test all validation schemas.
- **Estimated effort:** S (zod 4: M).
- **Blocks production:** No.

#### AUD-46 — Non-transactional multi-step writes

- **Severity:** P3 · **Category:** Database / Correctness
- **Description:** Community creation inserts the community, then the owner membership, then compensates by deleting on failure; a crash between steps leaves a zero-member community. Member removal deletes permissions then membership then writes the audit. These are not wrapped in an RPC/transaction.
- **Impact:** Rare partial states; the same class of bug the job-apply path already solved with `apply_to_job`.
- **Evidence:** `apps/web/app/api/communities/route.ts:119-171`; `app/api/communities/[id]/members/[userId]/route.ts:139-160`.
- **Repro:** Fail the second insert (simulate) and inspect the community row.
- **Recommended fix:** Move creation/removal into SQL functions with a single transaction.
- **Estimated effort:** M (1d).
- **Blocks production:** No.

#### AUD-47 — One-shot login/community backfill migration is a single long transaction

- **Severity:** P3 · **Category:** Database / Operations
- **Description:** `20261104001500_login_dashboard_performance.sql` selects every `designer_profiles` row with `communities_auto_joined=false FOR UPDATE`, then creates/upserts up to four communities and inserts up to four memberships per profile in one migration transaction. At 100k users that is up to 400k membership inserts plus member-count increments against a few hot community rows, all in the deploy path.
- **Impact:** Long locks, large WAL and a slow release when the user base grows; currently cheap because production is small.
- **Evidence:** migration lines 39-82; deploy applies migrations before worker release (`deploy.yml:309-330`).
- **Repro:** Run the migration against a synthetic 100k-profile database — **UNVERIFIED**.
- **Recommended fix:** Batch by user range with separate commits, or run it as a gated app-side backfill rather than a single migration.
- **Estimated effort:** M (1–2d).
- **Blocks production:** No at current scale.

#### AUD-48 — Event list `ORDER BY CASE` defeats its indexes

- **Severity:** P3 · **Category:** Database / Performance
- **Description:** `get_event_list_page` orders by `case when p_phase='upcoming' then e.event_date end`. Because `p_phase` is a parameter, the expression is not indexable; the planner sorts all of the community's events per page. The `(community_id, event_date, id)` indexes cannot supply the order.
- **Impact:** Large city communities sort thousands of rows for each tab; acceptable now, degrades at scale.
- **Evidence:** baseline `:5524-5563`; indexes `:1875-1879`.
- **Repro:** `EXPLAIN` both phases with 10k events — **UNVERIFIED**.
- **Recommended fix:** Two static `RETURN QUERY` branches (one per phase) so each can use the existing index.
- **Estimated effort:** S (2–3h).
- **Blocks production:** No.

---

## D. Architecture Assessment

### Current architecture

```
Browser / Expo app
  │
  ├─ HTTPS ──> Cloudflare Worker "uxcommunity-web" (OpenNext, Next 16 App Router)
  │              ├─ 195 route handlers + 72 pages/Server Components
  │              ├─ custom JWT session cookie (jose) + auth_sessions registry + session_version
  │              ├─ Supabase service-role client (RLS bypassed by design)
  │              ├─ R2 (S3 API): public media bucket + private bucket (signed GETs)
  │              ├─ Upstash Redis: sliding-window rate limits (fail-open)
  │              ├─ Resend: transactional email
  │              ├─ GIPHY: GIF proxy
  │              └─ Expo Push + FCM: background notifications
  │
  └─ WSS ───> Cloudflare Worker "uxcommunity-realtime"
                 ├─ Room DO per community (hibernation API, topic index)
                 ├─ UserDO per user (notifications/profile/DM multiplex; revocation registry)
                 ├─ AlertMonitor DO (cron dependency health)
                 ├─ POST /publish (shared secret) → fan-out
                 ├─ GET /stats (secret) → counters
                 └─ crons: 5 min health, 6 h retention, 1 min event lifecycle
```

**Data flow:** client → API route (session + membership/ownership + input validation) → Supabase RPC/table → optional realtime publish → Room/UserDO → subscribed sockets; a chat message POST also schedules push fan-out via `after()`/`waitUntil`. Clients treat the database as the source of truth and catch up on reconnect/focus.

### Important dependencies

Next 16.4.3, React 18.3.1, Supabase Postgres, Cloudflare Workers/Durable Objects/R2, Upstash Redis, Resend, Expo SDK 54 / React Native, FCM/Expo Push, GIPHY, jose, bcryptjs, Zod, AWS S3 SDK (R2 presigner), miniflare/vitest/tsx (tests).

### Architectural strengths

- Clear dependency direction in the domain layer (`lib/communities/models`, `membership`, `mark-read`), pure access-rule helpers, and generated database types.
- One realtime system for web and mobile; no Supabase Realtime; user-scoped rooms multiplex DM/notifications over one socket.
- Fail-closed and least-privilege decisions are explicit and tested: membership config, user-room name check, client publish allow-list, private-file access matrix, admin route audit.
- Environment isolation is real: local/staging/production URL and bucket assertions, deploy pipelines push the same membership secret to both Workers, Cloudflare credential/R2/FCM/service guards run before builds.
- Operational hooks exist: `/stats` counters, structured event logs, `Server-Timing`, dependency-health email alerts, migration-before-deploy ordering, deploy smoke tests.

### Architectural weaknesses

- **Service-role-only access** makes RLS decorative; the 195 route handlers are the entire authorization surface.
- **No queue/durable job layer**: push, retention, lifecycle and realtime fan-out are all best-effort request/`waitUntil` work. The cron Worker invokes the web app over HTTP, which is a single point of failure for background jobs.
- **Web/mobile duplication**: two API clients, two cache layers, two realtime clients and parallel domain helpers; no shared generated API contract.
- **Large route-handler surface**: 195 handlers with inconsistent validation (Zod in 14 routes) and repeated membership/ownership lookups.
- **Single hot-room DO** is a hard realtime scaling ceiling.
- **Supabase free/non-PITR** is the system of record but has no recoverable backup.

### Bottlenecks

| Time horizon | Bottleneck | Evidence |
|---|---|---|
| Current | Chat open duplicate read model; unoptimised media; sidebar queries | AUD-12, AUD-22, AUD-14 |
| ~1,000 users | Sidebar unread counts, RSVP counts, member search, push fan-out | AUD-14, AUD-15, AUD-21, AUD-17 |
| ~10,000 users | Home-feed scans, Explore unpaginated, single hot-room DO at ~2.5–4k sockets | AUD-13, AUD-14, AUD-16 |
| ~50,000 users | Supabase CPU/egress, missing trigram index, report/deletion scans, no sharding | AUD-13…AUD-24 |
| ~100,000+ | Cost (Upstash + DO duration dominate), no backups, no durable queues, mobile release ops | `docs/infrastructure-cost-audit.md`, AUD-01, AUD-17 |

### Infrastructure cost (verified model vs estimates)

The repository contains a code-derived cost model (`docs/infrastructure-cost-audit.md`, `scripts/cost-model.mjs`). Its outputs:

| Registered users | Modelled monthly bill | Cost/user | Largest driver |
|---:|---:|---:|---|
| 1,000 | ~$34 | $0.034 | Supabase Pro floor ($25) |
| 10,000 | ~$99 | $0.0099 | Durable Object duration + Upstash |
| 100,000 | ~$1,029 | $0.0103 | Upstash (~45%), DO duration (~33%) |
| 1,000,000 | ~$10,561 | $0.0106 | Upstash (~44%), DO duration (~32%) |

- **Verified facts:** current vendor prices and the actual request/publish/socket patterns are cited in the document; the unit cost is deliberately flattened at roughly one cent per registered user per month.
- **Estimates:** DO duration depends on assumed active hours per room per day (the least certain input); Upstash command counts depend on real traffic. These are explicitly labelled estimates in the source document.
- **Not in the bill today:** Cloudflare Images is configured but unused (`wrangler.toml` binding) — it bills $0 now and would be the largest dormant cost if `<Image>` were adopted; there is no queue service; Supabase PITR/backups are not purchased (which is exactly why AUD-01 exists).
- **Caveat:** the model is not a substitute for production billing data; no live usage figures were inspected in this audit.

### Recommended improvements

1. Backup/DR and a restore drill (P0).
2. Rotate exposed secrets and remove the artifact-secret class from the build pipeline (P1).
3. Fail-closed auth/abuse limits; add a boot-time Upstash check (P1).
4. Put realtime tests and the full web suite in the release path (P1).
5. One chat bootstrap loader; image transforms; list virtualisation (P2).
6. DB scale work: feed RPC split, unread saturation/counters, trigram search, RSVP SQL function, Explore pagination (P2).
7. Realtime partition design for hot communities; durable event replay (P2/L).
8. Push queue/report persistence (P2).
9. Error tracking + metrics alerting (P2).
10. Mobile release hardening: signing, versioning, permissions, backup rules, push detach, request timeouts (P1/P2).

---

## E. Security Assessment

### Verified vulnerability register

| ID | Severity | Finding | Status | Evidence |
|---|---|---|---|---|
| SEC-01 | P1 | Eight production credentials exposed in a local build artifact were still live at the last recorded check; rotation deferred | **Verified by documents; live status at the time of writing unverified** | `PRODUCTION_REMEDIATION_REPORT.md:158`; recorded credential inventory |
| SEC-02 | P1 | Rate limits fail open and can be absent in production | **Verified in code** | `lib/auth/rate-limit.ts:81-108` |
| SEC-03 | P2 | Member-controlled `javascript:` URL rendered as admin `href` | **Verified in code** | `api/profile/route.ts:92-93`; `UserInfoCard.tsx:73,91` |
| SEC-04 | P2 | Presigned video PUT accepts unbounded object size | **Verified in code** | `lib/r2.ts:257-269`; upload route |
| SEC-05 | P2 | Mobile push remains registered after implicit sign-out | **Verified in code** | `AuthContext.tsx:223-240,475-490` |
| SEC-06 | P2 | Android Auto Backup includes plaintext chat/auth caches | **Verified in code** | `AndroidManifest.xml:21`; chat cache |
| SEC-07 | P2 | CSP report-only with `unsafe-inline`/`unsafe-eval`; parent-domain cookie | **Verified in code** | `next.config.js:69-84`; `cookie-domain.ts:8-18` |
| SEC-08 | P2 | Service-role-only DB access; no RLS backstop | **Verified in code** | `lib/supabase/service.ts:27-35` |
| SEC-09 | P2 | No server-side per-user socket cap | **Verified in code** | `apps/realtime/src/index.ts:173-294` |
| SEC-10 | P2 | Membership removal does not close the live room socket | **Verified in code** | `room.ts:209-219`; members route |
| SEC-11 | P3 | Comment rooms skip membership authorization (metadata leak) | **Verified in code** | `apps/realtime/src/room.ts:209-219` |
| SEC-12 | P3 | Admin upload trusts declared MIME and stores SVG | **Verified in code** | `api/admin/upload/route.ts:7,24,37-41` |
| SEC-13 | P3 | Signup avatar accepts arbitrary existing media key | **Verified in code** | `api/signup/avatar/route.ts:82` |
| SEC-14 | P3 | `image-download` accepts any `*.r2.dev`/`*.supabase.co` and buffers unbounded bodies | **Verified in code** | `api/image-download/route.ts:25,61,70,75` |
| SEC-15 | P3 | Push token reassignment by token alone | **Verified in code** | `api/push/register/route.ts:63-71` |
| SEC-16 | P3 | Internal secrets compared with `===` | **Verified in code** | internal routes listed in AUD-30 |
| SEC-17 | P3 | Raw PostgREST errors returned to members | **Verified in code** | event/comment routes listed in AUD-31 |
| SEC-18 | P3 | Admin search injected into PostgREST `or()` filter | **Verified in code** | admin list routes listed in AUD-32 |
| SEC-19 | P3 | WebSocket still accepts JWT in the query string | **Verified in code** | `apps/realtime/src/index.ts:180-183` |
| SEC-20 | P3 | Two high dependency advisories (`source-map-js`, `zod`) | **Verified by npm audit** | audit output |

### Verified-good controls (spot-checked and held up)

- **Session model:** JWT is a pointer; `requireSession` validates the registry row, `session_version`, block/suspension and admin epoch; DB errors fail closed. Admin login uses `secureEqual`.
- **Revocation:** logout/logout-all/password reset/block/delete update the registry and push revocation to UserDO/Room DOs; sockets close with 4001; private-file routes use the same live-session check.
- **Realtime authorization:** user-scoped rooms forced to the caller; community membership fail-closed; client publish restricted to `typing` with shape validation and per-socket/per-user token buckets; server publishes require the shared secret; event-id dedupe.
- **DM:** every route re-authorizes participation; edit/delete checks authorship; uploads are private-bucket, magic-byte sniffed, 20 MB, key-scoped; admin access is explicit for reports.
- **Jobs:** resume magic bytes/size, ownership-scoped saved resumes, self-apply blocked, eligibility enforced, SQL ownership checks.
- **Uploads (member):** signature sniffing, size caps, private buckets for DM/résumés/verification, 5-minute signed GETs, ownership rules tested.
- **SSRF/XSS:** link-preview safe URL and redirect re-validation; zero `dangerouslySetInnerHTML`; job rich text parsed to an allowlist model.
- **CSRF:** same-origin mutation check plus `SameSite=Lax`; no state-changing GETs found.
- **Secrets:** no hardcoded production secrets in tracked source; local env is `APP_ENV=development`; `.open-next`, `.dev.vars*`, FCM JSON are gitignored; client bundle scan found only documentation strings, not secret values.

### Potential risks (not counted as verified defects)

- A subdomain takeover/XSS on `*.uxcommunity.in` can overwrite the parent-domain session cookie (session fixation/logout DoS); the origin check prevents cross-origin API use.
- `push_tokens` reassignment requires a leaked token (SEC-15).
- Admins can read any DM image if they know the path (explicit, documented for reports).
- A rogue admin can host SVG content via the admin upload route (SEC-12).
- The `ADMIN_PASSWORD` is a plaintext environment secret with a password login path; it should be generated high-entropy and rotated with the other secrets.
- Member sessions are **365 days** and slide forward while used (`lib/auth/session-lifetime.ts:9-13`). Registry revocation is the only brake on a stolen token; a "sessions/devices" view with remote revoke would reduce the window and is worth adding before GA.

---

## F. Performance Assessment

Ranked by user/business impact. "Verified" means the code path exists; "estimated" means the DB plan was not measured live.

| # | Issue | Impact | Evidence | Severity |
|---:|---|---|---|---|
| 1 | Chat open runs the read model twice and defers messages | Most-used screen pays duplicate server/DB work and spinner time | `page.tsx:27-31`; `bootstrap/route.ts:86-100` | P2 |
| 2 | Home-feed RPC scans/JSON-encodes four tables before LIMIT | Every dashboard load; degrades at ~1M content rows | baseline `:5811-5864` | P2 |
| 3 | Sidebar unread counts grow with unread volume | Every page load; inactive members of busy rooms | baseline `:6581-6619` | P2 |
| 4 | RSVP capacity/count fetches every attendee row | Hot event write path; oversell race | rsvp route `:105,116,180` | P2 |
| 5 | Member search `ILIKE '%term%'` with no index | Seq scan of `users`; deep OFFSET | baseline `:4976-5016` | P2 |
| 6 | Explore returns the whole community catalogue | Large JSON on every Explore visit | baseline `:4878-4973` | P2 |
| 7 | No `next/image`/srcset; 2560 px originals in 40 rem column | 2–4× image bytes, CLS | no imports; `image-geometry.ts:14-17` | P2 |
| 8 | No chat/DM virtualisation; up to ~1,000 rows retained | Weak-device layout cost | `MessageList.tsx:292-325` | P2 |
| 9 | Push fan-out capped at 10k/20 s, best-effort | Partial delivery for large communities | `push/chat.ts:101-102` | P2 |
| 10 | Single hot-room DO ceiling ~2,500–4,000 sockets | Realtime outage for large communities | `realtime-presence-scaling.md:267-278` | P2 |
| 11 | DM list capped at 200 with per-conversation unread count | Silent truncation; 200 range scans | baseline `:5228-5318` | P3 |
| 12 | Notification bulk-read selects/publishes per row | Thousands of rows/events on one click | `notifications/route.ts:67-113` | P3 |
| 13 | Thread detail refetches comments already SSR'd; four sequential reads | Extra round trip + waterfall per open | `ThreadDetailClient.tsx:103-107`; `page.tsx:15-52` | P3 |
| 14 | Sender profile lazy fetch (N+1 over HTTP) in chat/sidebar | 60–80 queries opening a 30-message window with 20 unknown senders | `useRealtimeChat.ts:260`; member route | P2/P3 |
| 15 | Event list `ORDER BY CASE` defeats its index | Sorts all events per tab | baseline `:5524-5563` | P3 |
| 16 | Account deletion scans three report tables | Every deletion; locks held through cascade | baseline `:2853-2881` | P3 |
| 17 | Duplicate indexes on messages/saves | ~4 index writes per chat message | baseline `:1926-1940` | P3 |
| 18 | Global fetch guard collapses read mutations by URL | Lost newer read watermark | `global-fetch.ts:44,98` | P3 |
| 19 | Mobile startup: sequential SecureStore then AsyncStorage read; splash hides early | Spinner/flash before cached shell | `_layout.tsx:76-82`; `AuthContext.tsx:311-321` | P3 |
| 20 | Mobile window changes tear down/reopen every community socket | Reconnect storm for members of >10 communities | `useCommunities.ts:261-264,806-819` | P2/P3 |

**Verified performance positives:** realtime fan-out is O(recipients) via a topic index; presence is a count with a 256-send lap budget and measured 540–635× byte reduction at 1,000 sockets; chat/DM use compound cursors and hard limits; the smoke/benchmark harness measures chat open with Server-Timing.

---

## G. Testing Gaps

### What exists and passes

- 1,149 web unit tests across 141 files (all pass under the CI `APP_ENV=production` fixture).
- 72 mobile realtime tests (reconnect, catch-up, window/cap, auth) and 45 mobile cache tests (all pass).
- 35 realtime worker suites (ownership, publish security, revocation, multi-device, sub-entity isolation, presence, fan-out, retry, dedupe, routing, scale harnesses). **20 non-perf files ran here: 252/257 pass; 5 harness failures** (quoted `.dev.vars` secrets and a stale fail-closed status assertion). The suite is therefore not currently green, and it is not run by any workflow.
- SQL suites for RPC signatures, performance RPC existence, public-read exposure, member counts, session revocation, login performance, company directory, moderation evidence, notification dedupe.
- A comment audit that blocks stale/dead references; CI `typecheck` and `tests` are blocking; generation/seed/environment tests run in the isolation job.

### What is missing

| Critical journey | Current coverage | Gap |
|---|---|---|
| Signup → approval → login → onboarding | Unit/signup-completion tests; no browser E2E | No end-to-end session/cookie/redirect test |
| Login → dashboard → community open | Unit + read-model tests | No CI browser test of the actual bootstrap/read-model path |
| Chat send → persist → fan-out → receive → retry → catch-up | Realtime suites + unit tests | No browser/mobile E2E; no test that a real client receives across a reconnect |
| DM request → accept → message → read receipt | Unit/server tests | No E2E; no multi-device test |
| Media upload → magic bytes → R2 → render | Unit tests for upload guards | No E2E direct-to-R2 video finalize/HEAD path |
| RSVP capacity under concurrency | None | No concurrent SQL/HTTP test; race is open |
| Session revocation across web + mobile + realtime | Strong realtime/unit tests | No device/browser test that a revoked cookie/socket stops receiving; local security suite currently has harness failures |
| Account deletion cascades + R2 cleanup | Unit + docs | No SQL test covering a reviewer account (current blocker) |
| Push delivery (Expo/FCM), deep links, app killed | Partial unit tests | No device test; push disabled outside production |
| Admin moderation/report/appeal flows | Server/unit tests | No E2E; mobile appeal screen missing |
| Load/scale | k6 scripts + 5k audit docs | No CI load gate; staging membership not enforced during the ladder |

### Test-quality observations

- Tests are generally behavioural (pure helpers, fake DB/transport), not implementation-mirroring; the realtime suites use a real miniflare DO and sockets.
- The web suite has no coverage thresholds and no mutation/contract tests; large route handlers are mostly untested directly (helpers are tested).
- The deploy job's "unit tests" step is misleadingly narrow (two files); the real suite lives in CI, which is not a deploy dependency.
- Real-device Android/iOS behaviour is not automated at all; release verification is manual.

---

## H. Previous Audit Verification

Prior audit: `docs/production-readiness-audit.md` on branch `audit/production-readiness` at `74b3241c` (2026-09-27), plus the remediation/PR records. Each item was checked against the current tree.

| Prior ID | Topic | Status | Evidence |
|---|---|---|---|
| **C-1** | Sidebar/member-count aggregation scales with memberships | **FIXED — VERIFIED** | `communities.member_count` + `sync_community_member_count()` triggers (`baseline:8409,9093,9095`); sidebar reads the counter (`:6601-6605`); `get_all_communities` comment confirms no count aggregation |
| **C-2** | Hot-room presence/typing O(N²) from one DO; sharding | **PARTIALLY FIXED** | Presence is count-only with `PRESENCE_FLUSH_BUDGET=256` (`presence.ts:68-86,213-235`); measured 2,500 stable, 4,000/5,000 DO reset (`realtime-presence-scaling.md:267-278,332-337`). **No sharding/partitioning** — single hot-room ceiling remains |
| **C-3** | WS publish unvalidated/unthrottled | **FIXED — VERIFIED** | `client-publish.ts` allow-list `typing` only, payload validator, per-socket 12/4 + per-user 24/8 token buckets (`room.ts:463-496`); tests `client-publish-guard.test.ts`, `ws-publish-security.test.ts` |
| **H-1** | Mobile loses messages after foreground reconnect; ghost sessions after logout | **PARTIALLY FIXED** | Community chat: `onRoomStatus` + AppState catch-up + paged drain (`useChatMessages.ts:541-555`; `communityMessageStore.ts:136-181`); logout tears down sockets/caches (`AuthContext.tsx:223-240,475-490`; `realtimeCore.ts:1056-1069`). **Residuals:** DM catch-up fetches one page only; implicit sign-out does not detach push (AUD-08) |
| **H-2** | Push fan-out truncated; no retry/queue | **PARTIALLY FIXED** | Batched/parallel fan-out, retries with backoff, 20 s budget, 10k cap, `ChatPushReport`, dead-token cleanup (`push/chat.ts:101-102,257-282,637,682-690`); **no durable queue or persisted report** (AUD-17) |
| **H-3** | 5k load test tested an empty room | **FIXED TEST; CAPACITY STILL FAILS** | Rewritten `k6/loadtest-5k.mjs` with per-event bitmap, room assertion, staging guard, `/stats` cross-check (`docs/realtime-5k-loadtest-audit.md`); 5k same-room still 4,750 connected + DO reset; 5k distinct rooms pass (`realtime-presence-scaling.md:278,332-337`) |
| **H-4** | Video proxy buffers 50 MB in a 128 MB Worker | **FIXED — VERIFIED** | Videos go direct to R2 via presigned PUT; proxy refuses video bytes and caps any body at 10 MB (`showcase/upload/route.ts:20-100`; `lib/video/upload-guard.ts:44,73-110`). Residual: presigned PUT has no size bound (AUD-07) |
| **M-2** | Members page fetches all then slices | **FIXED — VERIFIED** | `get_community_members_page` with `p_limit/p_offset` (`baseline:4976-5016`); route uses it (`members/route.ts:50-56`) |
| **M-3** | `content_reactions` shipped 50× per message page | **FIXED — VERIFIED** | Page-level aggregate emitted once via `row_number()` (`baseline:5112-5120`) |
| **M-4** | Notification dedupe race | **FIXED — VERIFIED** | Unique partial index `idx_notifications_user_entity_unread` (`baseline:2157`); `create_notification` uses `ON CONFLICT` + retry (`:4343`) |
| **M-5** | `createServerTimer` never emitted | **FIXED — VERIFIED** | Returns `Server-Timing` + `api.timing` log (`lib/server-timing.ts:27-76`); wired into hot routes (`home/feed`, `messages`, etc.) |
| **M-6** | `/stats` never scraped; no error tracking | **PARTIALLY FIXED** | Structured `logEvent` events + `/stats` counters + dependency-health emails (`observability/log.ts:32`; `alert-monitor.ts`); **no error tracker, no scraping/alerting on app metrics** (AUD-20) |
| **M-11** | 4 queries per chat fetch for content IDs | **FIXED — VERIFIED** | `createContentEventIdCache` 60 s TTL, bounded, in-flight dedupe (`app/api/communities/[id]/messages/route.ts:20-40`) |

**Reintroduced regression:** none of the prior C/H/M fixes were found reverted. The rate-limit fail-open is not a regression of a shipped fix — commit `da49fe90` deliberately reverted the remediation branch's fail-closed behaviour, so C-17 is **NOT FIXED** by design (AUD-05).

---

## I. Prioritized Action Plan

### Phase 1 — Immediate (P0/P1)

| Priority | Task | Effort | Dependencies | Areas |
|---:|---|---|---|---|
| 1 | Backup/DR: enable PITR or scheduled dumps, R2 versioning, restore drill, RPO/RTO | M | Provider plan/approval | Supabase, R2, docs |
| 2 | Rotate the eight live exposed credentials; re-issue sessions; verify all services; delete artifacts | S | Provider dashboards, GitHub secrets | Web, realtime, GitHub, local |
| 3 | Fail closed for auth/abuse limits; boot check for Upstash; alert on limiter failure | S | None | `lib/auth/rate-limit.ts`, middleware |
| 4 | Android release: real keystore/EAS credentials, versioning, remove unused permissions, `allowBackup=false`, signed-device test | M | Store/EAS credentials | Mobile Android |
| 5 | Release gate: realtime CI job (non-perf) + full web suite in deploy; make deploy depend on CI SHA | S | None | `.github/workflows` |
| 6 | Sanitize `linkedin_url`/`portfolio_url` on write and render via `externalUrl()` | XS | None | Profile API/admin card |
| 7 | Cap presigned PUT size; HEAD-verify real object length on finalize | S | None | R2, showcase upload |
| 8 | Detach push on implicit sign-out/revocation; suppress notifications without a session | S | None | Mobile auth/push |

### Phase 2 — Reliability and performance (P2)

| Priority | Task | Effort | Dependencies | Areas |
|---:|---|---|---|---|
| 9 | One chat bootstrap loader; seed messages SSR | M | None | Community page/bootstrap |
| 10 | DB scale: split feed RPC by scope + LIMIT-before-JSON; unread saturation/counters; RSVP SQL function; trigram search; Explore pagination | L | Migration window | Supabase RPCs |
| 11 | Realtime hot-community partition design; document a hard socket cap until shipped | XL | Architecture review | Realtime DOs |
| 12 | Durable push fan-out (Queue or `push_jobs`) + persisted reports/alerts | M–L | Cloudflare Queues | Push |
| 13 | Error tracking + metrics alerting | M | Provider choice | Observability |
| 14 | `error.tsx`/`not-found.tsx`/`global-error`; error+retry states for Explore/notifications/DM | S | None | Web |
| 15 | Image transforms/srcset + chat/DM virtualisation | M | None | Web |
| 16 | Enforcing CSP (nonce) and host-only app cookie + short-lived realtime token | M | CSP testing | Web/realtime |
| 17 | Mobile request timeouts/cancellation; fix socket churn on window changes; DM catch-up drain | M | None | Mobile |
| 18 | Fix account-deletion reviewer FK; event-room orphan cleanup; membership-removal socket close | S | Migration | DB/realtime |
| 19 | Add reporter indexes, drop duplicate indexes; server-side socket cap | S | Migration | DB/realtime |

### Phase 3 — Long-term (P3)

| Priority | Task | Effort | Dependencies | Areas |
|---:|---|---|---|---|
| 20 | Reduce `any`/suppressions; make ESLint blocking; pin config | L | Dedicated cleanup | Web |
| 21 | Remove unused deps/permissions; dependency-review CI | S | None | Web/mobile |
| 22 | Fix docs drift (Next version/routes/WS auth/session lifetime/DB adoption) | XS | None | Docs |
| 23 | Accessibility: modal focus trap, card semantics, skip link, labels/copy | M | None | Web |
| 24 | SEO: robots/sitemap/noindex; decide public `/` | S | Product decision | Web |
| 25 | Server-side authorization tests for high-risk routes; browser/device E2E | L | Test infrastructure | Testing |
| 26 | Transactional community create/member removal; backfill batching; event-list RPC split | M | Migration | DB |
| 27 | Remove query-string JWT fallback after client sunset | XS | Mobile version floor | Realtime |
| 28 | Migrate to zod 4 / apply source-map-js patch | M | Compatibility testing | Dependencies |

---

## J. Production Readiness Decision

# NO-GO

**Rationale.** The codebase is materially better than a typical pre-launch product: the authorization core, session revocation, realtime membership enforcement, media access rules and CI type/unit checks are real and tested. But production readiness is not only code quality. The following are launch blockers, each verified or documented in the repository:

1. **No recoverable backup/DR** (P0). There is no PITR, no physical backup, no R2 versioning, and no restore procedure. A production database is a system of record; without a restore path, any incident is unrecoverable. This was explicitly deferred, not fixed.
2. **Eight exposed production credentials were still live at the last recorded check** (P1). The artifact was deleted, but rotation is deferred; deletion does not reduce the exposure.
3. **The release gate does not test the realtime worker** (P1). The security boundary of the product has 35 suites that no workflow runs.
4. **Abuse throttles fail open** (P1), including a production path where a missing Upstash config silently disables every limit.
5. **The mobile release is not production-ready** (P1): debug signing, static version 1, unnecessary permissions, plaintext backup, and push remaining registered after implicit sign-out.
6. **Known scale ceilings** (P2): one hot-room DO, full-scan feed RPC, unbounded unread counts, no trigram search. These do not block a small soft launch, but they block a "ready to grow" claim.

**What would change the decision:** complete Phase 1 items 1–5 and 8, then re-audit. At that point the decision would likely become **CONDITIONAL GO** for a limited launch, with Phase 2 performance work tracked as gates for large communities. A full **GO** should also require the Phase 2 performance/observability items and an E2E/device test gate.

**Important nuance:** the app is already live at `app.uxcommunity.in`. This decision is about *readiness for a production launch/scale*, not a statement that the current deployment is broken. At current data volume the product works; the risk is what happens when it does not.

---

## Final summary (terminal)

1. **Overall quality score:** **6.7 / 10**.
2. **Production readiness decision:** **NO-GO** for general availability (soft-launch only with accepted data-loss risk).
3. **Findings:** **1 P0, 4 P1, 21 P2, 24 P3** (50 total).
4. **Top 10 fixes:**
   1. Backup/DR + restore drill.
   2. Rotate the eight live exposed credentials.
   3. Fail closed for auth/abuse rate limits.
   4. Put realtime tests + full web suite in the release path.
   5. Android release signing/versioning/permissions/backup rules.
   6. Sanitize profile URLs rendered as `href`.
   7. Cap presigned upload size and verify real object length.
   8. Detach push on implicit sign-out; suppress without a session.
   9. One chat bootstrap loader; image transforms; virtualisation.
   10. DB scale work (feed RPC, unread counts, RSVP, trigram search, Explore pagination).
5. **Most dangerous issue discovered:** no recoverable backup/DR, followed by the eight exposed credentials still live at the last recorded check.
6. **Biggest scalability bottleneck:** a single hot-community Durable Object (~2,500–4,000 sockets) and the full-scan home-feed/sidebar queries.
7. **Suitable for the next 12 months?** The architecture is suitable for a small-to-moderate user base, but **not as-is for large communities or a system-of-record launch** without the backup, secret-rotation, release-gate and hot-room/DB scaling work above.
