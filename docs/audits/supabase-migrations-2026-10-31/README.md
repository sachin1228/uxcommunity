# Supabase migration reconciliation — 31 October 2026

**Production does not exactly match `main`. Its migration ledger is substantially incomplete, while most surviving application schema definitions are current. No production changes were made.** Two intended protections are missing: `notification_preferences.community_push_enabled`, and uniqueness of non-null `users.application_id`. There are also a wider member-count type, remaining platform-owner default grants, extra legacy objects, absent historical storage buckets, and mutable seed-data differences. This report is an audit and proposed plan, not approval to repair any of them.

## Reference, access, and scope

- Repository: `sachin1228/uxcommunity`; exact fetched `origin/main` SHA: **`6b4835c8cb414984dfc8994c3d4dbb2f08b70178`**.
- Commit timestamp: **31 October 2026, 20:12:09 IST**. The subject is `Fix/remove sending clock (#735)`. #735 was already merged at audit start; only its resulting `main` tree was used. No PR branch, open-PR patch, local uncommitted source, or feature branch supplied expected SQL.
- Linked production: **`ux-community`**, project **`eauupthwlnarkauwifmw`**, region `ap-southeast-2`, PostgreSQL **17.6**. The checked-in-worktree migration tree was created from the pinned commit; the existing checkout was preserved. Local project configuration was used solely to identify/access the linked project, not to define the expected schema.
- Main catalog capture: **31 October 2026, 21:01:17 IST** (`2026-10-31T15:31:17.817673Z`). Additional aggregate checks ran through **21:10 IST**. Each saved response retains its own timestamp. These are observations over several requests, not a single cross-request transaction or a claim about future state.
- All production SQL used **`POST /v1/projects/{ref}/database/query/read-only`**. The server reported **`current_user = supabase_read_only_user`**, **`transaction_read_only = on`**, and the role has `BYPASSRLS` with `pg_read_all_data`; empty results therefore were not merely application RLS filtering. Migration listing also used a read-only management GET. No application RPC was called in production.
- No `db push`, `db reset`, migration repair, application writes, production DDL, or data modification was executed. Historical migrations, application code, reset scripts, and repair scripts are unchanged. Only audit documents/evidence are proposed in this PR. Credentials, member rows, history SQL bodies, and database connection strings are excluded from the committed bundle.

## Inventory and ledger

The complete inventory contains **216 files**, **204 distinct version prefixes**, **30,707 source lines**, and **1,812 parsed top-level statements**. There are **six colliding version groups**, containing 18 files (12 excess files over unique versions):

| Version | Files sharing it |
|---|---|
| `20260718` | `add_image_url_to_master_data`, `add_is_blocked_to_users`, `replace_sectors_add_companies_cities`, `seed_other_option`, `unique_application_id_on_users` |
| `20260719` | `add_avatar_to_profiles`, `add_design_interests` |
| `20260720` | `communities`, `communities_company_experience`, `community_last_read`, `lottie_settings`, `realtime_community_messages` |
| `20260721` | `cleanup_orphaned_communities`, `communities_is_active` |
| `20260924120000` | `home_feed_member_scope`, `sidebar_content_reactions_replies` |
| `20261010120000` | `event_city`, `job_application_triage` |

Version prefixes are identifiers, not a reliable calendar: the tree mixes `001`, eight-digit dates, and fourteen-digit identifiers, including values whose hour component exceeds 23. Do not infer a successful deployment sequence from those identifiers. Replay here uses C/filename order, matching the documented manual-file workflow. Duplicate prefixes cannot identify individual files in a version-primary-key ledger.

Production's **entire recorded history** is:

| Recorded version | Recorded name | Main counterpart | SQL comparison |
|---|---|---|---|
| `001` | `password_resets` | `001_password_resets.sql` | Same SQL after lexical normalization |
| `20261005140518` | `report_review_and_undo` | `20261005140000_report_review_and_undo.sql` | Same SQL; version differs |
| `20261008145053` | `drop_general_community` | `20261008130000_drop_general_community.sql` | Same SQL; version differs |
| `20261012205406` | `community_message_compound_cursor` | `20261013100000_community_message_compound_cursor.sql` | Same SQL; version differs |
| `20261023120000` | `fcm_tokens` | `20261023120000_fcm_tokens.sql` | Same SQL after lexical normalization |

The three timestamped middle rows are the **production-only versions**. Their actual stored SQL was compared with the named main files; this mapping is not based on filenames alone. Comments/whitespace and final statement terminators were ignored; string literals and SQL tokens were retained, with dollar-quoted bodies tokenized recursively. Full definitions were inspected privately; only hashes and results are published.

There are **202 repository-only versions / 214 files absent by exact version**. All names are enumerated in [migration-history.json](migration-history.json), not hidden behind a count. Three of those files have equivalent SQL recorded under different versions. History absence is not schema absence.

## Actual schema comparison

A complete clean expected database cannot be produced by the original migration tree as-is. The evidence below therefore distinguishes **strict replay failures**, **final diagnostic schema**, and **live production state**.

| Public catalog category | Final diagnostic model | Production | Comparison |
|---|---:|---:|---|
| Tables/views | 85 | 91 | All 85 shared definitions/properties match; 6 extra relations |
| Columns | 736 | 792 | 734 exact; 1 type difference; 1 missing; 57 extra |
| Constraints | 406 | 418 | 404 exact; 2 names absent; 14 extra. One absent name has equivalent enforcement |
| Indexes | 287 | 303 | 285 exact; 2 names absent; 18 extra. One absent index is covered by a wider index |
| Non-extension routines | 107 | 110 | All 107 expected signatures, results, normalized bodies, configuration, security flags, owners and ACLs match; 3 extra routines |
| Non-internal triggers | 39 | 39 | All definitions and enabled states match |
| RLS policies | 20 | 20 | All roles, commands, predicates and permissiveness match |
| Enum/domain types | 1 | 2 | Expected enum matches; extra `punishment_type` |

Shared relation, column, and routine ACLs match the diagnostic model. All public tables/views lack effective `anon`/`authenticated` SELECT or write grants; all captured column ACLs are NULL, so there are no additional column-level grants. All 85 shared relations have matching RLS and replica identity properties. All indexes are ready and valid. The `communities_user_requires_owner` constraint is NOT VALID in both models; the current ownerless-user-community count is zero. Trigger helper routines that retain default EXECUTE are listed in the evidence; this fact alone is not a callable application-RPC vulnerability. No live function was executed to test behavior.

The capture includes **31 roles**, **22 role memberships**, **24 default-privilege entries**, **9 non-system schemas**, and **6 installed extensions**. It records database/schema grants and role security attributes; role/GUC values that could contain secrets are represented by setting names only. Additional platform inventory includes 52 non-public relations, 48 non-extension non-public routines, 8 non-internal non-public triggers, 6 event triggers, and no additional non-public RLS policies. No public non-view rewrite rule or foreign server was found. These Supabase-managed objects are not generated by application migrations and were not recreated as a supposed application baseline.

Installed extensions are `plpgsql`, `pgcrypto`, `pg_trgm`, `uuid-ossp`, `pg_stat_statements`, and `supabase_vault`. The application requires `pgcrypto` and `pg_trgm`; both exist. Additional extensions and managed schemas are platform provisioning, not evidence of a missing application migration. `supabase_realtime` has no current public table members, consistent with the later publication cleanup. The other publication and its seven `realtime.messages_*` partitions are platform-managed.

## Exact discrepancies

| ID | Current observation | Meaning / proposed disposition |
|---|---|---|
| **D01** | `notification_preferences.community_push_enabled` is absent. Main `20261012150000` requires `boolean NOT NULL DEFAULT true`. | Entire intended column addition is absent. Propose a new forward migration after approval. History repair alone cannot fix this. |
| **D02** | `users_application_id_unique` constraint and unique index are absent, with no equivalent production index. Main `20260718_unique_application_id_on_users.sql` requires uniqueness on `application_id`. | Missing database protection. Current duplicate non-null application-ID groups: **0**; that observation does not prevent future races. Propose a forward unique-index/constraint change after staging and approval. |
| **D03** | `communities.member_count` is **bigint**, versus **integer** declared in `20260927120000`; production also has `CHECK (member_count >= 0)`. | Real schema drift, with wider capacity and stronger enforcement. Preserve it pending review; do not narrow the type to make a diff disappear. Current counter mismatches/negative counts: **0/0**. |
| **D04** | `postgres` public defaults exclude clients, but `supabase_admin` still grants `anon`/`authenticated` table, sequence and function rights on future public objects. | Partial intended hardening under `20261031090000`. Its DO block intentionally permits an insufficient-privilege notice. Existing objects have matching grants; future platform-owner defaults need a privileged, approved decision. Owner self-grant differences in the local bootstrap are representation differences, not missing application rights. |
| **D05** | Six extra public relations, three extra non-extension routines, one extra enum, five extra columns on shared tables, and their associated constraints/indexes are outside the migrations-only model. | Full names and provenance below; do not delete them automatically. |
| **D06** | The `resource_comments_body_check` name is absent. Production has validated `resource_comments_body_length_check` with the **same** `1..5000` predicate. The model has both checks. | Name/redundancy difference, **no missing length enforcement**. No repair is needed merely to duplicate the check. |
| **D07** | `idx_community_members_user` is absent; production has `idx_community_members_user_community (user_id, community_id)`. An extra `idx_community_messages_community_created (community_id, created_at DESC)` also exists. | Composite member index covers the expected user-prefix lookup. The message index overlaps the migration-defined `(community_id, created_at, id)` index; assess usage before removal. |
| **D08** | `storage.buckets` contains **zero** rows; `master-data-images` and `profile-avatars`, inserted by two July migrations, are absent. | Current historical storage-data effects are missing. The application later moved to R2; absence may be deliberate external cleanup. Do not recreate unused buckets or assert that their INSERTs never ran. |
| **D09** | Compared with final local seed values: **31/71** city names missing; **1/20** sector names missing; **14/14** experience-level `(slug,name)` pairs differ; **0/6** job-title names missing; **0/573** curated company pairs and **0/573** domain names missing. | Mutable reference-data divergence. Production has five experience-level rows with different labels/slugs; treat these as live product choices until reviewed. Missing literal values and current experience levels are in [data-verification.json](data-verification.json). Never rerun old cleanup/seed SQL wholesale. |

The six extra public relations are:

| Relation | Current-main provenance |
|---|---|
| `company_directory_seed_retired` (table) | Defined by `supabase/reset/company_directory_seed_reset.sql`, outside migrations |
| `company_directory_seed_retained` (view) | Same opt-in reset script |
| `moderation_audit_log_legacy_20261030` (table) | Archive name explained by `supabase/repairs/20261030_archive_legacy_moderation_audit_log.sql`; original legacy schema is not migration-defined |
| `moderation_logs` (table) | No creation in current-main migrations or baseline |
| `moderation_settings` (table) | No creation in current-main migrations or baseline |
| `user_punishments` (table) | No creation in current-main migrations or baseline |

Extra routines: `company_directory_seed_retirement_plan()` and `retire_company_directory_seed(boolean, boolean)` correspond to the opt-in reset script; `set_experience_levels_updated_at()` has no current-main migration definition. Extra enum: `public.punishment_type` with `warning`, `mute`, `temp_ban`, `perm_ban`. Shared-table extra columns: `communities.is_public`; `community_messages.image_status`, `moderation_log_id`, `image_moderation_error`, `image_moderated_at`. Associated production-only indexes/constraints and all 57 extra column definitions, including columns of extra tables/views, are enumerated in [schema-comparison.json](schema-comparison.json). The archive/reset scripts were read for provenance and **never executed**.

## Migration-by-migration assessment

Every file has a classification, hash, statement-type inventory, dependencies, replay result, and named-object evidence in [migration-reconciliation.md](migration-reconciliation.md) / [reconciliation.json](reconciliation.json).

The assessment counts are **2 fully reflected with same-version history**, **7 partially reflected**, **2 missing**, **148 with surviving schema present but exact-version history absent**, and **57 whose historical effects are not independently verifiable**. Category 2 includes mutable data differences and deliberately tolerated platform-default hardening. A category 4 is current-object evidence, **not a claim that a specific file was manually executed**. Replaced functions, removed tables, deleted data, old backfills and no-op statements generally cannot prove historical execution.

Thus there is no defensible list of "all files manually applied" from current catalogs alone. The report provides the narrower evidence-backed list of unrecorded versions whose surviving schema effects exist, plus three exact SQL-to-alternate-history mappings. It also explicitly identifies the two current missing intended additions. Current catalog equality cannot establish past data transformations or prove runtime behavior.

Current aggregate checks found **zero** duplicate non-null user application-ID groups, duplicate unread notification-key groups, member-count discrepancies, negative counters, dangling event links, events without rooms, missing host RSVPs, ownerless user communities, company/general/interest communities, event rooms with showcase enabled or non-chat tabs, and orphaned interaction-report reporters. There are **573** `curated-mnc` companies and **35** featured companies. These checks return counts/configuration only; member/report/message payloads were not exported.

## Ordering, dependencies, and reproducibility blockers

- **R01 — Missing versioned initial base:** `001_password_resets.sql` references `users`, but no preceding migration creates the initial authentication/master tables. Without the separate partial `supabase/schema.sql`, a platform-bootstrapped local database stops immediately with `relation "users" does not exist`.
- **R02 — Missing legacy company baseline:** the first July image/seed/cleanup migrations require the old `companies` table, and early functions require `designer_profiles.company_id`; the current separate baseline does not define them. The later verified-domain company model is a different schema created in September, after the legacy model was removed. Do not move that later CREATE TABLE earlier as a substitute.
- **R03 — Invalid SQL:** `20260720_communities_company_experience.sql` contains `do $ begin ... end $;`, not a valid dollar-quoted DO body. This blocks the lookup table/constraint additions as a transactional migration.
- **R04 — Non-idempotent repeated publication add:** `20260720_communities.sql` already adds `community_messages` to `supabase_realtime`; `20260720_realtime_community_messages.sql` repeats it without a guard and fails with `42710`.
- **R05 — Identifier collisions and mixed formats:** six duplicate groups prevent treating 216 files as 216 uniquely ledgered versions. Filename order and dependency order need an explicit preserved mapping before adopting automated deployment.

The strict replay used the original files, each with `psql -X -v ON_ERROR_STOP=1 -1`, after a minimal local platform bootstrap and `schema.sql`. **156 files succeeded and 60 failed.** Execution continued to collect all errors; later failures can be consequences of earlier rolled-back prerequisites. This is not a valid reference database, and none of these local failures was labelled a production failure merely because it occurred locally.

A second **diagnostic-only** database executed parsed statements individually, continuing after errors, to derive independently comparable final definitions. The malformed July DO delimiter was corrected **only in memory** so the remaining declared objects could be inspected. This left **17 failed statements in 8 files**, involving the absent legacy company/profile dimension and repeated publication add. All failed statements and the in-memory adjustment are listed in [local-replay.json](local-replay.json). No historical file was changed. The expected diagnostic model is useful for current-object comparison but is **not** a successful supported fresh-install path.

The local bootstrap used an isolated PostgreSQL 17.11 (Homebrew) server on a private Unix socket, roles/default grants, `pgcrypto` in `extensions`, a logical publication, a minimal `storage.buckets`, and an `auth.uid()` stub returning NULL. `seed.sql`, reset/repair operations, managed Supabase services, real authentication semantics, and pgTAP/application fixtures were not applied. SQL-definition comparison is therefore stronger evidence than unsupported claims of full runtime or platform equivalence.

[dependencies.csv](dependencies.csv) lists 1,618 extracted relation references and first declarations, including SQL-function bodies. The PL/pgSQL portion is a conservative text scan and can contain CTE/alias matches; it does not resolve dynamic SQL or every runtime dependency. The actual strict and diagnostic server errors establish the specific ordering blockers above. No supposedly exhaustive semantic dependency graph is claimed.

## Proposed synchronization plan — not implemented

1. **Preserve evidence and agree the desired live state.** Keep this pinned report, an independently secured/restorable production snapshot, and original migration hashes. Decide whether the wider member count, legacy moderation tables, R2 bucket retirement and edited reference data are intentional. Restoring obsolete defaults is not the objective.
2. **Use a disposable Supabase staging clone for full semantics.** Reconstruct the original base/legacy company model from trustworthy historical evidence and identify every initial prerequisite. Resolve malformed quoting and repeated publication registration in a separately approved fresh-install strategy. Verify SQL/runtime tests against real Supabase auth/storage/default roles; this local diagnostic does not replace that stage.
3. **Resolve version identity before mass ledger reconciliation.** Preserve original files and hashes as the historical record. Choose an explicit mapping from each file to a unique canonical version. If the CLI requires moving historical files out of its active migrations directory, keep a byte-for-byte archived copy plus manifest and order mapping, and document that existing databases need an approved mapping while new databases need the verified replay. Do not rename/delete originals in this PR. A single newly numbered “fix” file cannot make the invalid earlier history replay cleanly.
4. **Prefer reviewed forward changes for live discrepancies.** Stage D01 and D02 as new, uniquely numbered migrations; preserve wider types and extra data until product/retention decisions are explicit. D06/D07 need no redundant enforcement just to match names. For D04, arrange platform-owner privilege review rather than treating a tolerated DO notice as proof of hardening.
5. **Reconcile the ledger only after object/data review.** Keep the three production-only records and their verified mappings until the canonical plan accounts for them. Do not mark a colliding prefix applied as if it represented every file in the group. Only mark reviewed unique versions after checking their complete current intent, superseded effects and known missing pieces. History repair changes tracking; it does not run SQL or prove historical execution.
6. **Only then exercise future deployment/fresh setup in staging.** Verify the supported initial bootstrap, migration ordering, no unexpected pending destructive seed/backfill operations, final schema equality, and actual RPC behavior. A baseline/squash, if chosen, must retain grants, RLS, functions, triggers, extensions and required reference data, while excluding production member data and opt-in reset/archive operations. Existing databases would be mapped to that baseline without replaying its creation SQL; fresh databases would execute it. That is a separate compatibility/deployment decision, not a safe automatic cleanup here.

No mass repair command, destructive seed replay, baseline replacement, live cleanup, or production deployment is authorized by this report. The original request stops at this report and PR.

## Commands / SQL for a later approved phase

These examples were **not executed**. Use an access-controlled connection mechanism rather than putting credentials on a command line. The audit SELECT files can be run with an independently provisioned read-only login; `psql -X` avoids local startup scripts:

```sh
# AUDIT ONLY: an already configured read-only libpq service.
PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000' \
  psql -X 'service=uxcommunity-production-readonly' -v ON_ERROR_STOP=1 \
  -f docs/audits/supabase-migrations-2026-10-31/capture.sql
```

For an approved forward migration addressing D01:

```sql
alter table public.notification_preferences
  add column if not exists community_push_enabled boolean not null default true;
```

For D02, recheck duplicates immediately before an approved operation. A concurrent index build cannot run inside a transaction; inspect/recover any invalid index after a failed build, then attach the successful index as a constraint in a separate reviewed step:

```sql
-- Preflight SELECT only; no member identifiers returned.
select count(*) as duplicate_groups
from (
  select application_id from public.users
  where application_id is not null
  group by application_id having count(*) > 1
) d;

-- MUTATING examples: later approval and staging validation required.
create unique index concurrently users_application_id_unique
  on public.users (application_id);
alter table public.users
  add constraint users_application_id_unique
  unique using index users_application_id_unique;
```

For the platform-owner portion of D04, a privileged operator would review these exact schema-scoped revokes, plus any applicable global defaults, role memberships and service-role grants. They do not themselves remove PostgreSQL's global built-in PUBLIC EXECUTE default for future functions; every sensitive routine must retain explicit revokes, as the migrations already do.

```sql
-- MUTATING examples for a later privileged review.
alter default privileges for role supabase_admin in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all on functions from public, anon, authenticated;
```

After version mapping and complete verification, an individual **unique** version could be marked recorded with a reviewed command such as the following. This example is not a recommendation to run it now, and must not be expanded to every repository version:

```sh
# MUTATING ledger-only example; not executed.
supabase migration repair --linked --status applied 20261031110000
```

## Evidence guide

- [inventory.csv](inventory.csv): all filenames, versions, SHA-256 hashes, lengths and classifications.
- [migration-reconciliation.md](migration-reconciliation.md) and [reconciliation.json](reconciliation.json): one assessment per migration with surviving/superseded object evidence.
- [migration-history.json](migration-history.json): all five live records, equivalent-SQL mapping, all repository-only versions/files.
- [production-catalog.json](production-catalog.json) and [diagnostic-catalog.json](diagnostic-catalog.json): inspectable catalog snapshots; routine bodies represented by raw/normalized hashes.
- [schema-comparison.json](schema-comparison.json): every compared object, raw definition/property differences, ACLs, and semantic/platform interpretation. Owner/default-ACL bootstrap differences are retained instead of silently discarded.
- [data-verification.json](data-verification.json): aggregate checks, exact missing literal seed values, and current experience-level configuration.
- [statement-inventory.json](statement-inventory.json), [dependencies.csv](dependencies.csv), [local-replay.json](local-replay.json), [summary.json](summary.json): coverage, conservative dependency extraction and all original/diagnostic replay failures.
- [validation.json](validation.json) and [manifest.json](manifest.json): completed consistency/secret checks and artifact hashes.
- `capture.sql`, `probes.sql`, `extended.sql`, `seeds.sql`, `final-probes.sql`: read-only queries used. These query catalogs, static seeds and aggregate invariants; they do not run migration SQL or application routines.

Supabase documents the distinction between migration files and `supabase_migrations.schema_migrations`, and the effects of repair, in [Deploy database migrations](https://supabase.com/docs/guides/deployment/database-migrations) and the [migration repair CLI reference](https://supabase.com/docs/reference/cli/supabase-migration-repair). PostgreSQL's [ALTER DEFAULT PRIVILEGES documentation](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html) explains the distinction between global and schema-scoped defaults. This report's live-state claims come from the saved catalog/probe evidence, not documentation or prior assumptions.
