# Production-derived Supabase baseline

The active migration system starts at `20261031163000_production_schema_baseline.sql`.
Its source is a fresh **read-only production catalog capture**, not any historical
migration, partial schema, data export, or seed. The source snapshot was captured
on 31 October 2026 at `2026-10-31T16:49:41.095844Z` as
`supabase_read_only_user`, with `transaction_read_only=on`.

Production was not modified, its migration ledger was not queried or changed for
this implementation, and no production adoption, repair, or deployment was run.

## Contents and scope

The baseline recreates all **86 live public tables, 5 views, 110 non-extension
public functions, 39 application triggers, 20 RLS policies, 2 public enums**, and
all their captured columns, defaults, generated expressions, checks, keys,
indexes, comments, replica identities, ACLs and application-owner default
privileges. Production has no public sequences or materialized views; the
capture/export also handles sequence metadata and materialized-view definitions
without copying their contents. The capture inventories all non-system schemas,
managed sequences, installed extensions, role attributes/memberships, grants,
default privileges, event triggers, and database configuration.

Objects currently present in production remain represented even if their names
contain `legacy` or `seed`. No inference from an object's name removes live
schema. Conversely, removed historical objects are absent. The seed-retirement
bookkeeping tables are structurally present but **empty**. Their historical data
is not included and their cleanup functions are not invoked.

The only intentional application-schema changes are:

1. `notification_preferences.community_push_enabled boolean NOT NULL DEFAULT true`.
   This is the independent switch already expected by the notification settings
   and membership-push code. An explicit `false` remains a valid stored preference.
2. `users_application_id_unique UNIQUE (application_id)`, nondeferrable, using
   ordinary NULLS DISTINCT semantics. `application_id` stays nullable for direct
   signup. Multiple NULLs are allowed; duplicate non-null application IDs are not.

Those intended definitions were checked against the audit's requested protections
and existing consumers, as well as production's nullable UUID application link.
They are emitted explicitly at the end of the baseline rather than inferred from
production's incomplete migration ledger.

`communities.member_count` remains **bigint**, with the live nonnegative check.
All current grants are preserved, including the moderation audit table's live
service-role DML grants; the append-only trigger is independently behavior-tested.
This task does not silently introduce privilege changes beyond the two requested
protections.

No production rows, sequence counter values, historical seed data, reference
catalogs, storage bucket rows, or application configuration rows are included.
A new environment therefore needs deliberate configuration before signup/content
creation: creation-limit settings, verification policy, city/sector/experience/job
catalogs and any desired directory content. This is **not** a seeded app demo.
Do not recover those inputs by replaying historical cleanup or seed migrations.

Supabase supplies its managed schemas (`auth`, `storage`, `realtime`, `extensions`,
`vault`, GraphQL helpers), roles, service migrations and extension implementation
objects. The application baseline installs the six captured extensions as needed
and relies on that real Supabase platform. It is not a bare-PostgreSQL substitute
or an attempt to replace platform-managed authentication/storage internals.

## Files

- `supabase/migrations/20261031163000_production_schema_baseline.sql`: the single
  active baseline; it rejects an already populated application schema.
- `supabase/config.toml`: clean local project, seeds disabled, no production link.
- `supabase/cli-version`: **2.122.0**, used by `scripts/db/cli.sh`.
- `supabase/supabase.lock`: pinned service versions and artifact digests.
- `supabase/schema/production-catalog.json`: metadata only; secret GUC values
  redacted, no table rows or old migration ledger.
- `supabase/schema/verification/`: real fresh-instance catalog, full difference
  report and test evidence.
- `scripts/db/capture.py` / `catalog.sql`: read-only metadata capture. Remote
  captures use only the Management API's `/database/query/read-only` endpoint;
  direct PostgreSQL captures are restricted to loopback addresses.
- `scripts/db/export_baseline.py`: deterministic rendering from that metadata.
  It does not read archived migrations or contact production.
- `scripts/db/test_fresh.py`: isolated Supabase installation and comparison.
- `supabase/archive/legacy-sql.tar.gz`: optional compressed reference backup,
  outside discovery. Database installation/tests never read or execute it; the
  documentation auditor lists member names solely to resolve historical references.

The old root/nested migration files, partial `schema.sql`, `seed.sql`, reset and
repair SQL were removed from active paths. A supported CLI wrapper rejects
pre-baseline versions and checks unique valid 14-digit timestamps. Legacy seed/reset npm commands were retired. Do not run old generators directly
against historical filenames; those outputs cannot pass the new workflow's validation. Do not extract the archive into an active directory.

## Local development and fresh verification

Requirements: Node 22+, Python 3.10+, `psql`, and Docker/Podman. Apple-silicon macOS
and supported Linux hosts can instead use the pinned CLI's experimental native
runtime. The native path was actually exercised here; the Docker CI job is added
but has not been run on GitHub by this implementation.

```sh
npm run test:db
# Without Docker on supported hosts:
npm run test:db -- --runtime native

# Start the working project's local instance:
npm run db:start
npm run db:stop

# Create a future forward migration:
npm run db:new -- add_example_feature
```

If an old checkout still has a gitignored `supabase/.temp` production link, move
that local linkage out before starting the new development workflow. The fresh
test always uses a clean temporary workdir and never copies that linkage.

Every future filename must be `YYYYMMDDHHMMSS_<description>.sql` with a unique,
valid timestamp at or after the baseline. The CLI wrapper and automated test
reject old-style/duplicate versions and any nested active migrations. Keep the
baseline immutable after adoption; put future changes in new files.

The automated check creates a brand-new, unlinked temporary Supabase workdir,
copies only the baseline/config/lock, starts the pinned stack, verifies its
loopback identity, then:

1. Checks that the new local ledger contains the baseline version.
2. Compares every captured catalog object with the saved production snapshot.
3. Confirms zero rows in every public table and zero storage buckets.
4. Validates all stored public routine definitions after their dependencies exist,
   with `check_function_bodies=on`, without invoking application RPCs.
5. Applies any future active forward migrations **after** the frozen baseline
   comparison and records their resulting catalog separately. Add feature tests
   with those migrations; do not overwrite the old production snapshot merely
   to make a comparison green.
6. Tests the exact Boolean/default/NOT NULL contract, duplicate application
   rejection, multiple NULL applications, false preferences, and audit immutability.
   All test fixtures are rolled back.
7. Destroys only that disposable local stack.

Reports default to ignored `test-results/schema/`. The committed verification
was generated with `--report-dir supabase/schema/verification`. No production
credentials or links are copied into the test workdir. CLI status secrets and
startup logs are private temporary files, not report artifacts.

`supabase/tests/run-local.sh` now delegates to this real Supabase harness; it no
longer applies the partial snapshot, archived SQL, reset operations or pgTAP
stand-ins. Explicit existing pgTAP suites may be passed as arguments; they must
provide their own current fixtures and cannot assume historical seeded rows.

## Comparison result and limits

See [the complete comparison](../supabase/schema/verification/schema-comparison.md)
and its JSON containing exact source/result values for **every** difference.

The verified application result is **zero unexpected differences**, plus the two
requested protections (one column, one constraint and its backing index). There
is one explicitly reported PostgreSQL deparser difference: PG 17.11 adds redundant
`AS text` labels to non-leading UNION arms of `report_groups`; output columns are
also independently compared. This rendering change does not change UNION output
names or the query's meaning.

There are **334 managed-platform/database-configuration differences**. Production
is PostgreSQL 17.6; the pinned local stack is 17.11. Differences include platform
service tables/functions/indexes/roles, realtime partitions/publications,
extension ownership, and locale. Production uses `en_US.UTF-8`; the native test
uses `C.UTF-8`, so text ordering can differ even when application DDL matches.
Managed internals are neither silently normalized away nor overwritten to force
a match. The report does **not** claim global database equality or validation of
all application workflows. Existing production's locale is preserved on adoption;
verify locale-sensitive behavior on a matching staging environment before that
separate step.

ACL comparisons preserve privilege-to-grant-option associations. Equivalent
explicit/implicit owner defaults and grantor spelling are normalized; no client
permission difference is silently accepted. Logical column order is compared;
physical `attnum` holes left by dropped production columns are not recreated.
Secret GUC values are deliberately excluded from comparison, and fresh credentials
are independent. No secrets or current sequence values are required to reproduce
schema structure.

## Existing production adoption — NOT EXECUTED, separate explicit approval required

Never run the baseline DDL, `db reset`, or an ordinary initial `db push` against
existing production. Its ledger still has its prior contents. No adoption or
legacy repair is performed automatically by these scripts.

After explicit approval for production adoption:

1. Freeze schema deployments. Confirm the exact target and approved Git revision.
   Take and verify a restorable production backup, plus a secured export of the
   existing migration ledger. Keep the export outside the active workflow.
2. Refresh production metadata using the **read-only** capture endpoint and review
   every application difference against the approved baseline. Recheck uniqueness
   immediately before adding the protection; a previous zero-duplicate result
   is not a concurrency guarantee:

   ```sql
   select count(*) as duplicate_groups
   from (
     select application_id from public.users
     where application_id is not null
     group by application_id having count(*) > 1
   ) d;
   ```

3. Separately approve and apply only the missing protection DDL. Do not apply the
   whole baseline. For the column, use a short lock timeout and verify any existing
   column's exact definition before treating it as satisfied:

   ```sql
   begin;
   set local lock_timeout = '2s';
   set local statement_timeout = '30s';
   alter table public.notification_preferences
     add column if not exists community_push_enabled boolean not null default true;
   commit;
   ```

   For application uniqueness, use an approved direct/session connection, not a
   transaction-pooled SQL batch. The index build must run outside a transaction:

   ```sql
   create unique index concurrently users_application_id_unique
     on public.users (application_id);
   ```

   Inspect an existing index first. Do not use `IF NOT EXISTS` to hide invalid or
   incompatible indexes, and do not delete duplicate users automatically. A failed
   concurrent build can leave an invalid index; stop and review recovery.

   After confirming a valid, ready, full-table unique B-tree on exactly that
   nullable column, attach it under a short lock timeout:

   ```sql
   begin;
   set local lock_timeout = '2s';
   alter table public.users
     add constraint users_application_id_unique
     unique using index users_application_id_unique;
   commit;
   ```

4. Re-capture and verify the resulting application schema, grants, RLS and routine
   definitions. With a read-scoped token supplied through the environment (never
   committed or printed), use saved metadata only for the comparison:

   ```sh
   python3 scripts/db/capture.py --project-ref <approved-production-ref> \
     --output /secure/current-production-catalog.json
   python3 scripts/db/compare.py /secure/current-production-catalog.json \
     supabase/schema/verification/fresh-catalog.json --exact \
     --output /secure/adoption-comparison
   ```

   `--exact` rejects the two missing protections as gaps instead of accepting
   them as intended baseline additions. Its exit code must be zero, both
   protections must pass their contract checks, and all platform/configuration
   differences still need review. This comparison does not alter a database.
 There must be no unexplained application difference from the
   approved baseline. Preserve all existing rows, wider counts, live legacy
   objects and deliberate configuration differences. A ledger change cannot fix
   a missing schema object. Validate on a matching staging clone first.
5. Only after a **separate explicit approval to replace production's ledger**, use
   the following one-time transaction. This starts a new history; it neither
   reconciles old versions nor executes the baseline. Fill in the reviewed
   baseline's SHA-256 (`shasum -a 256 supabase/migrations/20261031163000_production_schema_baseline.sql`).
   The placeholder is deliberately rejected. The statements field records adoption,
   not a false assertion that creation SQL ran against existing production.

   ```sql
   begin;
   set local lock_timeout = '2s';
   set local statement_timeout = '30s';
   set local uxcommunity.baseline_sha256 = 'REPLACE_WITH_REVIEWED_64_HEX_SHA256';
   do $$ begin
     if current_setting('uxcommunity.baseline_sha256') !~ '^[0-9a-f]{64}$' then
       raise exception 'Review and supply the actual approved baseline digest first';
     end if;
   end $$;
   lock table supabase_migrations.schema_migrations in access exclusive mode;
   delete from supabase_migrations.schema_migrations;
   insert into supabase_migrations.schema_migrations (version, name, statements)
   values (
     '20261031163000',
     'production_schema_baseline',
     array['-- Adopted after explicit approval and schema verification; no baseline DDL executed. SHA256=' ||
           current_setting('uxcommunity.baseline_sha256')]
   );
   commit;
   ```

6. Confirm exactly the one approved baseline entry exists and the pinned CLI's
   migration list has no pending historical SQL. Only then enable future deployment
   of new uniquely timestamped migrations through the normal reviewed workflow.

No `migration repair` command or compatibility migration bundle is needed. Do not
perform the ledger replacement while applications/schema deployments are racing.
If verification fails, stop; do not remove columns, users, data, constraints or
legacy objects to make the comparison pass. Keep production adoption outside
normal CI and obtain fresh explicit approval for any additional correction.
