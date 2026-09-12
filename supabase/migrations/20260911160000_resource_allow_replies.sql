-- ============================================================
-- Resource comments toggle
--
-- Resources gain the same "Allow replies" switch that threads and showcase
-- posts already have. Idempotent: safe to run more than once.
--
-- The resource list and home-feed read models build their item JSON with
-- to_jsonb(row), so the new column flows through those RPCs without any
-- function changes.
-- ============================================================

alter table public.community_resources
  add column if not exists allow_replies boolean not null default true;
