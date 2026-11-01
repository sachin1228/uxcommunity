# Proposed environment isolation implementation plan

**For review after Phase 1; no steps below have been executed.** This plan follows
the [audit](environment-isolation-audit.md) at revision `48215d4f`. It establishes
three environments while preserving the current Supabase application contract.
It does not start the Supabase-to-D1 migration.

## Target resource contract

Names below are proposals, not claims that resources have been provisioned.
Inventory authenticated account state and resource ownership before choosing
final names or reusing the existing staging realtime Worker.

| Resource | Development on Mac | Staging | Production during this setup |
| --- | --- | --- | --- |
| Application identity | `APP_ENV=development`, local public build marker | `APP_ENV=staging`, matching public build marker | Preserve current public URLs and runtime behavior; introduce production identity only through reviewed changes |
| Web/API | Local Next/OpenNext runtime, loopback or explicitly approved device LAN origin | `uxcommunity-web-staging` | Existing `uxcommunity-web` |
| Database now | Unlinked local Supabase PostgreSQL stack from current baseline | **New dedicated Supabase project** with its own keys/ledger; target compatible PostgreSQL/locale and current REST/RPC contract | Existing authoritative Supabase PostgreSQL, unchanged |
| Future D1 | Dedicated local D1 state, only when migration work is separately approved | Reserve `uxcommunity-staging` identity; optional empty dedicated D1 resource after approval, never wired as the current DB | Future dedicated production D1 belongs to the later migration; no provisioning/binding/cutover now |
| Public media | Local Miniflare R2, distinct local bucket/state | Proposed `uxcommunity-staging-media`, separate delivery host | Existing production public bucket and domain |
| Private media | Separate local R2 bucket, authorization-gated reads | Proposed `uxcommunity-staging-private`, public access disabled | Existing private bucket |
| Next incremental cache | Local R2 cache/state | Proposed `uxcommunity-staging-next-cache` | Existing `uxcommunity-web-next-cache` |
| Realtime / DO | Local realtime Worker; local `Room`, `UserDO`, `AlertMonitor` state | Dedicated staging realtime Worker/namespaces, reconciled migration tags and bindings | Existing Worker/namespaces/migration history |
| Internal authentication | New local session/API/publish secrets, shared only between local components | New staging-only session/API/publish secrets | Existing secrets remain in production scope |
| Redis/rate limits | Local implementation of limiter contract | Dedicated Upstash database and credentials; environment prefix as additional protection | Existing Upstash configuration |
| Transactional email | Local capture transport; synthetic `.invalid` users | Capture/deny by default; optional staging Resend key and fixed tester allowlist | Existing Resend sender/key and delivery |
| Push | Capture/disabled at provider boundary, no real token registration | Capture/disabled by default; later isolated Firebase/Expo test application and device allowlist | Existing FCM/Expo configuration |
| Scheduled jobs | Disabled by default; explicit local test invocations | Explicit `crons=[]`; manual handlers also gated | Existing schedules and behavior |
| Mobile | Local API/realtime pair; device LAN host when needed; development app ID | Staging API/realtime pair; staging app ID/Firebase config/EAS profile | Existing production identifiers/endpoints |
| Deploy credentials | None needed for local data access | Staging-only token/resource permissions and GitHub `staging` environment | Protected GitHub `Production` environment and deployment token |

Cloudflare bindings/vars must be explicitly specified for each named environment;
they are non-inheritable. A distinct Worker name gives DOs a distinct storage
identity when bindings target that Worker. Validate deployed identities instead
of relying on naming. See [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
and [DO environments](https://developers.cloudflare.com/durable-objects/reference/environments/).

## Sequenced work and review boundaries

### 1. Contain unsafe deployment paths before the next implementation PR

After approval of this plan, retire production-backed PR previews first. Disable
their deployment path until isolated staging/preview credentials and bindings
exist. Removing only realtime publish secrets is insufficient. Move production
credentials out of repository-wide scopes; use the actual protected `Production`
GitHub environment, explicit permitted main/release refs and a required human
approval. Restrict bypasses; disable self-approval where a second maintainer is
available. A typed confirmation input alone is not the approval gate.

Protect both production deploy and any later migration workflow, including manual
dispatch, secret-update commands and direct CLI release paths. Scope Cloudflare
tokens so staging/preview jobs cannot edit production Workers, routes, namespaces,
buckets or secrets. If account-level permissions cannot enforce the required
boundary, use a separate Cloudflare account for nonproduction instead of relying
on names. Do not use a production token to clean up previews.

Setting up release protection does not deploy code. Create/populate protected
secret scopes, validate access, then switch workflows without deleting the live
Worker secrets. Confirm independent rollback access before changing deployment
credential storage. Revoke old preview access only after checking which resources
and automation depend on each credential; coordinate any necessary production
rotation separately so it cannot interrupt live services.

[GitHub deployment protection](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
supports required reviewers and branch policies for jobs referencing an
environment. This repository is public; verify settings and token policies live.
PRs must not execute untrusted code with production secrets.

### 2. Establish development using the existing Supabase contract

1. Inventory and quarantine this checkout's production-linked environment files
   and `.temp/project-ref` outside all automatic load paths. Include backups,
   build output, shell overrides and generated test credentials. Use a secured
   operator backup; do not copy values into the PR or overwrite production secrets.
   Make the development launcher refuse a remote project link.
2. Use the pinned Supabase stack/config and existing schema-only baseline.
   Reuse the fresh test's identity verification and sanitized child-process env.
   Make startup/migration/init commands verify this checkout's local stack before
   any write. Do not use archived SQL or import production data.
3. Commit empty/example configuration for web, realtime and mobile; generate
   random **local-only** secrets. Produce one validated manifest for both
   `.env.local` and `.dev.vars` rather than maintaining divergent copies. Never
   export local DB keys into public build variables.
4. Add a common environment validator executed before client initialization or
   side effects. `NODE_ENV=production` also describes optimized staging builds,
   so it cannot select a data environment. Require explicit identity, valid
   endpoint pairs, expected resource names and matching build/runtime markers.
   Development accepts only verified local DB/storage/realtime endpoints. Staging
   accepts only its approved resource identities. Reject known production IDs,
   aliases and remote-binding flags in nonproduction; no silent fallback.
5. Implement the local storage path deliberately. Preserve production S3 behavior;
   introduce a storage interface for local R2 bindings and a loopback-only media
   bridge for `next dev` if it cannot access those bindings directly. The interface
   must cover list/head/get/range/put/delete/copy, direct-upload tickets, private
   downloads and URL parsing. Local HTTP must never reach the account's remote
   S3 hostname. Exercise the OpenNext local preview path too. A bucket binding
   alone cannot redirect the current AWS SDK.
6. Run local realtime with its own `.dev.vars`, API URL and DO persistence
   directory. Disable remote development/bindings and isolate persistence between
   test stacks. Provide local email capture and a local rate limiter. Gate push,
   cron and provider health probes before any remote fetch.
7. Build a repeatable, explicit development seed command on the existing insert-only
   configuration initializer. Include fictional signup catalogs, admin/test
   credentials, verified/unverified users, a community, DM/chat, event, job,
   notification preferences and local-only media. Use deterministic fixture IDs,
   no production IDs/tokens/URLs, no real email/device tokens. Cleanup/reset may
   affect only the verified disposable/local fixture target.
8. Update local/rotation/load-test documentation. Add exact target guards to every
   seeder, importer, cleanup, R2 apply/purge tool and admin load-test launcher.
   Remove broad remote overrides and staging-name heuristics as authority for
   writes. Use a reviewed nonproduction manifest, not `*.workers.dev` acceptance.

[Supabase's local workflow](https://supabase.com/docs/guides/local-development/database-migrations)
supports independent local schema iteration. [Cloudflare local R2](https://developers.cloudflare.com/r2/get-started/workers-api/)
is simulated by default through bindings; local remote bindings and direct
external HTTP are separate mechanisms and must be checked explicitly.

### 3. Provision and connect staging only after development gates pass

1. Obtain authenticated read-only inventory of existing staging Worker, secret
   **names**, DO namespace IDs/migration tags, account ownership, domains, routes,
   schedules and bindings. Compare with the approved manifest; never repurpose an
   unknown Supabase project or namespace because its name looks unused.
2. Create the dedicated Supabase staging project, public/private/cache buckets,
   realtime namespaces and dedicated Redis. Apply the baseline only to the new
   empty staging database and initialize synthetic configuration/catalogs/data.
   Record its independent migration ledger. Rehearse current SQL RPCs, grants,
   RLS, custom JWT registry and locale-sensitive behavior; no D1 substitution.
3. Add explicit staging web and realtime configuration, including self-reference
   pointing to staging web, staging cache/media resources, distinct secrets,
   public URLs and `API_URL`. Reconcile DO class migrations with deployed state;
   never rename/delete/recreate production DOs. Deploy only new staging resources
   after their secrets/bindings have been validated together.
4. Configure a staging domain and media domain. Prefer a **separate registrable
   domain** to avoid the current `.uxcommunity.in` production cookie reaching
   staging. If a subdomain is required, first design and approve the necessary
   production cookie migration; that is a production behavior change and cannot
   be smuggled into staging setup. Use matching staging web/realtime cookie scope
   and distinct names. Rebuild client URLs per environment.
5. Restrict staging access to testers; configure no-index headers, explicit CORS
   origins and independent observability. Public staging media and private media
   policies must be reviewed separately. Inspect any account-wide routes, cache
   rules, integrations or sender domains that could still point at production.
6. Set staging schedules explicitly empty. Add environment/job-enable gates to
   scheduled handlers **and** internal routes. Retention/manual tests must verify
   staging API/database/bucket identities before executing.
7. Introduce capture/deny policies at both push transport boundaries (Expo and
   FCM), email send and push registration/test endpoints. Tests must inject
   production-like tokens and prove zero provider requests. For opt-in delivery
   tests use a separate Firebase/Expo project and staging app IDs, fixed tester
   account/device allowlists and no imported production tokens.
8. Give mobile development/staging distinct bundle IDs/packages, schemes, EAS
   profiles and environment-keyed session/cache/push persistence. Verify web,
   API and realtime endpoints as one configuration unit. Never select the
   production API implicitly when a test build lacks configuration.
9. Enable staging deployment from a controlled ref and its dedicated secret scope.
   Keep arbitrary PR previews disabled, or use isolated per-PR resources with
   no production credentials. Log the commit and redacted resource manifest for
   each deployment. Do not promote a staging bundle containing staged URLs to
   production unchanged.

### 4. Production protection and recovery

Keep existing Supabase, R2, DOs, domains, mobile API and schedules authoritative.
Any production code rollout needed for shared guards follows the explicit release
approval gate and a separate reviewed diff. New guards must preserve production
configuration semantics; test that before requesting deployment approval.

Keep migrations separate from app deployment. Supply environment-specific pending
migration plans and checksums. Staging has its own apply job; production migration
requires a distinct protected approval bound to target identity, commit, SQL and
backup evidence. No automatic production baseline adoption, `db push`, `reset`,
`repair` or initialization. Existing baseline/adoption protections and the two
intentional schema differences remain a separate production decision described
in [database adoption review](database-adoption-review.md).

Document and rehearse recovery on an isolated environment: Supabase backup/PITR
availability and retention, secure DB/ledger exports, RPO/RTO and restore owner;
R2 object metadata and a tested backup/copy process for public/private buckets;
DO persistence recovery limitations and deployment/migration rollback boundaries;
previous Worker versions, secret restoration source and DNS/routes rollback.
Never assume a code rollback restores deleted DB rows, R2 objects or DO state.
Cache is rebuildable; private media is not. Record encryption/access/retention for
backups and prove restoration without sending push/email or starting cron.

This plan documents and rehearses backups; a new production export, rotation,
restore, ledger operation or deployment needs its own explicit authorization.

### 5. Verification and acceptance evidence

Run only after development/staging isolation is in place. Capture redacted
resource IDs, exact commit, commands, results and limitations for each gate.

| Gate | Required proof |
| --- | --- |
| Production denial | Start each nonproduction component with missing config and then production DB URL/key, S3 account endpoint/buckets, cache binding, realtime URL, service binding and internal API URL injected in turn. Fail **before** any outbound request. Cover build-time values, aliases, redirects and child-process environments. |
| Local network boundary | Exercise local web/mobile login, signup, upload, private download, chat and jobs with outbound production destinations blocked; record an allowed-local-only connection trace. Verify the currently installed app build, not only source env files. |
| Staging DB | Use synthetic sentinel records and staging-only credentials. Show writes exist only in staging; validate independent migration ledgers and refuse production targets offline. Do not probe production by attempting writes. |
| R2 | Upload/read/delete sentinel objects in staging public/private buckets; record bucket identity. Show cache reads/writes use the staging cache bucket. Prove staging credentials are denied production access from documented token policy, without production object write probes. |
| DO / realtime | Verify distinct deployed namespace IDs and no production `script_name`; use synthetic staging user/community IDs. Prove publish/fanout, membership/session validation and revocation between staging components; no production endpoint in the trace. |
| Cron | Confirm deployed staging trigger list is empty. Invoke disabled routes/handlers and prove no side effects. Enable a specific test job only against staging and verify staging-only ledgers, DB and storage. |
| Push/email | Exercise chat, DM, activity, membership, event lifecycle, verification and health alerts. Captured deliveries only by default; no Expo/FCM/Resend requests or real token cleanup. Opt-in device/email tests hit only approved test identities. |
| Browser/mobile identity | Production cookies never reach staging, and staging cannot replace production cookies. Test account switches, logout, registration and caches across local/staging builds; verify distinct app IDs/endpoints on physical Android/iOS as available. |
| CI and release protection | Untrusted/fork PR receives no secrets; normal PR receives no production secret. Production deploy and migration stop at independent approval gates, including manual dispatch. Verify resource token scopes and attempted wrong-target rejection without live writes. |
| Production continuity | Compare pre/post deployed versions, bindings, routes, namespaces and schedules using authenticated read-only metadata. Confirm health through approved read-only probes. There must be no isolation-task production data migration or resource replacement. |

## Proposed commit / PR sequence

1. **This PR:** audit, variable inventory and proposed plan only; skip unsafe preview.
2. After plan approval: preview containment and production deployment secret/approval
   boundaries, with no application deployment.
3. Environment identity validation, safe local launchers/templates, storage and
   provider capture adapters, guarded seed tooling and dummy fixtures; separate
   logical commits with targeted tests.
4. Staging manifests and deployment workflow, reviewed resource creation record,
   staging secrets/domain setup and mobile profiles.
5. Production protection/recovery runbooks and independent migration gate;
   review any production-affecting diff separately.
6. Verification evidence and remaining-gap report. Environment setup is complete
   only when every mandatory gate has evidence or an explicitly accepted blocker.

Before infrastructure work, review the account/permission boundary, staging DB
project/region/locale, staging domain ownership, tester allowlists and backup
owner/targets. Values unavailable during Phase 1 remain explicit inputs; no
placeholder may silently resolve to production. Defer D1 schema, adapters, data
copy and cutover to the separately approved migration task.
