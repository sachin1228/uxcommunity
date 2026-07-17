-- Add is_blocked flag to users table
alter table users add column if not exists is_blocked boolean not null default false;

create index if not exists idx_users_is_blocked on users (is_blocked);
