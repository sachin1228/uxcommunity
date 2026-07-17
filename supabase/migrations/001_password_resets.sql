-- Migration: add password_resets table
-- Run this in your Supabase SQL editor if you have already run schema.sql.

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
