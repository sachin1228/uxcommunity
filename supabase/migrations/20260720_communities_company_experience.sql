-- ============================================================
-- Migration: Add company + experience_level community types
-- ============================================================

-- ─── 1. Extend communities.type check ───────────────────────
alter table communities
  drop constraint if exists communities_type_check;

alter table communities
  add constraint communities_type_check
    check (type in ('city', 'sector', 'interest', 'company', 'experience_level'));

-- ─── 2. experience_levels lookup table ──────────────────────
-- experience_level is a PG enum — it has no UUID table.
-- This table gives each enum value a stable UUID so communities
-- can reference it via (type='experience_level', reference_id=experience_levels.id).
create table if not exists experience_levels (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,   -- matches the PG enum value exactly
  name       text not null,
  image_url  text,
  created_at timestamptz not null default now()
);

insert into experience_levels (slug, name) values
  ('student',        'Students'),
  ('fresher',        'Freshers'),
  ('junior',         'Junior Designers'),
  ('mid_level',      'Mid-Level Designers'),
  ('senior',         'Senior Designers'),
  ('lead',           'Lead Designers'),
  ('principal',      'Principal Designers'),
  ('staff',          'Staff Designers'),
  ('design_manager', 'Design Managers'),
  ('head_of_design', 'Heads of Design'),
  ('director',       'Design Directors'),
  ('vp',             'VP of Design'),
  ('consultant',     'Design Consultants'),
  ('freelancer',     'Freelancers')
on conflict (slug) do nothing;

alter table experience_levels enable row level security;
do $ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'experience_levels' and policyname = 'public_read'
  ) then
    execute 'create policy "public_read" on experience_levels for select using (true)';
  end if;
end $;

-- ─── 3. Add image_url to design_interests ───────────────────
alter table design_interests
  add column if not exists image_url text;
