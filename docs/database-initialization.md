# Fresh application initialization

The baseline creates schema only. Initialization is a separate, explicit,
insert-only operation; it is never a migration, automatic seed, reset, production
data export or historical replay. No bucket, account, company or community is
created by initialization.

## Required configuration and its current sources

`supabase/initialization/required.json` contains only these application defaults:

| Record | Value | Current source |
| --- | --- | --- |
| `posts_daily` | 3 / `day` | `apps/web/lib/creation-limits.ts`, `CREATION_LIMIT_MESSAGES.posts_daily`; baseline `enforce_post_creation_limit` and `creation_window_start` |
| `events_monthly` | 5 / `month` | Same messages module, `events_monthly`; baseline `enforce_event_creation_limit` |
| `jobs_monthly` | 3 / `month` | Same messages module, `jobs_monthly`; baseline `enforce_job_creation_limit` |
| `dms_monthly` | 5 / `month` | Same messages module, `dms_monthly`; baseline `get_or_create_dm`, `bump_usage_counter` |
| `communities_total` | 5 / `total` | Same messages module, `communities_total`; baseline `enforce_community_creation_limit` (live owned communities) |
| `community_joins` | 10 / `standing` | Same messages module; `apps/web/lib/communities/join-slots.ts` `JOIN_LIMIT`; baseline `enforce_membership_cap` (live memberships) |
| `verification_settings` | `id=true`, `grace_days=0` | `apps/web/lib/verification/policy.ts` `DEFAULT_VERIFICATION_GRACE_DAYS`; `settings.ts` and admin verification-settings route use the singleton. Policy A still makes unapproved members read-only immediately. |

These values come from current consumers and live function definitions, not old
seed records. `creation-usage.ts` requires all six budget kinds. SQL checks require
positive counts and valid periods. Defaults are contract-tested against current
application code; a changed policy needs deliberate review. A reviewed `--config`
JSON may supply environment-specific configuration, with the same keys/periods
and verification range 0–30. Keep the join cap consistent with `JOIN_LIMIT` and
fixed limit-message copy; do not tune a policy in isolation.

## Required catalog availability; operator-owned content

At least one **active** city, design sector, experience level and job title is
needed for a normal signup. `complete_signup` checks all four and raises
`inactive_or_missing_profile_option` otherwise; the public `/api/data/*` routes
read active records. Profile/job foreign keys also reference these catalogs.

There is no current-code default list of cities, sectors or job titles. Supply
your installation's approved choices; the initializer deliberately refuses the
empty template. It cannot infer a geographic market or design taxonomy.

`supabase/initialization/experience-levels.json` is an **optional preset** of the
14 exact slug/name pairs in `DEFAULT_LEVELS` in
`apps/web/app/api/admin/experience-levels/route.ts`. Choose this preset explicitly
or supply your own nonempty experience-level list. Availability is required;
the full 14-row preset is not required. Images, Lottie files and extra choices
are optional and have no initialization defaults.

## Initialize a new local environment

From a clean checkout, install Node 22+, Python 3.10+, `psql` and Docker (or the
supported native runtime), then:

```sh
npm ci
npm run db:start
# Supported native hosts: npm run db:start -- --runtime native
cp supabase/initialization/catalogs.example.json /tmp/uxcommunity-catalogs.json
```

Edit that JSON with approved values. Its exact shape is:

- `cities`: nonempty array of `{ "name": <approved name> }`.
- `design_sectors`: nonempty array of `{ "name": <approved name> }`.
- `job_titles`: nonempty array of `{ "slug": <approved_slug>, "name": <approved name> }`.
- `experience_levels`: same slug/name shape; leave `[]` only when choosing the preset.

Names must be trimmed, 1–100 characters. Slugs use lower-case letters, digits
and single underscores between words, matching the admin routes' convention.
No production identifiers, image URLs or rows are needed. Database UUID/default
timestamps and `is_active=true` come from the current schema.

```sh
npm run db:init -- --catalogs /tmp/uxcommunity-catalogs.json \
  --include-default-experience-levels
# Omit the flag when supplying your own experience levels.
```

The command discovers and verifies **this checkout's unlinked local stack**;
it accepts no remote URL or production credentials. Remove stale gitignored
`supabase/.temp/project-ref` linkage before using it. It inserts only missing
keys in one transaction, never updates/deletes rows, and serializes concurrent
initialization calls. Matching existing rows keep their IDs and timestamps.
Conflicting budgets, verification values, labels or inactive choices abort the
entire transaction with an explicit error. Review and align the input with the
existing approved setting; configuration changes belong in the normal admin
workflow. There is no force-overwrite flag.

For a newly hosted installation, have its operator apply the reviewed,
insert-only input through that environment's approved provisioning process.
This PR's command intentionally supports local stacks only; production adoption
is a different operation and must not run initialization on existing data.

## Optional content and external prerequisites

Companies/directories, their aliases/domains, communities, invitations, users,
admin accounts, moderation records, notification preferences, Lottie settings
and storage bucket rows have no universal required rows. They remain empty.
`complete_signup` works without pre-existing communities; automatic enrollment
is a no-op when no applicable community exists. Notification preferences are
created per member by the existing application paths, with schema defaults.
The Lottie endpoint handles an empty list. Company selection is not a signup
prerequisite. Create desired content through existing admin tools.

The application also needs its documented environment variables (session key,
local Supabase service key, R2, Redis, email etc.). These are external service
configuration, never database seed rows. Admin login uses its existing
environment-based credentials; this initializer does not fabricate an admin.

## Verification

`npm run test:db` first proves every application table and `storage.buckets` is
empty, compares the complete schema, and tests both protections. It then uses
clearly fictional local catalog fixtures to test initialization twice, unchanged
IDs/timestamps, transaction rollback on conflicts, and the actual service-role
signup RPC. Signup test rows roll back. Schema comparison runs again after
initialization. The disposable stack is destroyed; no fixture is an installation
default and no application data is copied from production.
