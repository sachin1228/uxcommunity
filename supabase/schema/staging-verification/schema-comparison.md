# Production versus fresh baseline

Production capture: 2026-10-31T16:49:41.095844+00:00 (read-only).
Fresh PostgreSQL: 17.6.

Unexpected application differences: **0**.
Both intended protections represented: **True**.
Recorded PostgreSQL deparser-only differences: **1**.
Supabase platform / database configuration differences: **351**.

The baseline owns the live public application schema. Supabase supplies managed schemas, roles, services, and extension implementation objects. Every observed platform difference is listed below and in the JSON; the databases are not claimed globally identical.

| Category | Production | Fresh | Equal objects |
|---|---:|---:|---:|
| schemas | 8 | 10 | 7 |
| relations | 142 | 150 | 128 |
| columns | 1295 | 1341 | 1224 |
| constraints | 568 | 578 | 553 |
| indexes | 456 | 466 | 438 |
| routines | 159 | 160 | 148 |
| triggers | 47 | 48 | 47 |
| policies | 20 | 20 | 20 |
| types | 14 | 14 | 14 |
| sequences | 2 | 4 | 0 |
| roles | 31 | 30 | 26 |
| role_memberships | 22 | 23 | 19 |
| default_privileges | 24 | 27 | 24 |
| extensions | 6 | 7 | 3 |
| publications | 2 | 1 | 1 |
| publication_tables | 7 | 0 | 0 |
| event_triggers | 6 | 8 | 5 |
| rules | 0 | 0 | 0 |
| foreign_servers | 0 | 0 | 0 |

| Scope | Category / object | Difference | Fields |
|---|---|---|---|
| supabase_platform_or_database_configuration | schemas: `_realtime` | fresh_only |  |
| supabase_platform_or_database_configuration | schemas: `storage` | different | acl |
| supabase_platform_or_database_configuration | schemas: `supabase_functions` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `_realtime.extensions` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `_realtime.feature_flags` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `_realtime.schema_migrations` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `_realtime.tenants` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `extensions.pg_stat_statements` | different | acl, owner |
| supabase_platform_or_database_configuration | relations: `extensions.pg_stat_statements_info` | different | acl, owner |
| supabase_platform_or_database_configuration | relations: `graphql.seq_schema_version` | fresh_only |  |
| PostgreSQL deparser formatting | relations: `public.report_groups` | different | view_definition |
| supabase_platform_or_database_configuration | relations: `realtime.messages_2026_09_15` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | relations: `realtime.messages_2026_09_16` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | relations: `realtime.messages_2026_09_17` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | relations: `realtime.messages_2026_09_18` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | relations: `realtime.messages_2026_09_19` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | relations: `realtime.messages_2026_09_20` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | relations: `realtime.messages_2026_09_21` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | relations: `realtime.messages_2026_10_30` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `realtime.messages_2026_10_31` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `realtime.messages_2026_11_01` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `realtime.messages_2026_11_02` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `realtime.messages_2026_11_03` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `realtime.schema_migrations` | different | acl |
| supabase_platform_or_database_configuration | relations: `storage.buckets` | different | acl |
| supabase_platform_or_database_configuration | relations: `storage.iceberg_namespaces` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `storage.iceberg_tables` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `storage.migrations` | different | acl |
| supabase_platform_or_database_configuration | relations: `storage.objects` | different | acl |
| supabase_platform_or_database_configuration | relations: `supabase_functions.hooks` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `supabase_functions.hooks_id_seq` | fresh_only |  |
| supabase_platform_or_database_configuration | relations: `supabase_functions.migrations` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.extensions.id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.extensions.inserted_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.extensions.settings` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.extensions.tenant_external_id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.extensions.type` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.extensions.updated_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.feature_flags.bucket_key` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.feature_flags.enabled` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.feature_flags.id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.feature_flags.inserted_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.feature_flags.name` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.feature_flags.rollout_percentage` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.feature_flags.updated_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.schema_migrations.inserted_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.schema_migrations.version` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.broadcast_adapter` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.client_presence_window_ms` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.external_id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.feature_flags` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.gcm_migrated_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.inserted_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.jwt_jwks` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.jwt_secret` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.max_bytes_per_second` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.max_channels_per_client` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.max_client_presence_events_per_window` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.max_concurrent_users` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.max_events_per_second` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.max_joins_per_second` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.max_payload_size_in_kb` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.max_presence_events_per_second` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.migrations_ran` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.name` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.notify_private_alpha` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.postgres_cdc_default` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.presence_enabled` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.private_only` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.suspend` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `_realtime.tenants.updated_at` | fresh_only |  |
| intended protection | columns: `public.notification_preferences.community_push_enabled` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_15.binary_payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_15.event` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_15.extension` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_15.id` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_15.inserted_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_15.payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_15.private` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_15.skip_broadcast` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_15.topic` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_15.updated_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_16.binary_payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_16.event` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_16.extension` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_16.id` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_16.inserted_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_16.payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_16.private` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_16.skip_broadcast` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_16.topic` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_16.updated_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_17.binary_payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_17.event` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_17.extension` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_17.id` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_17.inserted_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_17.payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_17.private` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_17.skip_broadcast` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_17.topic` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_17.updated_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_18.binary_payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_18.event` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_18.extension` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_18.id` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_18.inserted_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_18.payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_18.private` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_18.skip_broadcast` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_18.topic` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_18.updated_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_19.binary_payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_19.event` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_19.extension` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_19.id` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_19.inserted_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_19.payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_19.private` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_19.skip_broadcast` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_19.topic` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_19.updated_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_20.binary_payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_20.event` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_20.extension` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_20.id` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_20.inserted_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_20.payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_20.private` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_20.skip_broadcast` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_20.topic` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_20.updated_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_21.binary_payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_21.event` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_21.extension` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_21.id` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_21.inserted_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_21.payload` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_21.private` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_21.skip_broadcast` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_21.topic` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_09_21.updated_at` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_30.binary_payload` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_30.event` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_30.extension` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_30.id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_30.inserted_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_30.payload` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_30.private` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_30.skip_broadcast` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_30.topic` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_30.updated_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_31.binary_payload` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_31.event` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_31.extension` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_31.id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_31.inserted_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_31.payload` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_31.private` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_31.skip_broadcast` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_31.topic` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_10_31.updated_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_01.binary_payload` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_01.event` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_01.extension` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_01.id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_01.inserted_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_01.payload` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_01.private` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_01.skip_broadcast` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_01.topic` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_01.updated_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_02.binary_payload` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_02.event` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_02.extension` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_02.id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_02.inserted_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_02.payload` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_02.private` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_02.skip_broadcast` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_02.topic` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_02.updated_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_03.binary_payload` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_03.event` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_03.extension` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_03.id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_03.inserted_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_03.payload` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_03.private` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_03.skip_broadcast` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_03.topic` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.messages_2026_11_03.updated_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `realtime.schema_migrations.inserted_at` | different | default |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_namespaces.bucket_name` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_namespaces.catalog_id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_namespaces.created_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_namespaces.id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_namespaces.metadata` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_namespaces.name` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_namespaces.updated_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_tables.bucket_name` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_tables.catalog_id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_tables.created_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_tables.id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_tables.location` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_tables.name` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_tables.namespace_id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_tables.remote_table_id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_tables.shard_id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_tables.shard_key` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `storage.iceberg_tables.updated_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `supabase_functions.hooks.created_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `supabase_functions.hooks.hook_name` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `supabase_functions.hooks.hook_table_id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `supabase_functions.hooks.id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `supabase_functions.hooks.request_id` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `supabase_functions.migrations.inserted_at` | fresh_only |  |
| supabase_platform_or_database_configuration | columns: `supabase_functions.migrations.version` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `_realtime.extensions.extensions_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `_realtime.extensions.extensions_tenant_external_id_fkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `_realtime.feature_flags.feature_flags_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `_realtime.feature_flags.rollout_percentage_must_be_between_0_and_100` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `_realtime.schema_migrations.schema_migrations_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `_realtime.tenants.jwt_secret_or_jwt_jwks_required` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `_realtime.tenants.tenants_pkey` | fresh_only |  |
| intended protection | constraints: `public.users.users_application_id_unique` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_15.messages_2026_09_15_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_15.messages_payload_exclusive` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_16.messages_2026_09_16_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_16.messages_payload_exclusive` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_17.messages_2026_09_17_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_17.messages_payload_exclusive` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_18.messages_2026_09_18_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_18.messages_payload_exclusive` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_19.messages_2026_09_19_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_19.messages_payload_exclusive` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_20.messages_2026_09_20_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_20.messages_payload_exclusive` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_21.messages_2026_09_21_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_09_21.messages_payload_exclusive` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_10_30.messages_2026_10_30_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_10_30.messages_payload_exclusive` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_10_31.messages_2026_10_31_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_10_31.messages_payload_exclusive` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_11_01.messages_2026_11_01_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_11_01.messages_payload_exclusive` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_11_02.messages_2026_11_02_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_11_02.messages_payload_exclusive` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_11_03.messages_2026_11_03_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `realtime.messages_2026_11_03.messages_payload_exclusive` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `storage.buckets.buckets_versioning_dark_check` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | constraints: `storage.iceberg_namespaces.iceberg_namespaces_catalog_id_fkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `storage.iceberg_namespaces.iceberg_namespaces_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `storage.iceberg_tables.iceberg_tables_catalog_id_fkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `storage.iceberg_tables.iceberg_tables_namespace_id_fkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `storage.iceberg_tables.iceberg_tables_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `supabase_functions.hooks.hooks_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | constraints: `supabase_functions.migrations.migrations_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `_realtime.extensions.extensions_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `_realtime.extensions.extensions_tenant_external_id_index` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `_realtime.extensions.extensions_tenant_external_id_type_index` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `_realtime.feature_flags.feature_flags_name_index` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `_realtime.feature_flags.feature_flags_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `_realtime.schema_migrations.schema_migrations_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `_realtime.tenants.tenants_external_id_index` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `_realtime.tenants.tenants_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `auth.users.idx_users_created_at_desc` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `auth.users.idx_users_email` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `auth.users.idx_users_last_sign_in_at_desc` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `auth.users.idx_users_name` | missing_from_fresh |  |
| intended protection | indexes: `public.users.users_application_id_unique` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_15.messages_2026_09_15_inserted_at_topic_idx` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_15.messages_2026_09_15_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_16.messages_2026_09_16_inserted_at_topic_idx` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_16.messages_2026_09_16_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_17.messages_2026_09_17_inserted_at_topic_idx` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_17.messages_2026_09_17_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_18.messages_2026_09_18_inserted_at_topic_idx` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_18.messages_2026_09_18_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_19.messages_2026_09_19_inserted_at_topic_idx` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_19.messages_2026_09_19_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_20.messages_2026_09_20_inserted_at_topic_idx` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_20.messages_2026_09_20_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_21.messages_2026_09_21_inserted_at_topic_idx` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_09_21.messages_2026_09_21_pkey` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_10_30.messages_2026_10_30_inserted_at_topic_idx` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_10_30.messages_2026_10_30_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_10_31.messages_2026_10_31_inserted_at_topic_idx` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_10_31.messages_2026_10_31_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_11_01.messages_2026_11_01_inserted_at_topic_idx` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_11_01.messages_2026_11_01_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_11_02.messages_2026_11_02_inserted_at_topic_idx` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_11_02.messages_2026_11_02_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_11_03.messages_2026_11_03_inserted_at_topic_idx` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `realtime.messages_2026_11_03.messages_2026_11_03_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `storage.iceberg_namespaces.iceberg_namespaces_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `storage.iceberg_namespaces.idx_iceberg_namespaces_bucket_id` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `storage.iceberg_tables.iceberg_tables_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `storage.iceberg_tables.idx_iceberg_tables_location` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `storage.iceberg_tables.idx_iceberg_tables_namespace_id` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `supabase_functions.hooks.hooks_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `supabase_functions.hooks.supabase_functions_hooks_h_table_id_h_name_idx` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `supabase_functions.hooks.supabase_functions_hooks_request_id_idx` | fresh_only |  |
| supabase_platform_or_database_configuration | indexes: `supabase_functions.migrations.migrations_pkey` | fresh_only |  |
| supabase_platform_or_database_configuration | routines: `extensions.grant_pg_cron_access.` | different | config, definition |
| supabase_platform_or_database_configuration | routines: `extensions.grant_pg_graphql_access.` | different | config, definition |
| supabase_platform_or_database_configuration | routines: `extensions.grant_pg_net_access.` | different | config, definition |
| supabase_platform_or_database_configuration | routines: `extensions.pgrst_ddl_watch.` | different | config, definition |
| supabase_platform_or_database_configuration | routines: `extensions.pgrst_drop_watch.` | different | config, definition |
| supabase_platform_or_database_configuration | routines: `extensions.set_graphql_placeholder.` | different | config, definition |
| supabase_platform_or_database_configuration | routines: `graphql_public.graphql."operationName" text, query text, variables jsonb, extensions jsonb` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | routines: `pgbouncer.get_auth.p_usename text` | different | acl, config, definition |
| supabase_platform_or_database_configuration | routines: `storage.enforce_versioning_status_transition.` | fresh_only |  |
| supabase_platform_or_database_configuration | routines: `storage.extension.name text` | different | acl |
| supabase_platform_or_database_configuration | routines: `storage.filename.name text` | different | acl |
| supabase_platform_or_database_configuration | routines: `storage.foldername.name text` | different | acl |
| supabase_platform_or_database_configuration | routines: `supabase_functions.http_request.` | fresh_only |  |
| supabase_platform_or_database_configuration | triggers: `storage.buckets.enforce_versioning_status_transition` | fresh_only |  |
| supabase_platform_or_database_configuration | sequences: `auth.refresh_tokens_id_seq` | different | max |
| supabase_platform_or_database_configuration | sequences: `graphql.seq_schema_version` | fresh_only |  |
| supabase_platform_or_database_configuration | sequences: `realtime.subscription_id_seq` | different | max |
| supabase_platform_or_database_configuration | sequences: `supabase_functions.hooks_id_seq` | fresh_only |  |
| supabase_platform_or_database_configuration | roles: `cli_login_postgres` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | roles: `supabase_admin` | different | config |
| supabase_platform_or_database_configuration | roles: `supabase_etl_admin` | different | bypass_rls |
| supabase_platform_or_database_configuration | roles: `supabase_functions_admin` | fresh_only |  |
| supabase_platform_or_database_configuration | roles: `supabase_privileged_role` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | roles: `supabase_realtime_admin` | different | config |
| supabase_platform_or_database_configuration | role_memberships: `anon.supabase_realtime_admin.supabase_admin` | fresh_only |  |
| supabase_platform_or_database_configuration | role_memberships: `authenticated.supabase_realtime_admin.supabase_admin` | fresh_only |  |
| supabase_platform_or_database_configuration | role_memberships: `postgres.cli_login_postgres.supabase_admin` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | role_memberships: `service_role.supabase_realtime_admin.supabase_admin` | fresh_only |  |
| supabase_platform_or_database_configuration | role_memberships: `supabase_functions_admin.postgres.supabase_admin` | fresh_only |  |
| supabase_platform_or_database_configuration | role_memberships: `supabase_privileged_role.postgres.supabase_admin` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | role_memberships: `supabase_privileged_role.supabase_etl_admin.supabase_admin` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | default_privileges: `supabase_admin.supabase_functions.S` | fresh_only |  |
| supabase_platform_or_database_configuration | default_privileges: `supabase_admin.supabase_functions.f` | fresh_only |  |
| supabase_platform_or_database_configuration | default_privileges: `supabase_admin.supabase_functions.r` | fresh_only |  |
| supabase_platform_or_database_configuration | extensions: `pg_graphql` | fresh_only |  |
| supabase_platform_or_database_configuration | extensions: `pg_stat_statements` | different | owner |
| supabase_platform_or_database_configuration | extensions: `pgcrypto` | different | owner |
| supabase_platform_or_database_configuration | extensions: `uuid-ossp` | different | owner |
| supabase_platform_or_database_configuration | publications: `supabase_realtime_messages_publication` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | publication_tables: `supabase_realtime_messages_publication.realtime.messages_2026_09_15` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | publication_tables: `supabase_realtime_messages_publication.realtime.messages_2026_09_16` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | publication_tables: `supabase_realtime_messages_publication.realtime.messages_2026_09_17` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | publication_tables: `supabase_realtime_messages_publication.realtime.messages_2026_09_18` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | publication_tables: `supabase_realtime_messages_publication.realtime.messages_2026_09_19` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | publication_tables: `supabase_realtime_messages_publication.realtime.messages_2026_09_20` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | publication_tables: `supabase_realtime_messages_publication.realtime.messages_2026_09_21` | missing_from_fresh |  |
| supabase_platform_or_database_configuration | event_triggers: `graphql_watch_ddl` | fresh_only |  |
| supabase_platform_or_database_configuration | event_triggers: `graphql_watch_drop` | fresh_only |  |
| supabase_platform_or_database_configuration | event_triggers: `issue_pg_graphql_access` | different | tags |
| supabase_platform_or_database_configuration | database_config: `database` | different |  |

Exact source/result definitions, properties, and grants for each difference are retained in [schema-differences.json](schema-differences.json). No production table rows or sequence counter values are captured.
