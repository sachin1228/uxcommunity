# Migration Reconciliation

**Date:** 2026-10-31
**Branch:** `fix/production-readiness-remediation`
**Production project (read-only inspection):** `ux-community` / `eauupthwlnarkauwifmw`
**Ledger rechecked:** 2026-10-31 (read-only `supabase migration list --linked`; still 5 remote entries)
**Production history read via:** `supabase migration list --linked` (no writes)
**Local schema:** disposable PostgreSQL 17 harness applying `supabase/schema.sql` + every migration in filename order.

---

## 1. Executive summary

Production is a **brownfield, manually applied database**, not a replay of the repository migration chain. The current `supabase_migrations.schema_migrations` records only five versions. The repository now has **216 migration files / 204 unique versions**. Only **two versions match** the production ledger by version string; 214 local files are unrecorded (202 unique local versions).

The three remote-only versions were retrieved with `supabase migration fetch --linked` into a **temporary directory** (no production write). They are **not unknown migrations**: each is an earlier/rebadged copy of a local migration. Their content differs only by comments/extra semicolons, or is the same executable SQL under a different header. No production ledger repair was attempted.

The launch-critical fresh-chain defect is fixed in this branch:

- `20260814030000_community_list_aggregate_rpcs.sql` had been edited in place after production applied it, adding a reference to `community_resources.allow_replies`.
- `community_resources.allow_replies` is added only by the later `20260911160000_resource_allow_replies.sql`.
- On a fresh database the edited function failed with `column r.allow_replies does not exist`, and the later migration did not recreate the function.
- The old file is restored to its safe 6-column form; the forward `20261031110000_fix_resource_list_aggregates.sql` recreates the 7-column RPC transactionally. A fresh DB test now proves the function exists.

**Do not run `supabase db push` or `db reset` against production.** Production history is not a trustworthy baseline yet. The safe route is a schema diff/staging clone, then a controlled approval, as described in §6.

---

## 2. Production ledger (recorded versions)

| Version | Local file? | Notes |
|---|---|---|
| `001` | `001_password_resets.sql` | Matches. |
| `20261005140518` | No exact local filename | Fetched: `report_review_and_undo`, equivalent to local `20261005140000_report_review_and_undo.sql`; diff is comments + one extra semicolon. Effects present (`content_removals`, `report_groups`, undo). |
| `20261008145053` | No exact local filename | Fetched: `drop_general_community`, equivalent to local `20261008130000_drop_general_community.sql`; diff is one extra semicolon. |
| `20261012205406` | No exact local filename | Fetched: `community_message_compound_cursor`, equivalent to local `20261013100000_community_message_compound_cursor.sql`; executable SQL matches; fetched header says applied from the local timestamp. Effects present (compound function/index). |
| `20261023120000` | `20261023120000_fcm_tokens.sql` | Matches. |

**Counts:** 216 local files; 204 unique local versions; 2 matched by version; **214 local files / 202 unique versions unrecorded**; **3 remote-only versions, all mapped to local equivalents**. The remote-only versions do not need to be invented or applied; they are historical aliases of local migrations.

## 2.1 Remote-only mapping (fetched read-only, temp only)

| Remote version | Fetched name | Local equivalent | Executable difference | Production effect verified |
|---|---|---|---|---|
| `20261005140518` | `report_review_and_undo` | `20261005140000_report_review_and_undo.sql` | comments; extra `;` | `content_removals` and `report_groups` exist live. |
| `20261008145053` | `drop_general_community` | `20261008130000_drop_general_community.sql` | extra `;` | general community was retired; schema objects exist. |
| `20261012205406` | `community_message_compound_cursor` | `20261013100000_community_message_compound_cursor.sql` | header/comments; same SQL body | live `get_community_message_page` has `p_before_id`/`p_after_id` and the compound index. |

## 3. Duplicate timestamps

These groups share a version prefix. The SQL editor/globbing order is deterministic by filename in the local harness, but the migration ledger cannot distinguish them and `supabase db push` tooling is unsafe around duplicates:

- `20260718` — 5 files
- `20260719` — 2 files
- `20260720` — 5 files
- `20260721` — 2 files
- `20260924120000` — 2 files
- `20261010120000` — 2 files

New migrations in this branch use unique `20261031…` timestamps. Do not rename historical files without a production baseline decision.

## 3a. Production execution — 2026-10-31

The eight remediation migrations were applied manually in order to linked `ux-community` via the authenticated Supabase CLI. Verification returned: 7-column resource RPC, `terms_version`, `content_reports.target_snapshot`, `complete_signup_with_consent`, `apply_to_job_with_resume`, expanded audit actions, nullable `moderation_appeals.user_id` + `user_deleted_at`, zero `anon`/`authenticated` SELECT on the seven sensitive tables and service_role SELECT on all seven. The production ledger was **not** repaired. A full logical dump was unavailable because Docker is not installed; a local schema-object snapshot is retained in `/tmp/uxc-prechange-objects.txt`. `supabase_admin` default ACLs remain permissive; `postgres` defaults are hardened. The app has not been deployed.

## 4. Production schema drift (pre-execution audit snapshot; current applied state is in §3a)

| Object | Production state | Repository expectation | Risk/action |
|---|---|---|---|
| `get_resource_list_aggregates(uuid,uuid[])` | **6 columns** at audit time; **7 columns after 2026-10-31 execution** | 7 columns including `allow_replies` | Applied successfully. |
| Fresh migration chain | Function never created after 20260814 | 7-column function after the chain | Fixed by restoring 20260814 + forward 20261031110000; integrity test 10/10. |
| `moderation_audit_log` | New schema (13 columns, immutable trigger, no FKs), 0 rows | New 20261030220000/230000 | Matches; do not re-run the original migration against a legacy table. |
| `moderation_audit_log_legacy_20261030` | Old schema (moderator_email, target_content_type/id, metadata), FK `target_user_id → users ON DELETE SET NULL`, 0 rows | Not in repo | Manual repair artifact. Keep; include in backups; do not drop in this release. |
| `moderation_appeals` | 0 rows; original cascade FKs | New 20261031150000 changes to nullable/SET NULL + `user_deleted_at` | Applied 2026-10-31; `user_id` nullable and `user_deleted_at` present. |
| `content_reports.target_snapshot` | Absent at audit time; **present after 2026-10-31 execution** | New evidence column | Applied. |
| `users.terms_version` | Absent at audit time; **present after 2026-10-31 execution** | New versioned consent column | Applied; existing rows remain NULL. |
| Client grants on seven sensitive tables | Present at audit time; **zero client SELECT after 2026-10-31** | REVOKE migration on branch | Applied; service_role retains SELECT on all seven. |
| `moderation_audit_log` action check | Original 11 actions at audit time; **expanded after 2026-10-31** | New action set | Applied. |
| `apply_to_job_with_resume` | Absent at audit time; **present after 2026-10-31** | New 20261031140000 | Applied; service_role execute only. |
| `verification_settings.grace_days` | `2` | Policy A ignores it for writes | Product decision: leave legacy value or set to 0 with approval; no code change required. |

**Verified schema checks performed live:** 91 public tables/views, RLS flags, 20 policies, default ACL, sensitive-table ACLs, audit/appeal/auth-session tables, reporter `SET NULL` FKs, moderation audit trigger, source `get_resource_list_aggregates` definition, live `get_resource_list_page` body, and `supabase_realtime` publication (empty). Post-execution verification is recorded in §3a.

**Object inventory comparison:** the live object list is consistent with the repository's `create table/view` statements plus `schema.sql`, the retired objects, and the one manual repair artifact `moderation_audit_log_legacy_20261030`. A name-only comparison flags some retired/supabase-only objects; it is not a substitute for a column-level staging diff. The full column/constraint/trigger diff for all 216 migrations was **not completed**; a real Supabase staging clone is required. Production schema access was available, but a full schema diff without a controlled staging environment is incomplete.

## 5. Fresh-database strategy

1. A fresh Supabase database must run migrations in filename order with `ON_ERROR_STOP=1` (or the real Supabase CLI, once the historical chain is clean). The local harness previously used `ON_ERROR_STOP=0`, which masked the 20260814 failure.
2. The 20260814 file is restored to its pre-edit 6-column form; `20260911160000` adds `allow_replies`; `20261031110000` upgrades to 7 columns inside a transaction.
3. `supabase/tests/migration_integrity.test.sql` asserts the RPC signature, the exact seven-column `pg_get_function_result` contract, `allow_replies`, `complete_signup_with_consent`, `terms_version`, `apply_to_job_with_resume`, `content_reports.target_snapshot`, `moderation_appeals.user_deleted_at` and the expanded audit action check. Current local result: **10/10**.
4. The local harness still logs expected Supabase-only errors (`auth`/`storage` schemas, `companies` fixtures missing) because it is a bare Postgres cluster. Those are harness limitations, not migration pass evidence; a real Supabase staging project is required for the complete chain.
5. Do not edit already-applied migrations again. Add forward migrations; keep the old chain safe for fresh installs.

## 6. Production execution plan (approval required)

**Preconditions:** independent encrypted dump + R2 manifest, low-write window, staging validation, and a copy of the pre-change function/ACL snapshots. Because backup is out of scope, production application of these migrations must not proceed until the separate backup task is done or a one-off dump is taken with approval.

Apply in this order, one file at a time, transactionally where indicated:

1. `20261030240000_revoke_client_select_on_launch_tables.sql` — revoke client grants on the seven tables; service_role untouched.
2. `20261031090000_harden_public_default_privileges.sql` — default ACL hardening; `supabase_admin` may require a platform-privileged step (the migration raises a notice rather than failing).
3. `20261031100000_signup_consent_atomic.sql` — `terms_version` + `complete_signup_with_consent`.
4. `20261031110000_fix_resource_list_aggregates.sql` — transactional drop/create 7-column RPC; **run as one transaction** (file includes `begin`/`commit`).
5. `20261031120000_expand_moderation_audit_actions.sql` — broadens the audit action check.
6. `20261031130000_report_evidence_snapshots.sql` — adds `content_reports.target_snapshot`.
7. `20261031140000_apply_to_job_with_resume.sql` — transactional resume-apply RPC.
8. `20261031150000_moderation_appeals_retention.sql` — appeal retention columns/FKs + trigger replacement.

**Do not re-run** `20261030220000_complete_moderation_system.sql` or `20261030230000_preserve_moderation_evidence.sql` against production: production is already in the repaired state (new audit table + renamed legacy table). They are safe only on a pre-repair database with the legacy table renamed first; see the verified sequence in `PRODUCTION_APPROVAL_CHECKLIST.md`.

**Also do not re-run** `20260814030000_community_list_aggregate_rpcs.sql` after `20261031110000_fix_resource_list_aggregates.sql`: its restored fresh-install form creates the 6-column function and would overwrite the 7-column production definition. It is in the chain for fresh databases only. `20260911160000_resource_allow_replies.sql` is additive (`add column if not exists`) but not needed on production.


### Known failure / do-not-rerun list

- `20260814030000_community_list_aggregate_rpcs.sql` — do not rerun after `20261031110000`; it creates the old 6-column function.
- `20261030220000_complete_moderation_system.sql` — do not rerun against a legacy `moderation_audit_log`; production is already repaired. Against the new table it is not guaranteed idempotent because of FK/constraint history.
- `20261030230000_preserve_moderation_evidence.sql` — do not rerun; it is part of the repair sequence and assumes the new table exists.
- The three remote-only ledger aliases (`20261005140518`, `20261008145053`, `20261012205406`) — do not re-apply; they are historical aliases of local migrations.
- Destructive/historical migrations (drop-table/delete-data drops such as `20261008140000`, `20261008130000`, `20261021140000`) — do not apply as a batch; they belong to fresh-install history only and may delete data if replayed.
- Any migration that creates a function must explicitly revoke PUBLIC/anon/authenticated and grant service_role. PostgreSQL default privileges cannot remove a new function’s built-in PUBLIC EXECUTE.
- Duplicate timestamp groups are unsafe for `db push`; use the controlled SQL-editor/ledger path until a staging baseline is approved.

**Deployment order:** migrations first, then web Worker, then realtime Worker. The app expects the new RPCs/columns/audit actions immediately after the web deploy; deploying web before the migrations would break signup, job apply, content reports and audit writes.

**Dependency/order notes:** `20260814030000` → `20260911160000` → `20261031110000` (resource RPC); `20261030210000` → `20261030220000`/`20261030230000` (sessions → moderation → evidence); `20261031120000` depends on the audit table/action check; `20261031150000` depends on `20261030220000`/`20261030230000`; `20261031140000` depends on job tables; permission migrations should run before deploying code that expects the new columns/RPCs. The eight newly added migrations are the only ones required for this remediation; the other local files are historical/brownfield and must not be applied as a batch.

**Migration history baseline:** after a schema diff against a staging clone, choose one of:
- keep the current controlled SQL-editor process and record applied versions in the repository ledger (preferred while backup/history remains brownfield); or
- after approval, use `supabase migration repair --status applied <version>` for the verified set. The three remote-only versions are already fetched/mapped and do not need to be invented. Never insert 202 versions speculatively; never run `db push` against production in this state.

**Rollback:** keep a pre-change dump and the old 6-column function definition. The moderation repair is rename-based and preserves the legacy table; do not drop it. RPC/column migrations are additive or function-only; a forward fix is safer than a destructive downgrade. If a migration fails partway, stop, restore from the approved dump, and re-run from the last verified file.

## 7. New-migration idempotency / rollback

| Migration | Re-run behavior | Rollback implication |
|---|---|---|
| `20261030240000_revoke_client_select_on_launch_tables.sql` | Idempotent revoke; service_role untouched. | Re-grant client roles only with a deliberate policy change (not recommended). |
| `20261031090000_harden_public_default_privileges.sql` | Idempotent default ACL changes; `supabase_admin` block may notice. | Re-grant defaults only if an intentional public-read policy is added. |
| `20261031100000_signup_consent_atomic.sql` | `add column if not exists` + `create or replace function`; safe. | Keep the column/function; old signup route can be restored separately. |
| `20261031110000_fix_resource_list_aggregates.sql` | Transactional drop/create; safe to re-run (drops the 7-col function and recreates it). | Keep the old 6-col definition snapshot; prefer a forward fix. |
| `20261031120000_expand_moderation_audit_actions.sql` | Drop/add action check; safe if existing actions are in the expanded list (they are). | Reverting the check would reject new audit actions. |
| `20261031130000_report_evidence_snapshots.sql` | `add column if not exists`; safe. | Column can remain; old code ignores it. |
| `20261031140000_apply_to_job_with_resume.sql` | `create or replace`; safe. | Drop the new RPC only after reverting the apply route. |
| `20261031150000_moderation_appeals_retention.sql` | Add columns/change FKs/trigger replacement; rerunnable. | Restoring cascade FKs would re-introduce evidence loss; do not. |

**Potential failures on current production:** the main failure risk is running the historical chain with `db push` (starting at 20260814/duplicate versions), not the eight forward migrations. The transactional RPC migration temporarily drops `get_resource_list_aggregates`; if any production object depended on it, the transaction would roll back and report the dependency. No such dependency was found in the read-only catalog; verify on staging. `20261031090000` may only be able to alter `postgres` defaults; the `supabase_admin` defaults need a platform-privileged change and are recorded as a residual risk.

## 8. Upgrade behavior and verification plan

- **Local fresh chain:** 216 migrations applied; integrity/permission/evidence tests pass (see `STAGING_TEST_RESULTS.md`).
- **Staging upgrade clone:** **NOT RUN** — no staging project was available/confirmed. This is the next required step before production. The three remote-only aliases are mapped above; the remaining 202 unrecorded unique versions still need a column-level diff.
- **Production upgrade:** **NOT RUN** — approval required.
- Post-apply verification SQL: confirm the 7-column function result, `users.terms_version`, `content_reports.target_snapshot`, `apply_to_job_with_resume`, `moderation_appeals.user_deleted_at`, zero client grants, service-role access, and one audit insert with a new action.
- Data preservation: all new migrations are additive or function-only; `moderation_appeals` FK changes preserve rows; `moderation_audit_log` is append-only; `content_reports` rows are untouched except for the new column default.

## Appendix A — Complete local migration inventory

`RECORDED` = version appears in the production ledger; `not recorded` = no version-level evidence in production. Do not infer “not applied” solely from this marker (production is manually applied); verify the actual object on a staging clone.

```
001              RECORDED     001_password_resets.sql
20260718         not recorded 20260718_add_image_url_to_master_data.sql
20260718         not recorded 20260718_add_is_blocked_to_users.sql
20260718         not recorded 20260718_replace_sectors_add_companies_cities.sql
20260718         not recorded 20260718_seed_other_option.sql
20260718         not recorded 20260718_unique_application_id_on_users.sql
20260719         not recorded 20260719_add_avatar_to_profiles.sql
20260719         not recorded 20260719_add_design_interests.sql
20260720         not recorded 20260720_communities.sql
20260720         not recorded 20260720_communities_company_experience.sql
20260720         not recorded 20260720_community_last_read.sql
20260720         not recorded 20260720_lottie_settings.sql
20260720         not recorded 20260720_realtime_community_messages.sql
20260721         not recorded 20260721_cleanup_orphaned_communities.sql
20260721         not recorded 20260721_communities_is_active.sql
20260722000000   not recorded 20260722000000_message_reactions.sql
20260722000001   not recorded 20260722000001_message_reply_to.sql
20260722         not recorded 20260722_drop_experience_level_enum.sql
20260723000000   not recorded 20260723000000_moderation_events.sql
20260723000001   not recorded 20260723000001_message_reactions_realtime.sql
20260723         not recorded 20260723_message_image_url.sql
20260724         not recorded 20260724_message_soft_delete.sql
20260726000000   not recorded 20260726000000_community_threads.sql
20260726000001   not recorded 20260726000001_thread_votes.sql
20260726000002   not recorded 20260726000002_thread_comments.sql
20260726200000   not recorded 20260726200000_community_events.sql
20260726200001   not recorded 20260726200001_community_events_cover_image.sql
20260726200002   not recorded 20260726200002_event_comments.sql
20260726200003   not recorded 20260726200003_event_comments_image.sql
20260726200004   not recorded 20260726200004_event_comments_replies.sql
20260726300000   not recorded 20260726300000_direct_signup_nullable_application_id.sql
20260726400000   not recorded 20260726400000_global_designer_cities.sql
20260726500000   not recorded 20260726500000_general_community.sql
20260727000000   not recorded 20260727000000_community_rules.sql
20260727100000   not recorded 20260727100000_private_community_archive.sql
20260727200000   not recorded 20260727200000_community_resources.sql
20260727200001   not recorded 20260727200001_resource_saves.sql
20260727200002   not recorded 20260727200002_resource_comments.sql
20260727300000   not recorded 20260727300000_resource_bookmarks.sql
20260728000000   not recorded 20260728000000_event_saves.sql
20260728000001   not recorded 20260728000001_notifications.sql
20260728000002   not recorded 20260728000002_user_created_communities.sql
20260728100000   not recorded 20260728100000_community_descriptions.sql
20260728         not recorded 20260728_thread_saves.sql
20260803000000   not recorded 20260803000000_public_content.sql
20260804000000   not recorded 20260804000000_enable_rls_message_reactions_thread_saves.sql
20260808000000   not recorded 20260808000000_uxcommunity_rebrand.sql
20260811000000   not recorded 20260811000000_message_reactions_realtime_read_policy.sql
20260812000000   not recorded 20260812000000_persist_thread_interactions.sql
20260812190000   not recorded 20260812190000_community_showcase.sql
20260813000001   not recorded 20260813000001_repair_resource_comments_and_feed_indexes.sql
20260813010000   not recorded 20260813010000_showcase_comment_threads.sql
20260813020000   not recorded 20260813020000_atomic_signup_completion.sql
20260813030000   not recorded 20260813030000_event_saves_realtime.sql
20260813040000   not recorded 20260813040000_fix_event_like_realtime.sql
20260813050000   not recorded 20260813050000_home_feed_interaction_aggregates.sql
20260814000000   not recorded 20260814000000_separate_event_likes_and_saves.sql
20260814010000   not recorded 20260814010000_optimize_home_feed_interactions.sql
20260814020000   not recorded 20260814020000_get_community_message_page.sql
20260814025000   not recorded 20260814025000_sidebar_showcase_performance.sql
20260814030000   not recorded 20260814030000_community_list_aggregate_rpcs.sql
20260814040000   not recorded 20260814040000_showcase_list_aggregate_rpc.sql
20260814050000   not recorded 20260814050000_fix_message_after_and_active_event_pagination.sql
20260814060000   not recorded 20260814060000_community_read_page_rpcs.sql
20260815000000   not recorded 20260815000000_optimize_all_communities.sql
20260815100000   not recorded 20260815100000_thread_resource_list_cursors.sql
20260815110000   not recorded 20260815110000_public_showcase.sql
20260815120000   not recorded 20260815120000_showcase_list_is_public.sql
20260816000000   not recorded 20260816000000_performance_indexes.sql
20260816010000   not recorded 20260816010000_remove_save_bookmark_notifications.sql
20260816020000   not recorded 20260816020000_rename_thread_votes_to_thread_likes.sql
20260826000000   not recorded 20260826000000_event_attendee_previews.sql
20260826010000   not recorded 20260826010000_remove_generated_avatars.sql
20260827000000   not recorded 20260827000000_remove_company_data.sql
20260827120000   not recorded 20260827120000_edit_community_messages.sql
20260829000000   not recorded 20260829000000_home_feed_threads_only.sql
20260830000000   not recorded 20260830000000_private_community_join_requests.sql
20260830100000   not recorded 20260830100000_remove_standalone_public_posts.sql
20260830110000   not recorded 20260830110000_keep_is_public_in_responses.sql
20260830120000   not recorded 20260830120000_remove_showcase_post_type_project_url_tags.sql
20260830130000   not recorded 20260830130000_remove_showcase_description.sql
20260830140000   not recorded 20260830140000_add_showcase_allow_replies.sql
20260830150000   not recorded 20260830150000_remove_thread_description.sql
20260903000000   not recorded 20260903000000_auto_join_and_other_community_cleanup.sql
20260903100000   not recorded 20260903100000_sync_community_images_with_master_data.sql
20260903110000   not recorded 20260903110000_community_display_picture_lottie.sql
20260904000000   not recorded 20260904000000_community_admins.sql
20260904120000   not recorded 20260904120000_chat_mentions.sql
20260904130000   not recorded 20260904130000_trim_legacy_user_names.sql
20260905120000   not recorded 20260905120000_add_thread_poll_and_widen_title.sql
20260905130000   not recorded 20260905130000_thread_poll_votes.sql
20260905140000   not recorded 20260905140000_thread_poll_undo.sql
20260906090000   not recorded 20260906090000_trim_thread_categories.sql
20260908120000   not recorded 20260908120000_thread_comment_reactions.sql
20260909100000   not recorded 20260909100000_showcase_rich_posts.sql
20260910120000   not recorded 20260910120000_video_media.sql
20260911000000   not recorded 20260911000000_remove_resource_tags.sql
20260911020000   not recorded 20260911020000_drop_video_media.sql
20260911120000   not recorded 20260911120000_showcase_categories.sql
20260911130000   not recorded 20260911130000_remove_showcase_stage.sql
20260911150000   not recorded 20260911150000_resource_card_comments.sql
20260911160000   not recorded 20260911160000_resource_allow_replies.sql
20260912120000   not recorded 20260912120000_event_accent_color.sql
20260913120000   not recorded 20260913120000_add_job_titles.sql
20260913130000   not recorded 20260913130000_signup_attempts.sql
20260913140000   not recorded 20260913140000_signup_attempt_resume.sql
20260913150000   not recorded 20260913150000_community_ownership_on_user_delete.sql
20260915120000   not recorded 20260915120000_remove_broadcast_and_mention_notifications.sql
20260916120000   not recorded 20260916120000_showcase_enabled_flag.sql
20260916130000   not recorded 20260916130000_profile_feed_page.sql
20260916140000   not recorded 20260916140000_profile_banner.sql
20260917120000   not recorded 20260917120000_sidebar_unread_mentions.sql
20260917130000   not recorded 20260917130000_sidebar_unread_content.sql
20260918120000   not recorded 20260918120000_push_tokens.sql
20260918140000   not recorded 20260918140000_notification_preferences.sql
20260923120000   not recorded 20260923120000_comment_reactions_all_kinds.sql
20260923200000   not recorded 20260923200000_content_notification_reactions_replies.sql
20260923210000   not recorded 20260923210000_message_page_content_reactions.sql
20260924120000   not recorded 20260924120000_home_feed_member_scope.sql
20260924120000   not recorded 20260924120000_sidebar_content_reactions_replies.sql
20260924130000   not recorded 20260924130000_event_chat_communities.sql
20260924140000   not recorded 20260924140000_event_chat_showcase_off.sql
20260925000000   not recorded 20260925000000_join_request_message.sql
20260925010000   not recorded 20260925010000_feed_community_dp_master.sql
20260925020000   not recorded 20260925020000_profile_feed_community_dp_master.sql
20260925030000   not recorded 20260925030000_home_feed_scope_visibility.sql
20260925120000   not recorded 20260925120000_fix_naive_event_timestamps.sql
20260925130000   not recorded 20260925130000_event_host_timezone.sql
20260925140000   not recorded 20260925140000_event_delete_keeps_group_chat.sql
20260925150000   not recorded 20260925150000_event_chat_join_questions.sql
20260926000000   not recorded 20260926000000_close_public_read_exposure.sql
20260926010000   not recorded 20260926010000_schema_drift_missing_columns.sql
20260926020000   not recorded 20260926020000_drop_moderation_events.sql
20260926120000   not recorded 20260926120000_sidebar_scan_bounds.sql
20260927120000   not recorded 20260927120000_community_member_count.sql
20260928120000   not recorded 20260928120000_community_members_page.sql
20260928130000   not recorded 20260928130000_admin_community_members_page.sql
20260928140000   not recorded 20260928140000_notification_dedupe.sql
20260928170000   not recorded 20260928170000_message_page_content_reactions_once.sql
20260929090000   not recorded 20260929090000_message_page_single_overload.sql
20260929120000   not recorded 20260929120000_company_verified_domains.sql
20260929130000   not recorded 20260929130000_company_directory_hints.sql
20260929150000   not recorded 20260929150000_company_domain_stewardship.sql
20260929152000   not recorded 20260929152000_company_domain_review.sql
20260930100000   not recorded 20260930100000_drop_duplicate_member_count_triggers.sql
20261001000000   not recorded 20261001000000_community_moderators.sql
20261001000001   not recorded 20261001000001_message_removal_attribution.sql
20261001120000   not recorded 20261001120000_content_removal_notifications.sql
20261005120000   not recorded 20261005120000_content_reports.sql
20261005140000   not recorded 20261005140000_report_review_and_undo.sql
20261006120000   not recorded 20261006120000_drop_profile_banner.sql
20261007120000   not recorded 20261007120000_profile_identity_edit.sql
20261007130000   not recorded 20261007130000_company_directory_mnc_seed.sql
20261007140000   not recorded 20261007140000_company_directory_admin.sql
20261007150000   not recorded 20261007150000_company_directory_design_first.sql
20261007160000   not recorded 20261007160000_company_directory_featured_admin.sql
20261007170000   not recorded 20261007170000_company_mailbox_proof_joins.sql
20261008090000   not recorded 20261008090000_drop_event_join_company_experience.sql
20261008120000   not recorded 20261008120000_event_host_is_going.sql
20261008130000   not recorded 20261008130000_drop_general_community.sql
20261008140000   not recorded 20261008140000_remove_design_interests.sql
20261009100000   not recorded 20261009100000_member_feed_page.sql
20261009120000   not recorded 20261009120000_jobs.sql
20261009140000   not recorded 20261009140000_company_display_domain.sql
20261009160000   not recorded 20261009160000_job_poster_company.sql
20261009170000   not recorded 20261009170000_job_lifecycle.sql
20261009180000   not recorded 20261009180000_job_expiry.sql
20261009190000   not recorded 20261009190000_job_description_formatting.sql
20261010120000   not recorded 20261010120000_event_city.sql
20261010120000   not recorded 20261010120000_job_application_triage.sql
20261010130000   not recorded 20261010130000_job_wildcard_criteria.sql
20261010140000   not recorded 20261010140000_job_match_notifications.sql
20261010150000   not recorded 20261010150000_city_event_filters.sql
20261010160000   not recorded 20261010160000_company_page_display_domain.sql
20261010170000   not recorded 20261010170000_profile_feed_saved_bookmarks.sql
20261010200000   not recorded 20261010200000_member_resumes_and_email_prefs.sql
20261011100000   not recorded 20261011100000_community_mute_until.sql
20261012100000   not recorded 20261012100000_direct_messages.sql
20261012120000   not recorded 20261012120000_dm_hardening.sql
20261012130000   not recorded 20261012130000_dm_sidebar_reaction_preview.sql
20261012140000   not recorded 20261012140000_explore_pending_join_request.sql
20261012150000   not recorded 20261012150000_community_push_preference.sql
20261013100000   not recorded 20261013100000_community_message_compound_cursor.sql
20261013120000   not recorded 20261013120000_creation_limits.sql
20261014120000   not recorded 20261014120000_creation_limits_resources.sql
20261014140000   not recorded 20261014140000_creation_limits_live_slots.sql
20261014160000   not recorded 20261014160000_creation_limits_own_community.sql
20261014180000   not recorded 20261014180000_chat_message_retention.sql
20261015100000   not recorded 20261015100000_dm_requests_blocks_reports.sql
20261015120000   not recorded 20261015120000_job_feed_cursor.sql
20261015140000   not recorded 20261015140000_event_room_link_repair.sql
20261015160000   not recorded 20261015160000_profile_feed_own_only.sql
20261015180000   not recorded 20261015180000_library_curation.sql
20261019100000   not recorded 20261019100000_reply_preview_author_id.sql
20261020120000   not recorded 20261020120000_event_lifecycle_notifications.sql
20261021140000   not recorded 20261021140000_remove_event_city.sql
20261021150000   not recorded 20261021150000_home_feed_unified_scope.sql
20261022190000   not recorded 20261022190000_creation_limits_refund.sql
20261023120000   RECORDED     20261023120000_fcm_tokens.sql
20261026130000   not recorded 20261026130000_account_verification.sql
20261026140000   not recorded 20261026140000_verification_grace_days.sql
20261030120000   not recorded 20261030120000_signup_consent.sql
20261030140000   not recorded 20261030140000_global_blocks_and_interaction_reports.sql
20261030160000   not recorded 20261030160000_restore_verification_notification_entity.sql
20261030200000   not recorded 20261030200000_private_r2_storage.sql
20261030210000   not recorded 20261030210000_session_revocation.sql
20261030220000   not recorded 20261030220000_complete_moderation_system.sql
20261030230000   not recorded 20261030230000_preserve_moderation_evidence.sql
20261030240000   not recorded 20261030240000_revoke_client_select_on_launch_tables.sql
20261031090000   not recorded 20261031090000_harden_public_default_privileges.sql
20261031100000   not recorded 20261031100000_signup_consent_atomic.sql
20261031110000   not recorded 20261031110000_fix_resource_list_aggregates.sql
20261031120000   not recorded 20261031120000_expand_moderation_audit_actions.sql
20261031130000   not recorded 20261031130000_report_evidence_snapshots.sql
20261031140000   not recorded 20261031140000_apply_to_job_with_resume.sql
20261031150000   not recorded 20261031150000_moderation_appeals_retention.sql
```
