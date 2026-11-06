# Stage 3 — Release Infrastructure Hardening

**Date:** 2026-11-06
**Branch:** `release/stage-3-infrastructure-hardening`
**Base:** `main` @ `bffa882d`
**Scope:** CI reliability, exact-commit production gating, Android release signing and versioning, Android permissions and backup policy.
**Constraint:** No production access, no production deployment, no Android release published, and no production signing key generated or replaced. All verification used local or disposable resources.

---

## 1. Executive summary

| Area | Status | Summary |
|---|---|---|
| Realtime correctness tests in CI | **PASS** | A dedicated CI job runs the realtime Worker/Durable Object suites against local miniflare instances; no Cloudflare or production resource is contacted. Load-only suites moved to a manual workflow. |
| Complete web suite before release | **PASS** | The full web typecheck, unit suite, mobile suites, comment/deployment audits and a Next build now run in CI. The production workflow calls that CI as a reusable workflow and cannot release without it. |
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

**Runtime:** the full correctness suite (including the load cases, before the split) took ~9 minutes on the development machine. The final CI subset took 229.86 s (3 m 50 s). The GitHub Actions duration may differ and is recorded in the PR run.

---

## 5. Complete web suite and build validation

CI now runs, on every pull request and `main` push:

| Check | Command | Blocking |
|---|---|---|
| TypeScript | `npx tsc --noEmit` in `apps/web` | Yes |
| Unit tests | every `apps/web/**/*.test.ts` through `npx tsx --test` | Yes |
| Mobile realtime/security/chat suites | root `test:mobile-*` scripts | Yes |
| Realtime correctness | `npm run test:realtime --workspace=apps/realtime` | Yes |
| Web build | `npm run build` in `apps/web` with CI-only dummy env | Yes |
| Comment audit | `node scripts/audit-comments.mjs` | Yes |
| Deployment-target audit | `node scripts/audit-vercel.mjs` and guard unit tests | Yes |
| ESLint | `npx eslint .` in `apps/web` | Advisory (pre-existing debt) |

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
- EAS Build injects its own upload credentials after Prebuild; the local fail-closed script is skipped when `EAS_BUILD=true` so an EAS build is not rejected before EAS applies its credentials.

### Verification

| Check | Result |
|---|---|
| Release without credentials | **PASS** — `:app:assembleRelease --dry-run` failed with the named `GradleException` before any release task ran. |
| Debug without credentials | **PASS** — `:app:assembleDebug` built successfully after the final permission changes and used `CN=Android Debug` (`SHA-256 fac61745…033b9c`, the existing debug key). The debug manifest keeps `SYSTEM_ALERT_WINDOW` for the React Native dev menu; none of the other blocked permissions are present. |
| Release with a disposable verification key | **PASS** — `:app:assembleRelease` built a release APK signed by `CN=Stage 3 Verification Only - NOT PRODUCTION` (`SHA-256 c7f364be…15e8c9`), distinct from the debug key. The APK was inspected and deleted after verification. |
| Package ID | **PASS** — `in.uxcommunity.app`. |
| Version | **PASS** — `versionCode 1`, `versionName 1.0.0`, matching `app.json`. |
| Production keystore | **NOT VERIFIED** — no production keystore or EAS credential is available in this workspace. None was generated or replaced. The disposable key exists only under `/tmp` and is deleted after verification. |

The release APK is a verification artifact only. It was not uploaded or published.

---

## 8. Version management

- `app.json` is the single source: `expo.version` (`1.0.0`) and `expo.android.versionCode` (`1`). Prebuild writes both into the generated Gradle project.
- `eas.json` uses `appVersionSource: "local"` and no longer auto-increments remotely, so local Gradle and EAS builds read the same values.
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
| Full web unit suite (`npx tsx --test` over 149 files) with `APP_ENV=production` | **PASS** — 1,192 tests, 0 failures. |
| `npx eslint .` in `apps/web` | 43 errors / 25 warnings, all pre-existing; advisory job unchanged. |
| `npm run build --workspace=apps/web` with a clean environment and CI dummy values | **PASS** — Next compiled and generated all routes. |
| `npm run typecheck --workspace=apps/realtime` | **PASS** |
| `npm run test:realtime --workspace=apps/realtime` (final CI subset) | **PASS** — 23 files, 271 passed, 5 load-only skipped, 0 failed in 229.86 s. |
| `npm run test:mobile-security` | **PASS** — 28 tests, including the new Android release/version assertions. |
| `npm run typecheck` in `expo-app-standalone 3` | **PASS** |
| `npm run version:check` | **PASS** — `versionName 1.0.0`, `versionCode 1`. |
| `./gradlew :app:assembleRelease --dry-run` without signing credentials | **PASS (expected failure)** — `GradleException` naming the four variables; no release task ran. |
| `./gradlew :app:assembleDebug` | **PASS** — debug APK, debug certificate. |
| `./gradlew :app:assembleRelease` with a disposable verification keystore | **PASS** — release APK, release certificate, package/version verified. |
| `node scripts/audit-comments.mjs` | **PASS** (three stale allow-list warnings only). |
| `node scripts/audit-vercel.mjs` | **PASS** — 1,721 tracked files, no drift. |
| `actionlint .github/workflows/*.yml` | **PASS structurally** — only two pre-existing shellcheck notes (`ci.yml` unit-test glob, `deploy.yml` pre-existing `export`). |
| `npx yaml-lint` on changed workflows | **PASS** |
| Intentional failing realtime test | **PASS (proof)** — a temporary `expect(1).toBe(2)` test made `vitest run` exit **1**; it was deleted immediately. The CI step runs the same command with no `continue-on-error`, so a red realtime test fails the job. |

**Final realtime subset:** 23 files passed, 271 tests passed, 5 load-only tests skipped (3 in `realtime.integration.test.ts`, 2 in `ws-ownership.test.ts`), 0 failed in 229.86 s. The observed full-suite run before the split passed 272/276 with the same three skips and one 1000-client load case failing under simultaneous local Android/web builds — the reason the load cases were moved to the manual workflow. The final run was executed with the committed CI fixture copied over `.dev.vars` and `APP_ENV=development`, matching the CI job.

---

## 12. Remaining GitHub secrets or manual configuration

No new GitHub Actions secret is required for CI or for the production gate.

Manual items:

1. **Android upload keystore** — configure the four `UXCOMMUNITY_ANDROID_*` variables or `android/keystore.properties` on the release machine. The production key is not in this workspace.
2. **EAS credentials** — if EAS is used for production, its Android upload credentials must already be configured in EAS; the local fail-closed script is intentionally skipped for EAS builds.
3. **Branch protection** — enable required status checks on `main` (currently unprotected). Recommended checks: `TypeScript`, `Unit tests`, `Realtime correctness`, `Web build`, `Mobile chat loading`, `Environment isolation`, `Comment audit`, `Deployment targets`, plus `Database baseline` when the repository settings allow path-filtered checks.
4. **Production approval** — the existing `Production` environment approval is unchanged and still required.
5. **Staging** — `STAGING_CONFIGURATION`, `STAGING_DATABASE_PASSWORD`, `STAGING_SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_STAGING_*` are unchanged; staging remains ready for verification.

---

## 13. Unresolved risks and limitations

1. **Production signing certificate is not verified.** The real upload keystore is not available; only the fail-closed behavior and a disposable-key release build were verified.
2. **`versionCode` monotonicity is process-enforced.** There is no remote release ledger; a skipped `version:bump` would repeat a code. The tooling and README make the correct step explicit.
3. **The exact-SHA production gate was not exercised end-to-end.** No production dispatch was made, per the constraints. The workflow structure, dependency and SHA checks are in place and lint-validated.
4. **GitHub Actions has not run the new jobs yet.** The local commands passed; the PR run is the first real CI execution and should be watched, especially the `web-build` job and the realtime runner duration.
5. **ESLint remains advisory** because of pre-existing rule debt; it does not block a release. This is unchanged.
6. **The CI web build adds time** to every PR (a full Next build). It is the build validation required by this stage; the deploy still performs its own OpenNext artifact build with production secrets.
7. **EAS-managed signing was not exercised.** The guard is intentionally skipped under `EAS_BUILD=true`; EAS credential behavior is documented but unverified in this workspace.
8. **The release APK is architecture-limited.** The final verification build used `-PreactNativeArchitectures=arm64-v8a` to keep the verification cycle short; the normal release command builds all configured architectures.

---

## 14. Staging and production readiness

- **Staging:** unchanged and independent. It remains ready for verification; merge to `main` will deploy the merged commit through the existing staging workflow.
- **Production:** structurally protected. A release now requires a green full CI run in the same workflow run and on the exact dispatched SHA, plus the existing Production environment approval; `main` moving after dispatch blocks the release. The first real dispatch will confirm the Actions wiring.
- **Android:** the signing path is fail-closed and verified locally; the real production upload key remains a manual release-machine configuration. No APK was published.
