# Running isolated environments

The application still uses Supabase PostgreSQL, REST and SQL RPCs. This setup
does not implement D1, copy production data, or adopt production's migration ledger.
See [implementation status](environment-isolation-implementation.md) for live
provisioning and verification that remain outstanding.

## Development on macOS

Use Node 22+, Python 3.10+, `psql`, and the pinned Supabase CLI's native runtime.
The native stack is already pinned by `supabase/supabase.lock`.

```sh
npm ci
npm run env:setup
npm run env:seed
npm run dev
```

Setup creates an unlinked stack in `.local/development` with its own project
identity and applies only the active schema baseline. It generates independent
session, API, publish, admin, user and local-storage credentials. Previous web,
realtime and mobile environment files and stale Supabase links are moved into
an owner-only directory under `~/.config/uxcommunity/quarantine/`. It does not
rotate or alter production credentials. `.local/` and generated credential files
must stay ignored by Git. Startup logs and manifests contain local secrets and
are written with owner-only permissions.

The launcher pins this checkout to its existing local stack by stack id, so
switching Git branches resumes the same database; without the pin the CLI treats
each branch as a new, empty stack. It checks the stack identity and loopback
endpoints before starting Next, the local realtime Worker and Miniflare-backed
R2. It does not inherit production service variables or a Cloudflare deployment
token. Missing
configuration is an error. Re-running setup preserves an existing valid local
manifest rather than rotating application credentials or resetting data. It restarts
the native stack and refreshes its loopback API port/service key when necessary.

Default ports are web **3000**, realtime **8787**, and storage/mailbox **8788**.
For a separate worktree, choose unused ports on the first setup:

```sh
UXC_WEB_PORT=3130 UXC_REALTIME_PORT=8797 UXC_STORAGE_PORT=8798 npm run env:setup
```

The chosen endpoints are saved in the private manifest. Each checkout uses a
distinct Supabase project identity and local persistence. Do not reuse another
checkout's generated environment files. Use `npm run env:stop` to stop its
database; stop its development supervisor with Ctrl-C first.

The seeded users are `designer@development.invalid` and `peer@development.invalid`. Its random password and the
separate dummy admin credentials are in `.local/development/environment.json`.
Fixtures include the original reference catalogs, a profile, a private community, message,
thread, event, company and job. Seeding inserts missing fixture IDs and preserves
existing content. Cleanup/reset is never automatic. Local migration tooling
refuses remote links, DB URLs, push/repair operations and resets without an
explicit local flag. Disposable schema verification remains `npm run test:db`.

After pulling new migration files, apply the pending versions to the running
stack with `npm run db:migrate:local`. It reads the loopback stack from
`.local/development`, syncs the active migration files, and pushes with the
pinned CLI; a non-development manifest or non-loopback database URL is refused.

### Storage, mail and notifications

Media uses dedicated local public/private R2 buckets through a loopback S3
adapter. It validates SDK signatures and expiring signed URLs. Public media is
readable locally; private objects require a valid signature. Uploads, copies,
list/head/get/range operations and deletes operate on Miniflare state. No account
S3 endpoint is contacted. This adapter is for local development only.

Emails are captured in the local mailbox, never sent through Resend. The
storage/mailbox service is part of `npm run dev`; it starts automatically on
port **8788** next to web and realtime. Read captured email and verification
codes with:

```sh
npm run mail:local
```

The viewer reads the private manifest, prints messages newest first, and shows
6-digit codes and links. If the service is not running it names the port and
tells you to start `npm run dev`. The mailbox only exists inside that supervisor;
a web or realtime process started on its own does not provide it, so stop it and
restart the full stack. Raw access is `GET <R2_ENDPOINT>/__mail` with
`Authorization: Bearer <API_SECRET>` from `.local/development/environment.json`.
The mailbox retains up to 100 messages in memory and resets on restart. Do not
expose it on a LAN or tunnel it publicly.

Expo sends, FCM sends, receipt processing and native push registration are
disabled outside production. Supplying a production-looking key or device token
does not enable delivery. Cron schedules are empty for development/staging;
scheduled drivers and internal job endpoints also refuse nonproduction execution.
Local rate limits use a bounded in-memory limiter; staging may configure its own
allowlisted Upstash endpoint and namespace. The local limiter is not distributed.

```sh
npm run test:environments
# With the development supervisor running and fixtures seeded:
npm run env:smoke
```

The smoke command verifies local login, the authenticated API, an application
avatar upload, local media delivery, a real DO chat event, and disabled internal
cron endpoints. It refuses a nonlocal database before any request.

## Staging

Use a **new Supabase project** compatible with the existing baseline and current
REST/RPC contract. Do not reuse the production project or apply D1 SQL. Apply the
baseline only to the new empty database through its separately reviewed
provisioning process; initialize reference catalogs and test users. The ordinary
local CLI wrapper deliberately cannot perform remote migration operations.

Copy `config/environments/staging.example.json` to the ignored
`.local/staging/environment.json`. Supply new staging secrets and exact URLs.
There are no production fallback values. `STAGING_ALLOWED_ORIGINS` is a
comma-separated list of exact HTTPS origins for staging web, Supabase, realtime,
public media and optional Redis. Production domains, known Worker aliases and
the production Supabase project remain forbidden even if placed in that list.

Use staging web/realtime Workers on Workers subdomains or a separate registrable
domain. Current production cookies use `.uxcommunity.in`, so staging under that
same parent is deliberately refused. Changing the production cookie scope would
need a separately reviewed production rollout.

Set `NEXT_PUBLIC_REALTIME_URL` to `<NEXT_PUBLIC_APP_URL>/_realtime`. The staging
web entry point forwards only WebSocket upgrades at `/_realtime/ws` through the
staging realtime service binding. Browser cookies stay on the staging web host.
`REALTIME_URL` is the separate staging realtime Worker URL used by server-side
publish/revocation. The realtime Worker's `API_URL` points back to staging web;
session and membership checks use its explicit `WEB_SERVICE` binding.
[Cloudflare documents](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
this direct Worker-to-Worker transport. No binding targets a production Worker.

Staging uses `uxcommunity-staging-media`, `uxcommunity-staging-private` and
`uxcommunity-staging-next-cache` through dedicated Worker bindings. It has no
Cloudflare S3 API credential at runtime. `R2_ACCESS_KEY_ID=staging-runtime` and a
fresh `R2_SECRET_ACCESS_KEY` sign only this application's staging upload/download
URLs. Set `R2_ENDPOINT=<NEXT_PUBLIC_APP_URL>/_s3` and
`R2_PUBLIC_URL=<NEXT_PUBLIC_APP_URL>/_media`. The wrapper validates signatures and
serves unsigned public reads from the media binding only; private reads require
an expiring signature and use `private, no-store`. Uploads are limited to 55 MB.
The buckets themselves keep public access off; browser uploads are same-origin.
Server-side S3 operations use the same two scoped bindings. The independent
Wrangler configuration also binds its own cache and self-reference.

```sh
node --import tsx scripts/environments/staging.mjs validate
# Only with explicit staging-scoped credentials supplied privately:
node --import tsx scripts/environments/staging.mjs provision-storage
```

Provisioning requires `CLOUDFLARE_STAGING_API_TOKEN` and
`CLOUDFLARE_STAGING_ACCOUNT_ID`, with no fallback to production credentials. If
Cloudflare permissions cannot exclude production resources, use a separate
account. The script stops on a failed command; it does not delete/recreate an
existing bucket or change public-access settings automatically.

After authenticated resource review, create a GitHub `staging` environment with
the five secrets listed in [Deployment](DEPLOYMENT.md). Every merge to `main`
migrates and deploys staging automatically; the workflow remains manually
dispatchable for re-runs. It validates the manifest and isolation tests and
targets only staging configurations. Existing DO migration tags are preserved;
the staging monitor class uses its own v4 migration. Inspect live namespace IDs
and existing migration state before the first deployment.

The workflow does not create a Supabase project, domain, Redis service or test
accounts. The separately provisioned staging D1 database is empty and unbound;
PostgreSQL remains the application's database. A passing manifest check alone
does not prove live isolation.

Staging SQL migration operations use the explicit `STAGING_DATABASE_REF` in the
private manifest, matched to its exact Supabase origin. The production reference
is always rejected. Supply `STAGING_DATABASE_PASSWORD` privately for migration
planning/application; it is never uploaded to a Worker. The CLI uses an explicit
project reference rather than a shared linked project. Use staging-scoped
Supabase operator credentials for ongoing automation. In CI, supply the separate
`STAGING_SUPABASE_ACCESS_TOKEN`; no production token is a fallback.

The deploy workflow runs `staging-db.mjs plan` and `migrate` before deploying, so
manual migration application is not part of the normal flow (see
[Deployment](DEPLOYMENT.md)). Fixtures and smoke remain manual:

```sh
node --import tsx scripts/environments/staging-db.mjs seed
node --import tsx scripts/environments/smoke.mjs --staging
```

To measure browser-visible community chat opening time, run the read-only
benchmark against the staging web Worker. Each sample uses a fresh browser
context and reports the time until the positioned timeline (or confirmed empty
state) and enabled composer have painted. Request durations and bootstrap
`Server-Timing` phases are reported separately; background catch-up never gates
the visible-readiness metric. Reports use `metricVersion: 2`; earlier reports
waited for a messages response and are not a comparable first-paint baseline.
The benchmark does not send a message
or write to the database.

```sh
E2E_APP_URL=https://uxcommunity-web-staging.patilsachin1228.workers.dev \
E2E_COMMUNITY_ID=<community-uuid> \
E2E_EMAIL=<staging-member-email> E2E_PASSWORD=<staging-member-password> \
E2E_SAMPLES=10 E2E_CHAT_TIMING_OUT=.local/staging/chat-open-timing.json \
  npm run bench:community-chat-open
```

An existing `uxcommunity_session` cookie can be supplied as
`E2E_SESSION_COOKIE` instead of email and password. Keep credentials and the
generated report in ignored `.local/staging/` files; do not commit them.
For the protected GitHub Actions path, run **Deploy isolated staging** with
`mode=benchmark`; it seeds only the documented idempotent test fixture and
uploads the report without deploying Workers.

For a matched before/after run, select `mode=compare` and supply the exact
pre-fix commit SHA as `baseline_ref`. The staging-only job deploys that revision
with readiness DOM annotations, runs the current benchmark, restores the merged
revision even if the baseline test fails, then measures it on the same runner.
It uploads separate before/after reports with commit and browser versions.

Run `npm run test:community-chat-open` for the route and browser readiness
regressions (install Chromium with `npx playwright install chromium` first).

Seed loads the offline reference catalog snapshot and fictional accounts only. It
rejects production before issuing any database request. Staging fixture logins
are `designer@staging.invalid` and `peer@staging.invalid`; their random password
is in the private staging manifest. The ordinary local wrapper continues to
refuse all remote migration operations.

## Mobile

Build profiles now select an explicit data environment. Development points to
local services. The preview profile now selects the provisioned staging web/realtime gateway
and must match `EXPO_PUBLIC_STAGING_ORIGIN`; omitted or mismatched values fail. Production keeps its existing
API, realtime URL and app identifiers.

Nonproduction app config gives each mode a separate package/bundle ID and URL
scheme, and session/push storage keys are environment-specific. The production
package-specific Android chat-notification plugin is omitted in nonproduction. It does not reuse
the production Firebase client configuration. Nonproduction push is disabled.
Regenerate native projects under the intended profile; an old installed binary
does not change endpoints when an environment file changes. Separate Firebase
client/native build configuration and physical-device validation remain required.

The current local guard accepts loopback. iOS simulators can reach the Mac this
way; Android development requires explicit `adb reverse` mappings for all three
ports. Arbitrary LAN origins are not silently allowed. Existing production apps
and production Firebase configuration are unchanged by the nonproduction config.

## Production release and recovery

Staging deploys automatically on every merge to `main`; production releases are
manual and approved. The workflow, migration order, secrets and rollback rules
are in [Deployment](DEPLOYMENT.md). Keep the `Production` environment's
reviewers, branch policy, bypass restrictions and secrets configured before
enabling releases. Remove production credentials from repository-wide
preview/development scopes; code alone cannot change that account setting. Pull
requests run CI only and deploy no resources. Supported direct
npm deploy/upload commands refuse to publish.

Production secret values pass through structured step environment variables and
private JSON files, not interpolated shell code. Build secrets are inherited by
the build process; only public settings are written to its dotenv file. Worker
secret updates use JSON bulk operations. This preserves quote, dollar and
backslash characters. Deployment remains an explicitly approved operation.

Before any separately approved production schema operation, record the target,
SQL/checksum and Git SHA; confirm backup/PITR coverage and RPO/RTO; secure a
complete migration-ledger export; and rehearse restoration on an isolated target
with cron and delivery disabled. Record who restores DB, public/private R2 objects,
Worker versions/secrets, domains/routes and DO state. R2 object backup and DO
recovery require separate evidence; a database backup does not cover them. A code
rollback does not restore deleted data. Preserve production data and stop when
restore evidence or approval is absent.


## Reference catalogs for realistic testing

`config/environments/reference-catalogs.json` contains an offline snapshot of the
application's public active catalog labels: 28 cities, 19 sectors, 6 job titles
and 5 experience levels. The adjacent source manifest records provenance and a
checksum. Seeding never fetches production; it reads this committed snapshot.
Only names/slugs are included. Database IDs are generated independently in each
environment, and production media URLs, users and credentials are excluded.

Both `env:seed` and the staging `seed` command synchronize those labels and
activate the reference options. They deactivate the old Development City,
Development Design, Development Designer and superseded generic experience
choices. Existing rows, IDs, profiles and user content are preserved. Fixture
creation selects active catalog entries. A profile already saved with an old
placeholder retains that selection until its owner chooses a new value.
