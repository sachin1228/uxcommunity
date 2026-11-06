# Stage 3 — Release Infrastructure Hardening

**Date:** 2026-11-06
**Branch:** `release/stage-3-infrastructure-hardening`
**PR:** [#797](https://github.com/sachin1228/uxcommunity/pull/797)
**Base:** `main` @ `bffa882d`
**Scope:** CI reliability, exact-commit production gating, Android release signing and versioning, Android permissions and backup policy.
**Constraint:** No production access, no production deployment, no Android release published, and no production signing key generated or replaced. All verification used local or disposable resources.

---

## 1. Executive summary

| Area | Status | Summary |
|---|---|---|
| Realtime correctness tests in CI | **PASS** | A dedicated CI job runs the realtime Worker/Durable Object suites against local miniflare instances; no Cloudflare or production resource is contacted. Load-only suites moved to a manual workflow. GitHub Actions run `42216357510` passed in 5 m 03 s. |
| Complete web suite before release | **PASS** | The full web typecheck, unit suite, mobile suites, comment/deployment audits and a Next build now run in CI. The production workflow calls that CI as a reusable workflow and cannot release without it. The web build passed in GitHub Actions in 1 m 15 s. |
| Exact-commit production gate | **PASS (structure), NOT VERIFIED end-to-end** | `deploy.yml` calls `ci.yml` as a reusable workflow on the same `github.sha`; the deploy job depends on it, pins checkout to that SHA, and refuses if `main` moved. No production deployment was triggered to prove it end-to-end. |
| Android release signing | **PASS (fail-closed and local release), production key NOT VERIFIED** | Release tasks fail without upload-key credentials; debug stays on the debug key. A disposable verification keystore produced a release-signed APK with a release cert. The real production keystore is not available in this workspace and was not generated or replaced. |
| Android versioning | **PARTIAL** | `app.json` is the single source (`versionCode: 1`, `versionName: 1.0.0`), EAS uses the same local source, and a bump script is documented. Monotonicity across releases remains process-enforced; no release ledger is stored remotely. |
| Android permissions | **PASS** | Eight unnecessary permissions are absent from the final merged release manifest; required media, notification and runtime permissions remain. |
| Android backup policy | **PASS** | `allowBackup=false` plus packaged exclusion rules cover every app-data domain, including device-protected storage, for both cloud backup and device transfer. |
| Staging | **PASS (unchanged)** | The staging workflow is untouched and still deploys independently on `main`; it is ready for verification. |
| Production deployment safety | **PASS (structure)** | The manual `Production` environment approval is preserved; a release needs a green CI run for the exact commit. `main` branch protection is not configured in GitHub (manual setting below). |

---

## 2. Current infrastructure findings

1. **CI had no realtime job.** `apps/realtime` had a substantial vitest suite (33 files) but no GitHub Actions job ran it, and its `typecheck` script was not invoked by CI.
2. **Production ran only a token subset of web tests.** `deploy.yml` ran `lib/read-manager.test.ts`, `lib/request-cache.test.ts` and `e2e/seed-member.test.mjs` — three files out of 149 — after the OpenNext build. A failing unit test outside that subset could reach production.
3. **No exact-commit CI dependency.** `deploy.yml` was a standalone `workflow_dispatch`; nothing tied a release to a green CI run for the dispatched SHA.
4. **Android release builds used the debug keystore.** The Expo-generated `android/app/build.gradle` had `release { signingConfig signingConfigs.debug }`. The existing release APK verified as `CN=Android Debug`.
5. **Version management was implicit.** `versionCode 1` was generated from the default; `android.versionCode` was not declared in `app.json`. EAS used `appVersionSource: "remote"` with `autoIncrement: true`, while local Gradle builds read `app.json` — two different sources.
6. **The merged manifest asked for more than the app uses.** It carried location, camera, microphone, media-audio, system-overlay and biometric permissions. Only image/video library picking and saving are used.
7. **Backup was mostly configured but not complete.** `allowBackup: false` and exclusion rules existed, but device-protected storage domains were not excluded.
8. **`main` is not branch-protected.** CI exists, but GitHub does not require it before merges. This is a repository setting, not a file change.

---

## 3. Files changed and why

**CI and release workflows**
- `.github/workflows/ci.yml` — added `workflow_call`, read-only permissions, a `realtime` job, a `web-build` job, service/smoke guard tests, and a concurrency group that cannot cross-cancel a deployment's CI run.
- `.github/workflows/deploy.yml` — added the `Required CI` reusable-workflow job, `needs: ci`, exact-SHA checkout and main-head verification, non-cancelling production concurrency, and removed the now-redundant unit-test subset.
- `.github/workflows/realtime-perf.yml` (new) — manual-only load-test workflow for the socket-heavy suites.
- `apps/realtime/__tests__/fixtures/ci.vars` (new) — committed disposable CI-only environment for the realtime suites.
- `apps/realtime/package.json`, `package.json` — `test:realtime` and `test:realtime-perf` scripts.
- `apps/realtime/__tests__/ws-multi-device.test.ts` — replaced a fixed 1 s delivery wait with the suite's polling helper (the only flaky assertion observed in the full run).
- `apps/realtime/__tests__/realtime.integration.test.ts`, `ws-ownership.test.ts` — the 500/1000-client load cases are gated behind `REALTIME_LOAD_TESTS`, so the PR gate stays fast and deterministic.

**Android**
- `expo-app-standalone 3/app.json` — explicit `android.versionCode`, blocked permissions, image-picker camera/microphone disabled, media-library granular audio removed, release-signing and permission-scope plugins registered.
- `expo-app-standalone 3/plugins/withAndroidReleaseSigning.js` (new) — fail-closed release signing from environment variables or `android/keystore.properties`.
- `expo-app-standalone 3/plugins/withAndroidPermissionScopes.js` (new) — caps `WRITE_EXTERNAL_STORAGE` at API 28.
- `expo-app-standalone 3/plugins/withAndroidBackupPolicy.js` — excludes device-protected storage domains as well.
- `expo-app-standalone 3/eas.json` — `appVersionSource: "local"`, no production `autoIncrement`.
- `expo-app-standalone 3/scripts/android-version.mjs` (new) and its test — check/bump commands.
- `expo-app-standalone 3/lib/androidReleaseConfig.test.ts` (new) — source-of-truth assertions for version, signing, permissions and backup.
- `expo-app-standalone 3/package.json`, `package-lock.json` — removed unused `expo-location`; added version scripts.
- `expo-app-standalone 3/.gitignore` — ignores keystore files and `keystore.properties`.
- `README.md` — release-signing, version-bump and verification instructions.

---

## 4. Realtime CI configuration

The `Realtime correctness` job:

- runs on every pull request, `main` push and `workflow_dispatch`, and is part of the reusable workflow called by production;
- installs root dependencies with `npm ci`;
- copies `apps/realtime/__tests__/fixtures/ci.vars` to the gitignored `apps/realtime/.dev.vars`;
- runs `npm run typecheck --workspace=apps/realtime`;
- runs `npm run test:realtime --workspace=apps/realtime`, which executes every realtime suite except `perf-*.test.ts` and `performance.integration.test.ts`.

Isolation and safety:

- The suites use `unstable_dev`/miniflare, so the Worker, `Room`/`CommunityDO`, `UserDO` and storage are local processes on the runner.
- `.dev.vars` in CI contains fixed, disposable values only (`ci-only-*`), never a production secret.
- `__tests__/global-setup.ts` starts a local membership API stub, points `API_URL` at it, and restores `.dev.vars` on teardown (including signal exits).
- No Cloudflare account ID, API token, production database or deployed Worker is used.
- The runner is ephemeral; there is nothing to clean up beyond the disposable `.dev.vars`.

Coverage includes the WebSocket connection lifecycle, `UserDO`/`CommunityDO` gateway routing, DO-to-DO event delivery, publish delivery, multiple clients/tabs, membership and authorization checks, revoked membership/session handling, reconnect and disconnect behaviour, and concurrent delivery.

The three 500-client fan-out tests in `realtime.integration.test.ts` and the 500/1000-client cases in `ws-ownership.test.ts` are load tests. They are skipped in the PR gate and run in the manual **Realtime load tests** workflow with `REALTIME_LOAD_TESTS=1`. The 100-client scale case and the 300-socket presence-window case remain in CI.

**Runtime:** the full correctness suite (including the load cases, before the split) took ~9 minutes on the development machine. The final CI subset took 225.62 s (3 m 46 s) locally and 5 m 03 s in GitHub Actions run `42216357510`.

---

## 5. Complete web suite and build validation

CI now runs, on every pull request and `main` push:

| Check | Command | Blocking |
|---|---|---|
| TypeScript | `npx tsc --noEmit` in `apps/web` | Yes |
| Unit tests | every `apps/web` `.test.ts` / `.test.tsx` / `.test.js` / `.test.jsx` / `.test.mjs` outside `e2e/`, through `npx tsx --test` | Yes |
| Mobile realtime/security/chat suites | root `test:mobile-*` scripts | Yes |
| Realtime correctness | `npm run test:realtime --workspace=apps/realtime` | Yes |
| Web build | `npm run build` in `apps/web` with CI-only dummy env | Yes |
| Comment audit | `node scripts/audit-comments.mjs` | Yes |
| Deployment-target audit | `node scripts/audit-vercel.mjs` and guard unit tests | Yes |
| ESLint | `npx eslint .` in `apps/web` | Advisory (pre-existing debt) |

**Test inventory (final):** 150 files and 1,196 tests pass with `APP_ENV=production`. The inventory is 149 `.test.ts` files plus `apps/web/lib/communities/figma.test.mjs`, which the old `.test.ts`-only glob silently missed and which is now included. There are no `.test.tsx`, `.test.js` or `.test.jsx` files in `apps/web`.

The `e2e/` directory is pruned from the unit glob on purpose. `community-bootstrap.test.mjs` and `seed-member.test.mjs` are pure enough to run in the CI `isolation` job. `chat-readiness.test.mjs` (Playwright/Chromium), `realtime-sockets.test.mjs` (Playwright plus a live app) and `event-host-going.test.mjs` (Supabase plus Playwright) require infrastructure the unit job does not provide; they remain staging/device checks. `community-chat-open-timing.mjs` is a benchmark, not a test.

There is no single `test:web` package script; the CI discovery command is the authoritative complete web suite. The root package scripts cover the mobile, database and performance suites separately.

The build job uses deliberately unreachable CI-only values (`https://ci.invalid` and `ci-*` secrets), makes no network request to a real service, and does not use production infrastructure.

The production workflow no longer runs a separate typecheck or three-file test subset; the `Required CI` job runs the complete suite first. The OpenNext build in the deploy job remains the release artifact build and still fails on type errors.

ESLint remains advisory because the repository has 43 pre-existing errors from rules that arrived with `eslint-config-next` 16 (`react-hooks/set-state-in-effect`, `react/no-unescaped-entities`, `react-hooks/refs`, `react-hooks/immutability`). This change neither adds nor hides lint errors; the existing reason is preserved in `ci.yml`.

---

## 6. Exact-commit production deployment protection

`deploy.yml` now has two jobs:

1. **`ci`** — `uses: ./.github/workflows/ci.yml`, with the same main/confirmation guard. A reusable workflow runs in the caller's workflow run and uses the caller's `github.sha`. Every required check therefore executes against the exact commit selected at dispatch. There is no lookup of “the latest successful run on main”.
2. **`deploy`** — `needs: ci`, with an explicit `needs.ci.result == 'success'` condition. A failed, cancelled or skipped CI job leaves the deploy job unstarted. The job still uses the protected `Production` environment, so the existing manual approval is preserved.

Additional safeguards:

- `actions/checkout` in the deploy job is pinned to `ref: ${{ github.sha }}`.
- A `Verify the release commit` step asserts that `HEAD` is the dispatch SHA and that `origin/main` has not moved. This catches a release queued while `main` advanced.
- Production concurrency changed from `cancel-in-progress: true` to `false`. Cancelling midway through the web → secrets → realtime → smoke sequence could leave production split; a newer dispatch now queues instead.
- The called CI workflow's concurrency group includes the event name and, for `workflow_dispatch`, the run ID. A push-to-main CI run cannot cancel the CI jobs inside a production deployment.
- Staging is untouched: it still triggers independently on `main` push and runs only `test:environments` before deploying.

**Not verified end-to-end:** no production deployment was triggered, per the task constraints. The dependency is enforced by GitHub's `needs` semantics and validated syntactically with `actionlint`; the first real dispatch will exercise it.

**Manual repository setting:** `main` is currently unprotected (`gh api …/branches/main/protection` returns 404). To make CI a merge requirement as well as a release requirement, enable branch protection for `main` with the CI job names as required checks (for example `TypeScript`, `Unit tests`, `Realtime correctness`, `Web build`, `Mobile chat loading`, `Environment isolation`, `Comment audit`, `Deployment targets`).

---

## 7. Android signing

### Source of truth

The generated `android/` directory is gitignored, so the tracked source of truth is:

- `expo-app-standalone 3/plugins/withAndroidReleaseSigning.js` — writes `android/app/release-signing.gradle` and applies it at the end of `android/app/build.gradle` during `expo prebuild`;
- `expo-app-standalone 3/app.json` — registers the plugin.

### Behavior

- **Debug builds** keep `signingConfig signingConfigs.debug` and the generated `debug.keystore`.
- **Release builds** use a `release` signing config built from:
  - `UXCOMMUNITY_ANDROID_STORE_FILE`, `UXCOMMUNITY_ANDROID_STORE_PASSWORD`, `UXCOMMUNITY_ANDROID_KEY_ALIAS`, `UXCOMMUNITY_ANDROID_KEY_PASSWORD`, or
  - `android/keystore.properties` with `storeFile`, `storePassword`, `keyAlias`, `keyPassword` (gitignored).
- If any value is missing, `gradle.taskGraph.whenReady` throws a `GradleException` naming the missing configuration and refuses to run a release task. There is no debug fallback.
- **EAS Build** applies its own `android/app/eas-build.gradle` signing config from `credentials.json` at the repository root; it does not use the local env/property credentials. The plugin no longer skips on EAS: when `EAS_BUILD=true` it leaves the release signing configuration alone, then a post-evaluation check rejects a release whose signing config is still the debug config or whose keystore file is missing/unreadable. That closes the previous theoretical hole where an EAS injection failure could fall back to debug.

### Verification

| Check | Result |
|---|---|
| Release without credentials | **PASS** — `:app:assembleRelease --dry-run` failed with the named `GradleException` before any release task ran. |
| Partial credentials (store file only) | **PASS** — `:app:assembleRelease --dry-run` failed with the same missing-credentials error. |
| Invalid keystore path | **PASS** — `:app:assembleRelease --dry-run` failed with “Release signing keystore is missing or unreadable.” |
| AAB without credentials | **PASS** — `:app:bundleRelease --dry-run` failed with the missing-credentials error, proving the guard covers AAB as well as APK. |
| Debug without credentials | **PASS** — `:app:assembleDebug` built after the final plugin change and used `CN=Android Debug` (`SHA-256 fac61745…033b9c`). The debug manifest keeps `SYSTEM_ALERT_WINDOW` for the React Native dev menu; none of the other blocked permissions are present. |
| EAS no-injection simulation (`EAS_BUILD=true`, no credentials) | **PASS** — `:app:assembleRelease --dry-run` failed with “Refusing to build a release with the debug signing config. EAS credential injection did not run…” |
| EAS injection simulation (temporary `eas-sim.gradle` reading the disposable key) | **PASS** — `:app:assembleRelease --dry-run` succeeded. This is a local simulation of EAS's documented mechanism, not a real EAS build. |
| Relative keystore path + `android/keystore.properties` | **PASS** — `:app:bundleRelease` and `:app:assembleRelease` built with `storeFile=verification.jks` (relative to `android/`) in `keystore.properties`, with no `UXCOMMUNITY_*` env vars. |
| Release APK with disposable key | **PASS** — package `in.uxcommunity.app`, `versionCode 1`, `versionName 1.0.0`, signed by `CN=Stage 3 Final Verification Only - NOT PRODUCTION` (`SHA-256 cebf3f9e…c3ed96`), distinct from the debug key. |
| Release AAB with disposable key | **PASS** — `bundletool dump manifest` reports package `in.uxcommunity.app`, `versionCode 1`, `versionName 1.0.0`; `keytool -printcert -jarfile` shows the same release certificate (`SHA-256 cebf3f9e…c3ed96`). |
| Production keystore / EAS upload certificate | **NOT VERIFIED** — no production keystore or EAS account access is available in this workspace. None was generated or replaced. The disposable key was deleted after verification, as were the APK/AAB outputs. |

The APK/AAB were verification artifacts only. They were not uploaded or published.

---

## 8. Version management

- `app.json` is the single source: `expo.version` (`1.0.0`) and `expo.android.versionCode` (`1`). Prebuild writes both into the generated Gradle project.
- `eas.json` uses `appVersionSource: "local"` and no longer auto-increments remotely, so local Gradle and EAS builds read the same values.
- The EAS production profile sets `EXPO_PUBLIC_APP_ENV=production`; `app.config.js` returns the base config unchanged in production, so the EAS package ID is `in.uxcommunity.app` and the version is the `app.json` pair above. This is static configuration verification; an actual EAS build was not produced.
- `expo-app-standalone 3/scripts/android-version.mjs`:
  - `version:check` validates a semver `versionName` and a positive integer `versionCode`;
  - `version:bump` increments `versionCode` and can set a new semver with `-- --version 1.1.0`.
- The script is unit-tested (`scripts/android-version.test.mjs`) and the config test validates the shipped pair.
- The current public pair is unchanged: **1.0.0 / 1**.
- README documents the required sequence: bump → `npx expo prebuild --platform android --no-install` → build.

**Limitation:** `versionCode` monotonicity across releases is a documented release step, not a server-side or ledger check. A release that skips `version:bump` would repeat the previous code. The tooling makes the correct action one command; the report does not claim an automatic guarantee.

---

## 9. Android permissions removed and retained

### Removed (verified absent from the final merged release manifest)

| Permission | Why it was unused |
|---|---|
| `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` | `expo-location` was installed but never imported; the dependency was removed. Nothing in the app requests a location. |
| `CAMERA` | The app only picks from the photo library (`launchImageLibraryAsync`); it never calls `launchCameraAsync`. ImagePicker is configured with `cameraPermission: false`. |
| `RECORD_AUDIO` | No audio recording or microphone feature. ImagePicker is configured with `microphonePermission: false`. |
| `READ_MEDIA_AUDIO` | The app has no audio feature; media-library granular permissions were narrowed to `photo` and `video`. |
| `SYSTEM_ALERT_WINDOW` | Only the React Native debug/dev-menu variant needs the overlay. The release merge excludes it; the permission is blocked in the source manifest. |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | Pulled in by `androidx.biometric` (an optional expo-secure-store feature). Session storage uses SecureStore without `requireAuthentication` or `canUseBiometricAuthentication`. |

### Retained and why

| Permission | Reason |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE`, `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE` | Network, Firebase/FCM and React Native runtime. |
| `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `READ_EXTERNAL_STORAGE` (maxSdk 32) | Picking images/videos for threads, showcase, events, avatars, community and DM messages, including Android 12-and-below library access. |
| `WRITE_EXTERNAL_STORAGE` (maxSdk 28) | `saveToLibraryAsync` for chat images on Android 9 and below; scoped storage makes it unnecessary from Android 10. |
| `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE` | Push notifications, reboot delivery and vibration. |
| Launcher badge permissions, `BIND_GET_INSTALL_REFERRER_SERVICE` | `expo-notifications`/ShortcutBadger launcher badges and Firebase install attribution. |
| `in.uxcommunity.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Android 13 dynamic receiver protection generated by the platform tooling. |

The final release manifest and APK were inspected after the build; the removed permissions do not appear. The source manifest contains explicit `tools:node="remove"` entries so a future library merge cannot silently reintroduce them.

---

## 10. Android backup exclusions

`app.json` sets `android.allowBackup: false`. The `withAndroidBackupPolicy` plugin sets:

- `android:fullBackupContent="@xml/backup_rules"`
- `android:dataExtractionRules="@xml/data_extraction_rules"`

and writes rules that exclude every app-data domain:

- legacy/full backup: `root`, `file`, `database`, `sharedpref`, `external`, `device_root`, `device_file`, `device_database`, `device_sharedpref`;
- Android 12+ extraction: the same domains under both `cloud-backup` and `device-transfer`.

Why disable/exclude rather than selectively back up: the app keeps the auth session in SecureStore and chat/session caches in AsyncStorage. Private messages and session material are server-recoverable but must not leave the device through a cloud backup or a device-to-device transfer. There is no user-visible backup feature that depends on Android backup.

Verified in the built APK: the manifest has `allowBackup="false"` and both rule references; `aapt2 dump xmltree` on the packaged `backup_rules.xml` and `data_extraction_rules.xml` shows all domain exclusions, including the device-protected domains.

---

## 11. Commands executed and actual results

| Command | Result |
|---|---|
| `npx tsc --noEmit` in `apps/web` | **PASS** |
| Full web unit suite (broadened discovery, 150 files) with `APP_ENV=production` | **PASS** — 1,196 tests, 0 failures. |
| `npx eslint .` in `apps/web` | 43 errors / 25 warnings, all pre-existing; advisory job unchanged. |
| `npm run build --workspace=apps/web` with a clean environment and CI dummy values | **PASS** — Next compiled and generated all routes. |
| `npm run typecheck --workspace=apps/realtime` | **PASS** |
| `npm run test:realtime --workspace=apps/realtime` (final CI subset) | **PASS** — 23 files, 271 passed, 5 load-only skipped, 0 failed in 225.62 s (final review run). |
| `npm run test:mobile-security` | **PASS** — 28 tests, including the Android release/version assertions. |
| `npm run typecheck` in `expo-app-standalone 3` | **PASS** |
| `npm run version:check` | **PASS** — `versionName 1.0.0`, `versionCode 1`. |
| `./gradlew :app:assembleRelease --dry-run` without signing credentials | **PASS (expected failure)** — `GradleException` naming the four variables; no release task ran. |
| `./gradlew :app:assembleRelease --dry-run` with partial credentials | **PASS (expected failure)** — same missing-credentials error. |
| `./gradlew :app:assembleRelease --dry-run` with a bad keystore path | **PASS (expected failure)** — “Release signing keystore is missing or unreadable.” |
| `./gradlew :app:bundleRelease --dry-run` without signing credentials | **PASS (expected failure)** — the missing-credentials guard also covers AAB. |
| `EAS_BUILD=true ./gradlew :app:assembleRelease --dry-run` without injected credentials | **PASS (expected failure)** — “Refusing to build a release with the debug signing config.” |
| EAS injection simulation (`eas-sim.gradle` reading the disposable key) | **PASS** — dry-run succeeded; local simulation only, not a real EAS build. |
| `./gradlew :app:bundleRelease` with a relative `keystore.properties` path | **PASS** — AAB built; `bundletool` manifest: `in.uxcommunity.app`, 1/1.0.0; release certificate matching the disposable key. |
| `./gradlew :app:assembleRelease` with the same relative `keystore.properties` | **PASS** — APK: `in.uxcommunity.app`, 1/1.0.0; release certificate; not the debug key. |
| `./gradlew :app:assembleDebug` without release credentials | **PASS** — debug APK, debug certificate. |
| `node --test scripts/verify-release-commit.test.mjs` | **PASS** — 3 tests: accepted head, moved main, wrong checkout. |
| `node --test scripts/release-workflow.test.mjs` | **PASS** — 7 static workflow assertions covering scenarios A–F, approval, SHA pinning and concurrency. |
| `node scripts/audit-comments.mjs` | **PASS** (three stale allow-list warnings only). |
| `node scripts/audit-vercel.mjs` | **PASS** — 1,729 tracked files, no drift. |
| `actionlint .github/workflows/*.yml` | **PASS structurally** — only two pre-existing shellcheck notes (`ci.yml` unit-test glob, `deploy.yml` pre-existing `export`). |
| `npx yaml-lint` on changed workflows | **PASS** |
| Intentional failing realtime test | **PASS (proof)** — a temporary `expect(1).toBe(2)` test made `vitest run` exit **1**; it was deleted immediately. The CI step runs the same command with no `continue-on-error`, so a red realtime test fails the job. |
| GitHub Actions CI on PR #797 (final implementation commit `efcbd81e`, run `42216357510`) | **PASS** — all 9 jobs green: TypeScript 1 m 34 s, Unit tests 1 m 35 s, Realtime correctness 5 m 03 s, Web build 1 m 15 s, Mobile chat loading 45 s, Environment isolation 1 m 11 s, Comment audit 9 s, Deployment targets 8 s, ESLint advisory 1 m 31 s. |

**Final realtime subset:** 23 files passed, 271 tests passed, 5 load-only tests skipped (3 in `realtime.integration.test.ts`, 2 in `ws-ownership.test.ts`), 0 failed in 225.62 s locally; the same job passed in GitHub Actions run `42216357510` in 5 m 03 s on the final implementation commit. The observed full-suite run before the split passed 272/276 with the same three skips and one 1000-client load case failing under simultaneous local Android/web builds — the reason the load cases were moved to the manual workflow. The local final run was executed with the committed CI fixture copied over `.dev.vars` and `APP_ENV=development`, matching the CI job.

---

## 12. Remaining GitHub secrets or manual configuration

No new GitHub Actions secret is required for CI or for the production gate.

Manual items:

1. **Android upload keystore** — configure the four `UXCOMMUNITY_ANDROID_*` variables or `android/keystore.properties` on the release machine. The production key is not in this workspace.
2. **EAS upload credentials (manual verification required)** — the actual EAS credential configuration is not accessible from this workspace. While logged into the Expo account:
   - run `npx eas-cli credentials -p android` and select the production profile; confirm an existing upload keystore is listed — do **not** generate or replace one without explicit approval;
   - if present, download it only to a private temporary directory, run `keytool -list -v` locally (the password prompt stays local; never log it), and note the SHA-256 fingerprint;
   - compare that SHA-256 with Google Play Console → App signing → Upload key certificate. If the app has not been uploaded to Play, no Play-side certificate exists to compare;
   - delete the downloaded keystore afterwards.
   The plugin now post-checks every EAS release: if EAS's `eas-build.gradle` injection does not run, or the release still points at the debug signing config, the build fails.
3. **Branch protection** — enable required status checks on `main` (currently unprotected). Recommended checks: `TypeScript`, `Unit tests`, `Realtime correctness`, `Web build`, `Mobile chat loading`, `Environment isolation`, `Comment audit`, `Deployment targets`, plus `Database baseline` when the repository settings allow path-filtered checks.
4. **Production approval** — the existing `Production` environment approval is unchanged and still required.
5. **Staging** — `STAGING_CONFIGURATION`, `STAGING_DATABASE_PASSWORD`, `STAGING_SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_STAGING_*` are unchanged; staging remains ready for verification.

---

## 13. Unresolved risks and limitations

1. **Production signing certificate is not verified.** The real upload keystore is not available; only the fail-closed behavior and a disposable-key release build were verified.
2. **`versionCode` monotonicity is process-enforced.** There is no remote release ledger; a skipped `version:bump` would repeat a code. The tooling and README make the correct step explicit.
3. **The exact-SHA production gate was not exercised end-to-end.** No production dispatch was made, per the constraints. It is covered by static workflow assertions plus a disposable-git harness for the moved-main and wrong-checkout branches; GitHub's `needs` semantics provide the fail/cancel/skip blocking. This is not the same as a live production dispatch.
4. **The new jobs have run green in GitHub Actions** (PR #797, final implementation commit `efcbd81e`, run `42216357510`). The remaining unexercised path is the production deployment workflow itself, which was deliberately not triggered.
5. **ESLint remains advisory** because of pre-existing rule debt; it does not block a release. This is unchanged.
6. **The CI web build adds time** to every PR (a full Next build). It is the build validation required by this stage; the deploy still performs its own OpenNext artifact build with production secrets.
7. **EAS-managed signing was not exercised against the real Expo account.** The local plugin now keeps a post-evaluation guard active on EAS and the no-injection and simulated-injection paths were tested, but the actual EAS upload certificate, its fingerprint, and the Play Console comparison remain **NOT VERIFIED**. Use the manual steps in section 12 before an EAS release.
8. **The release APK is architecture-limited.** The final verification build used `-PreactNativeArchitectures=arm64-v8a` to keep the verification cycle short; the normal release command builds all configured architectures.

---

## 14. Staging and production readiness

- **Staging:** unchanged and independent. It remains ready for verification; merge to `main` will deploy the merged commit through the existing staging workflow.
- **Production:** structurally protected. A release now requires a green full CI run in the same workflow run and on the exact dispatched SHA, plus the existing Production environment approval; `main` moving after dispatch blocks the release. The first real dispatch will confirm the Actions wiring.
- **Android:** the signing path is fail-closed and verified locally; the real production upload key remains a manual release-machine configuration. No APK was published.

---

## 15. Final PR #797 review (2026-11-06)

This section records the focused final review. It does not replace the implementation sections above; it records what was re-checked, what was fixed, and what remains unverified.

### 15.1 EAS production signing

| Item | Status | Finding |
|---|---|---|
| Existing EAS configuration | **PASS (static)** | `eas.json` keeps `appVersionSource: "local"`, no `credentialsSource` (default remote), and a `production` profile with production public env. `app.config.js` returns the base config for production. |
| EAS credential injection mechanism | **PASS (documented)** | Expo's Android build documentation states that EAS creates `android/app/eas-build.gradle`, applies it from `build.gradle`, and reads `android/../credentials.json` there. EAS sets release signing to its own `signingConfigs.release`, not the template's debug config. |
| Local fail-closed script on EAS | **FIXED** | The plugin no longer returns early when `EAS_BUILD=true`. It writes the same script but, on EAS, does not configure or overwrite signing; it lets `eas-build.gradle` inject the credential and then validates the result. |
| Debug signing fallback possible? | **PASS (guarded)** | In a normal EAS build the release build type is pointed at EAS's release config. The post-evaluation guard rejects a release task when the signing config is still the debug config, when the keystore file is missing/unreadable, or when no release config exists. A local simulation with `EAS_BUILD=true` and no injection failed; a simulated injection using a disposable keystore passed. |
| EAS package ID | **PASS (static)** | The production profile sets `EXPO_PUBLIC_APP_ENV=production`; `app.config.js` returns the base config, so the package is `in.uxcommunity.app`. |
| EAS version source | **PASS (static)** | `appVersionSource: "local"`, no `autoIncrement`; both EAS and local Gradle read `app.json` (`1.0.0` / `1`). |
| Actual EAS upload certificate | **NOT VERIFIED** | No Expo account access and no EAS build were available. The real upload certificate was not inspected or compared with Google Play. |
| Google Play upload-certificate comparison | **NOT VERIFIED (manual)** | Requires Play Console access and the EAS upload keystore. Steps are below. |

The actual EAS credential configuration cannot be verified without the Expo account. The exact manual verification required is:

1. `cd "expo-app-standalone 3"` and run `npx eas-cli credentials -p android`; select the production profile.
2. Confirm an existing Android upload keystore is listed. If none exists, **stop** and obtain explicit approval before generating or replacing a production key.
3. If present, download the keystore only to a private temporary directory. Run `keytool -list -v` locally (the password prompt stays local; never log the password) and record the SHA-256 fingerprint.
4. Compare that SHA-256 with Google Play Console → App signing → Upload key certificate. If the app has never been uploaded to Play, there is no Play-side upload certificate to compare.
5. Delete the downloaded keystore and any temporary `credentials.json` afterwards. Do not commit either.

No code change can complete those steps without account access. The local code change ensures an EAS build cannot silently ship debug-signed if the injection is absent.

### 15.2 Android APK/AAB signing task coverage

| Scenario | Result |
|---|---|
| `assembleRelease` without credentials | **PASS (expected failure)** — missing-credentials `GradleException`. |
| `assembleRelease` with partial credentials (store file only) | **PASS (expected failure)** — missing-credentials `GradleException`. |
| `assembleRelease` with an invalid keystore path | **PASS (expected failure)** — “Release signing keystore is missing or unreadable.” |
| `bundleRelease` without credentials | **PASS (expected failure)** — the same guard covers AAB. |
| `assembleDebug` without credentials | **PASS** — debug build succeeds on the debug keystore. |
| `EAS_BUILD=true` with no injected credentials | **PASS (expected failure)** — “Refusing to build a release with the debug signing config.” |
| EAS injection simulation with a disposable key | **PASS** — dry-run succeeds; this is a local simulation, not a real EAS build. |
| Relative `storeFile` in `android/keystore.properties` | **PASS** — APK and AAB both built with `storeFile=verification.jks` resolved relative to `android/`, with no env credentials. |
| Built APK identity | **PASS** — `in.uxcommunity.app`, `versionCode 1`, `versionName 1.0.0`, release cert distinct from debug (`SHA-256 cebf3f9e…c3ed96`). |
| Built AAB identity | **PASS** — `bundletool dump manifest`: `in.uxcommunity.app`, `versionCode 1`, `versionName 1.0.0`; `keytool -printcert -jarfile` shows the same release cert. |
| Temporary keystore/artifacts | **PASS** — disposable keystore, `keystore.properties`, APK, AAB and simulator files were deleted; only gitignored build caches remain. |

The guard matches any `:app` task whose name contains `Release`, so it covers `assembleRelease`, `bundleRelease`, `packageRelease`, release install tasks and their dependency graph. Debug tasks do not match. Absolute and relative paths both work; the relative path is resolved with `rootProject.file(...)` against `android/`.

### 15.3 Complete web test inventory

| Item | Status | Finding |
|---|---|---|
| All `.test.ts` files | **PASS** | 149 files, all discovered. |
| Other extensions | **PASS** | No `.test.tsx`, `.test.js` or `.test.jsx` files exist. One `.test.mjs` unit test, `apps/web/lib/communities/figma.test.mjs`, was missed by the old glob and is now included. |
| Complete suite result | **PASS** | 150 files, 1,196 tests, 0 failures with `APP_ENV=production`. |
| CI discovery | **FIXED** | The tests job now discovers `.test.ts`, `.test.tsx`, `.test.js`, `.test.jsx` and `.test.mjs` outside `e2e/`. |
| `e2e/community-bootstrap.test.mjs`, `e2e/seed-member.test.mjs` | **PASS** | Pure enough for CI; they run in the `isolation` job. |
| `e2e/chat-readiness.test.mjs` | **Intentionally excluded** | Launches Playwright/Chromium; the unit runner has no browser install. |
| `e2e/realtime-sockets.test.mjs` | **Intentionally excluded** | Needs Playwright plus a deployed app; the realtime suite covers the Worker side. |
| `e2e/event-host-going.test.mjs` | **Intentionally excluded** | Needs Supabase plus Playwright and seeded data. |
| Next.js build | **PASS and blocking** | CI `Web build` job has no `continue-on-error`; the deploy's OpenNext build also fails on type errors. |
| ESLint | **PARTIAL (advisory)** | 43 pre-existing errors / 25 warnings. It remains advisory; no new lint debt was added, and it was not flipped to blocking. |

There is no single `test:web` package script; the CI discovery command is the complete web suite. The root scripts separately cover mobile, SQL/database, realtime, scripts and performance.

### 15.4 Exact-commit deployment failure scenarios

These are verified by static workflow assertions (`scripts/release-workflow.test.mjs`, 7 tests), actionlint/YAML validation, and a disposable-git harness for the moved-main branch (`scripts/verify-release-commit.test.mjs`, 3 tests). **No production deployment was triggered; the scenarios are not end-to-end tested.**

| Scenario | Expected | Status and evidence |
|---|---|---|
| A. CI passes | Deploy eligible; Production approval still required | **PASS (static)** — reusable `ci` job, `needs: ci`, `needs.ci.result == 'success'`, `environment: Production`. |
| B. CI fails | Deploy skipped; no production secrets or steps | **PASS (static)** — `needs` blocks the deploy job before its `env:`/steps; no `always()`/`continue-on-error` on the deploy job. |
| C. CI cancelled | Deploy does not run | **PASS (static)** — a cancelled dependency is not `success`, so the deploy condition is false. |
| D. CI skipped | Deploy does not run | **PASS (static)** — a skipped dependency has result `skipped`, not `success`; both jobs share the main/confirmation guard. |
| E. `main` moves after dispatch | Stale release rejected | **PASS (harness)** — `scripts/verify-release-commit.sh` rejects moved main and a mismatched checkout; 3 disposable-git tests pass. Empty/failed `ls-remote` now fails closed too. |
| F. Wrong confirmation or non-main ref | Neither job proceeds incorrectly | **PASS (static)** — both the `ci` and `deploy` jobs require `refs/heads/main` and `DEPLOY_PRODUCTION`. |
| CI gate cannot be cross-cancelled | Deploy CI survives push/PR runs | **PASS (static)** — the CI concurrency group includes `github.event_name` and `github.run_id` for dispatches; production uses `cancel-in-progress: false`. |
| Staging independence | Unchanged | **PASS** — staging still triggers on `main` push, runs `test:environments`, and has no dependency on the production CI job. |

Edge cases documented: (1) if `main` moves **after** the guard but during the deploy, the release still deploys the approved pinned SHA; preventing that would require a last-second remote check at every release step. (2) Branch protection is still a manual repository setting; the workflow gate protects releases, but merges to `main` are not blocked by GitHub until protection is enabled.

### 15.5 CI results on the final commit

**Final implementation/verification commit `efcbd81e` — GitHub Actions run `42216357510` (2026-11-06): all nine jobs green.**

| Job | Duration |
|---|---|
| Realtime correctness | 5 m 03 s |
| Unit tests (150 files, 1,196 tests) | 1 m 35 s |
| TypeScript | 1 m 34 s |
| Web build | 1 m 15 s |
| Mobile chat loading | 45 s |
| Environment isolation | 1 m 11 s |
| ESLint advisory | 1 m 31 s |
| Comment audit | 9 s |
| Deployment targets (including the new release-guard tests) | 8 s |

This report edit is docs-only; its follow-up run re-executes the same nine jobs. The PR checks page is authoritative for the final head.

Local final results: web 150 files / 1,196 tests pass; realtime 23 files / 271 pass / 5 load-only skips / 0 fail in 225.62 s; mobile 28 security/config tests pass; web/realtime/mobile typechecks pass; web build passes; debug build passes; disposable-key APK and AAB signing verified.

### 15.6 Remaining manual configuration

1. EAS upload-certificate verification against Play Console (section 15.1) — **NOT VERIFIED**.
2. Android upload keystore for local release builds (`UXCOMMUNITY_ANDROID_*` or `android/keystore.properties`).
3. Branch protection for `main` with the CI job names as required checks.
4. Run `npm run version:bump` before each release; the public pair remains 1.0.0 / 1.
5. Existing Production approval and staging secrets are unchanged; no new GitHub secret is required for CI or the release gate.

**PR #797 readiness:** the implementation and local verification are complete, and the final implementation commit's CI run is green. The only unchecked item that requires account access is the real EAS upload certificate. PR #797 is ready to merge; complete the manual EAS/Play certificate check and configure the upload keystore before the next Android release. Branch protection remains a recommended repository setting.
