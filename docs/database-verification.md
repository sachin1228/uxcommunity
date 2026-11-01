# Database verification

The updated workflow runs two disposable checks with pinned Supabase CLI
`2.122.0`: the frozen current service lock, and an official Supabase PostgreSQL
`17.6.1.054` image pinned by SHA-256 for production-compatible staging. The latter
must report PostgreSQL `17.6`, UTF8 and production's `en_US.UTF-8` collation/ctype;
otherwise it fails. It uses the same application baseline, capture/comparator,
protection and initialization tests, with no historical application SQL.

The staging test uses the CLI's upstream Docker backend because the current
native/slim artifact releases do not publish a 17.6 database. This is a disposable
test profile only; no second active application migration directory/configuration
or remote project is created. The normal developer workflow keeps the reviewed
current service lock. Platform service versions can differ from production and
are reported separately in the full catalog comparison.

Local native verification passed: 86 empty public tables, no storage buckets,
zero unexpected application differences, both protection behavior tests, all
public routine bodies validated, repeatable initialization, conflicting settings
rolled back atomically, service-role signup RPC succeeded, and initialization
left schema unchanged. Eleven Python comparison/initialization/timestamp contract
tests also passed locally, including blocking public-schema and default-grant
checks. Normal `db:start -- --runtime native`, `db:init` twice and `db:stop` were
also exercised on a new unlinked developer stack and then cleaned up.
The existing RPC, public-read security and member-count SQL suites also pass
locally with self-contained rollback-only fixtures and the production bigint
contract. Both GitHub database jobs now run these suites too; TAP plans and
assertion counts must match, and every assertion remains checked.

CI has no secrets or production connection settings. It compares metadata from
the approved committed snapshot; no production rows are copied. Status keys and
local connection details stay in private temporary files, outside artifacts.
Every application-schema difference fails except the two approved protections
and the narrowly reported PostgreSQL deparser rendering difference. Managed
platform differences are fully listed, not removed to force equality.

PR #737 carries `skip-preview`; the preview job checks that label before any
deployment secret is accessed. This task runs database/quality CI only.

## GitHub execution evidence

[Database workflow run 41226996625](https://github.com/sachin1228/uxcommunity/actions/runs/41226996625)
**passed** at PR head `f77848a3`. Both `fresh-database` and
`production-compatible-staging` succeeded. The ordinary
[quality CI](https://github.com/sachin1228/uxcommunity/actions/runs/41226996534)
also passed, and [preview deployment](https://github.com/sachin1228/uxcommunity/actions/runs/41226996531)
was **skipped**. This records the executed revision; subsequent commits have
their own required checks and must not be called passing until those runs finish.

The downloaded staging evidence is committed at
[`supabase/schema/staging-verification`](../supabase/schema/staging-verification/):
`fresh-catalog.json`, `verification.json`, the full Markdown object list, and
`schema-differences.json` with exact source/result definitions for every difference.
The saved staging capture was also rechecked locally with the strengthened
public-schema/default-privilege assertions: **zero unexpected differences**.

## Matching staging result

| Check | Result |
| --- | --- |
| Image | Official `supabase/postgres:17.6.1.054`, digest `sha256:982abcf1b97c2787f002327d0b30224f1bad819748a22bb1e979bb42dd701a48` (official ECR mirror) |
| Actual PostgreSQL | `17.6`, same as the approved production snapshot |
| Encoding, collation, ctype | `UTF8`, `en_US.UTF-8`, `en_US.UTF-8`, all match captured production values |
| Baseline/history | Applies to empty application schema; exactly baseline version `20261031163000` recorded |
| Application objects | 86 tables, 5 views, 793 columns, 419 constraints, 304 indexes, 110 routines, 39 triggers, 20 policies, 2 enums |
| RLS / grants | All 86 public tables have RLS enabled; relation/routine/column/schema ACLs and public default privileges compared |
| Schema differences | Zero unexpected application differences; 3 approved object additions for the two protections; 1 explicitly reported equivalent deparser label difference |
| Behavior | Boolean default/NOT NULL/false preference, non-null uniqueness, multiple NULLs and audit immutability passed |
| Initialization | Repeat run preserves values/IDs/timestamps; conflicting input rolls back; actual service-role signup succeeds |
| Adoption rehearsal | Documented transaction rejects wrong ledger digest; replaces 5 synthetic entries; preserves populated user; pinned CLI applies future migration without baseline replay |
| Data isolation | All 86 application tables and storage buckets empty before tests; only fictional local test fixtures; no production data copied |
| Cleanup | Owned disposable stack destroyed successfully |

The complete staging catalog reports **351** platform/configuration differences:

| Category | Differences |
| --- | ---: |
| Managed schemas / relations / columns | 3 / 28 / 186 |
| Managed constraints / indexes / routines / triggers | 39 / 45 / 13 / 1 |
| Managed sequences / roles / memberships | 4 / 6 / 7 |
| Managed default privileges / extensions | 3 / 4 |
| Publications / publication tables / event triggers | 1 / 7 / 3 |
| Database configuration | 1 |

Examples include disposable service migration revisions, realtime objects,
`supabase_functions`, the staging-only `pg_graphql` extension and its event
triggers, extension ownership and database grants/settings. Their exact values
are all retained in the linked comparison JSON. No production-managed objects
were changed to force equality. The current locked PG17.11 Docker run reports
334 platform/configuration differences and also uses `en_US.UTF-8`.

The `report_groups` difference is a DDL/deparser round trip adding redundant
`AS text` labels on non-leading UNION arms. It occurs on the tested 17.6 and
17.11 images; view output columns are independently identical. It is reported,
never treated as an unreported schema match. Public schema/default grants are
blocking assertions, not part of the platform exception category.

## Remaining limitations

- Staging matches the captured version and locale names. The snapshot does not
  record production's exact image build, libc/ICU library versions or collation
  provider; byte-for-byte platform equivalence is not established. Hosted
  Supabase internals/service revisions remain separate from application DDL.
- The approved snapshot is from 31 October 2026. Production may change after
  capture; adoption still requires a new read-only comparison, uniqueness
  preflight, secured backups, deployment freeze and explicit approval.
- Cities, design sectors and job titles require operator-approved installation
  input because current code defines no universal defaults. A local initializer
  does not provision hosted environments or external R2/Redis/email services.
- Schema equality and the tested signup/protection flows do not establish every
  unrelated application workflow. Archived-seed-specific SQL suites remain in
  the repository; they must not be used to demand historical catalog rows from
  a fresh baseline. No existing tests were removed or skipped to pass CI.
- Production protection DDL and ledger adoption are **not performed**. The PR is
  not merged and nothing is deployed. No migration is needed merely to merge.
