-- ============================================================
-- Lottie animation settings for community loading transitions
-- Three scopes: universal, per-type, per-community
-- Fallback chain: community → type → universal → spinner
-- ============================================================

create table if not exists lottie_settings (
  id          uuid primary key default gen_random_uuid(),
  -- 'universal' | 'type' | 'community'
  scope       text not null check (scope in ('universal', 'type', 'community')),
  -- 'universal' for universal scope
  -- community type ('city','sector','interest','company','experience_level') for type scope
  -- community uuid (as text) for community scope
  scope_key   text not null,
  lottie_url  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(scope, scope_key)
);

create or replace trigger trg_lottie_settings_updated_at
  before update on lottie_settings
  for each row execute function set_updated_at();

-- RLS: public read (loaded by client), writes via service-role only
alter table lottie_settings enable row level security;
create policy "public_read" on lottie_settings for select using (true);
