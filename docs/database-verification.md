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
left schema unchanged. Ten Python comparison/initialization/timestamp contract
tests also passed. The full current GitHub results and staging artifacts are
recorded below after the updated workflow completes; no pending run is a pass.

CI has no secrets or production connection settings. It compares metadata from
the approved committed snapshot; no production rows are copied. Status keys and
local connection details stay in private temporary files, outside artifacts.
Every application-schema difference fails except the two approved protections
and the narrowly reported PostgreSQL deparser rendering difference. Managed
platform differences are fully listed, not removed to force equality.

PR #737 carries `skip-preview`; the preview job checks that label before any
deployment secret is accessed. This task runs database/quality CI only.
