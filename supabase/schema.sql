-- ============================================================
-- drafthub — full authentication schema
-- Run this in your Supabase project SQL editor.
-- ============================================================

-- ─── Extensions ─────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── Master-data tables ─────────────────────────────────────

create table if not exists companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cities (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists design_sectors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Tags ───────────────────────────────────────────────────

create table if not exists tags (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

-- ─── Applications ───────────────────────────────────────────

create type application_status as enum ('pending', 'approved', 'rejected');

create table if not exists applications (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  email          text not null,
  linkedin_url   text not null,
  portfolio_url  text not null,
  status         application_status not null default 'pending',
  review_notes   text,
  -- links re-applications to the same person
  applicant_email text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_applications_email          on applications (email);
create index if not exists idx_applications_applicant_email on applications (applicant_email);
create index if not exists idx_applications_status         on applications (status);
create index if not exists idx_applications_created_at     on applications (created_at desc);

-- ─── Application ↔ Tags (many-to-many) ──────────────────────

create table if not exists application_tags (
  application_id uuid not null references applications (id) on delete cascade,
  tag_id         uuid not null references tags (id) on delete cascade,
  primary key (application_id, tag_id)
);

-- ─── Invitations ────────────────────────────────────────────

create table if not exists invitations (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  token          text not null unique default encode(gen_random_bytes(32), 'hex'),
  expires_at     timestamptz not null default (now() + interval '7 days'),
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_invitations_token on invitations (token);

-- ─── Users ──────────────────────────────────────────────────

create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete restrict,
  name           text not null,
  email          text not null unique,
  password_hash  text not null,
  is_blocked     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_users_is_blocked on users (is_blocked);

create index if not exists idx_users_email on users (email);

-- ─── Designer Profiles ──────────────────────────────────────

create type experience_level as enum (
  'student',
  'fresher',
  'junior',
  'mid_level',
  'senior',
  'lead',
  'principal',
  'staff',
  'design_manager',
  'head_of_design',
  'director',
  'vp',
  'consultant',
  'freelancer'
);

create table if not exists designer_profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references users (id) on delete cascade,
  company_id       uuid references companies (id) on delete restrict,
  city_id          uuid references cities (id) on delete restrict,
  sector_id        uuid references design_sectors (id) on delete restrict,
  experience_level experience_level not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_profiles_company on designer_profiles (company_id);
create index if not exists idx_profiles_city    on designer_profiles (city_id);
create index if not exists idx_profiles_sector  on designer_profiles (sector_id);

-- ─── Prevent deletion of master data in use ─────────────────
-- Foreign-key ON DELETE RESTRICT on designer_profiles already
-- blocks deletion if a profile references the row.
-- The is_active flag is the preferred way to "retire" a value.

-- ─── updated_at triggers ────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger trg_companies_updated_at
  before update on companies
  for each row execute function set_updated_at();

create or replace trigger trg_cities_updated_at
  before update on cities
  for each row execute function set_updated_at();

create or replace trigger trg_design_sectors_updated_at
  before update on design_sectors
  for each row execute function set_updated_at();

create or replace trigger trg_applications_updated_at
  before update on applications
  for each row execute function set_updated_at();

create or replace trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

create or replace trigger trg_profiles_updated_at
  before update on designer_profiles
  for each row execute function set_updated_at();

-- ─── Row-Level Security ─────────────────────────────────────
-- All writes go through the service-role key on the server.
-- Enable RLS but allow service-role bypass (default behaviour).

alter table companies         enable row level security;
alter table cities            enable row level security;
alter table design_sectors    enable row level security;
alter table tags              enable row level security;
alter table applications      enable row level security;
alter table application_tags  enable row level security;
alter table invitations       enable row level security;
alter table users             enable row level security;
alter table designer_profiles enable row level security;

-- ─── Password Resets ────────────────────────────────────────

create table if not exists password_resets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  token      text not null unique default encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_resets_token on password_resets (token);

alter table password_resets enable row level security;
