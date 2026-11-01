# Isolation implementation and verification status

This records work following the [Phase 1 audit](environment-isolation-audit.md).
Local isolation and the dedicated staging resources are implemented and smoke-tested.
GitHub account protection settings, full browser/native-device acceptance and
recovery rehearsals remain open. Production infrastructure and data were not
changed. Supabase PostgreSQL remains authoritative; D1 migration has not started.

## Implemented

- Retired production-backed preview deployment and cleanup. PR jobs read no
  production secrets and provision no preview Worker or bucket.
- Added explicit application/build environment identity, loopback-only local
  endpoints, exact HTTPS staging allowlists, production-domain/alias rejection,
  dedicated nonproduction bucket names and database redirect rejection.
- Added a local Supabase launcher with independent project identity, private
  configuration, quarantining of prior environment files and credential/link
  sanitization; existing baseline and initializer remain intact.
- Added a local S3 adapter backed by Miniflare R2 with signed private access,
  direct uploads, range reads, copy/list/delete and captured local mail.
- Added repeatable fictional user/catalog/community/chat/thread/event/company/job
  fixtures and a runnable web/API/storage/DO smoke check.
- Disabled Expo/FCM sending, receipt cleanup and cron outside production, including
  internal manual job endpoints. Nonproduction email cannot reach Resend.
- Added independent staging Worker/cache/self-reference/realtime bindings, a
  same-origin WebSocket gateway, explicit realtime-to-web service binding, staged
  secret manifest and manual workflow. Worker-runtime tests catch unsupported
  redirect modes; isolated calls use manual redirects and reject 3xx responses.
- Added explicit mobile environment validation, separate nonproduction app IDs,
  schemes and session/push persistence; development/preview no longer default to
  the production API.
- Restricted maintenance seed, cleanup, import and media scripts to local targets.
  Removed broad remote seed/load-test overrides and published staging secret
  fallbacks. Local CLI tests cover rejection of production links and remote flags.
- Replaced automatic production release with approval of the exact main SHA;
  blocked direct npm deploy/upload; serialized production secrets through private
  JSON and process environment rather than shell interpolation.

## Provisioned staging resources

| Service | Staging resource |
| --- | --- |
| PostgreSQL / REST / RPC | Supabase `aprsizlxezwauwilplbj`, Sydney; existing baseline independently applied and fictional catalogs/accounts seeded. |
| Web | `https://uxcommunity-web-staging.patilsachin1228.workers.dev` |
| Realtime | `https://uxcommunity-realtime-staging.patilsachin1228.workers.dev` |
| Public/private media | `uxcommunity-staging-media` / `uxcommunity-staging-private`; both managed public endpoints disabled. |
| Next cache | `uxcommunity-staging-next-cache`; managed public endpoint disabled. |
| Community / user / monitor DOs | `d8dcc08268534002965007797c6ed408` / `377a0e52b5144664a8f1493e9036e83f` / `f51dc2ed46194cb79cd60d1154d37f05`; all differ from production. |
| Future D1 | `uxcommunity-staging-db`, `5373dc97-384d-4c16-9f82-6d6d8ca08bb1`; empty, unbound and unused by the application. |

The staging manifest and new credentials are owner-only ignored files under
`.local/staging`. Runtime secrets contain no production provider credentials.
Staging has no Resend, FCM or Upstash binding/secret, no cron schedules, and
version preview URLs are disabled. The authenticated staging-only
`/_isolation/check` endpoint checks runtime identity, database connectivity and
build/runtime agreement without returning credentials.

## Verification evidence

| Check | Result |
| --- | --- |
| Existing web unit suites with explicit production-mode dummy fixtures | 1,087 tests passed. |
| New endpoint, bucket, delivery, maintenance and Miniflare R2 integration tests | 12 passed, including real R2/SDK tests, Worker-runtime redirect rejection and production secret serialization. |
| Local Supabase setup | Passed in an isolated worktree; private manifest uses loopback database/API and independent credentials. |
| Local fixture initialization and seeding | Passed; catalogs, signup RPC, user and fictional content created only locally. |
| Realtime session, membership configuration and retention suites | 17 tests passed after final changes. |
| E2E seed and load-test target policy unit tests | 25 tests passed. |
| Mobile realtime unit suites | 71 tests passed; environment/native identity checks also pass. |
| Post-deploy smoke harness guard tests | 21 tests passed; production session writes require release approval. |
| CLI migration guard, migration filename and initializer contracts | Three tests each passed. |
| Deployment credential guard unit suites | 63 tests passed with stub providers. |
| Web/realtime TypeScript | Passed with the final runtime helper and staging binding types. |
| OpenNext build using staging configuration | Passed with the dedicated staging manifest; staging web and realtime Workers deployed. Production was not deployed. |
| Local supervisor lifecycle | Passed: a fresh supervisor started web/realtime/storage and SIGTERM closed all three listening ports. |
| Local end-to-end smoke | Passed: login, authenticated API, application avatar upload/media delivery, two-user DO chat delivery and refused cron endpoints. |
| Production continuity | Read-only API snapshots show identical production Worker modification timestamps and binding/settings objects; production schedules retained. No production application writes or deployment performed. |
| Live staging smoke | Passed: authenticated diagnostic/runtime agreement, login, cookie and mobile bearer API sessions, avatar upload/public media, two-user DO chat delivery, and four internal cron endpoints refused. |
| Live private staging R2 | Signed upload/download passed; unsigned reads, tampered signatures and public-media access to the private key refused. |
| Live resource isolation | API readback confirms staging-only R2/service bindings, distinct DO namespace IDs, no staging schedules, no live provider secrets, and disabled managed public bucket endpoints. |
| Physical mobile devices / nonproduction native builds | Pending separate client/native configuration and device access. |

## Remaining external work and security gaps

1. Keep ongoing staging deployment/database credentials scoped to staging. Initial
   provisioning used the existing authenticated operator CLI to create only the
   named staging resources. No operator OAuth token or database password was
   uploaded to a Worker. Runtime storage permissions are dedicated R2 bindings,
   not a broad S3 API credential.
2. Complete the staging acceptance matrix beyond the recorded smoke flow: signup,
   password reset/mail capture, private resume/DM flows, full browser navigation,
   and nonproduction native/device builds. No real-user push transport is enabled.
3. Populate the GitHub `staging` and protected `Production` environments. Reviewers
   and environment secret scopes cannot be established by a YAML declaration.
   Production secrets remaining at repository scope are a security gap even
   though this branch's preview workflow no longer reads them. Audit/remove old
   deployed previews and revoke their production access through a reviewed change.
4. Review Cloudflare/Supabase operator token resource policies and record a full
   no-production-destination network trace. Namespace IDs, Worker bindings and
   disabled schedules were read back from the live API; URL checks alone do not
   prove deployment-token scope.
5. Configure/build distinct mobile native apps; inspect installed API/realtime
   endpoints and test session separation on devices. Keep push delivery disabled
   until a separately approved test-device transport exists.
6. Record and rehearse production DB/R2/DO recovery coverage on isolated resources.
   No production backup/export, credential rotation, restore or ledger change was
   performed as part of this setup.
7. Other checkouts must adopt this branch and run the supported launcher. The
   original checkout still contained production-connected web configuration; its
   ignored web/realtime files were quarantined and its old development server was
   stopped. Its tracked source branch was left unchanged. Use the isolated worktree
   until the PR is available in that checkout.

GitHub protection policies, the remaining acceptance matrix and recovery evidence
are required before final isolation sign-off. See
[operating instructions](environments.md) for the supported local and staging
commands and release/backup boundaries.
