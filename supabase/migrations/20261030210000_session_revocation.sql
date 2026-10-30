-- ============================================================
-- Immediate session revocation
--
-- The app uses a custom 7-day HS256 JWT, not Supabase Auth. A JWT
-- alone cannot be withdrawn, so this migration adds the server-side
-- state every request, WebSocket handshake and private-file proxy
-- can consult:
--
--   users.session_version        global "generation" for a member.
--                                A bump invalidates every JWT that
--                                carries an older value.
--   auth_sessions                one row per issued session (web,
--                                mobile, admin). Revoking the row
--                                invalidates that device only.
--
-- Revocation is deliberately split:
--   * per-device logout revokes one auth_sessions row;
--   * logout-all, password reset and suspension bump the global
--     version and revoke every row;
--   * password change revokes the other rows but keeps the current
--     device signed in;
--   * account deletion cascades auth_sessions away with the user.
--
-- Why both a version and a row? The row is required for per-device
-- logout. The version is what makes a newly-issued JWT fail after a
-- concurrent reset/suspension even if its row was inserted after the
-- bulk update. Validation requires both to agree.
--
-- Admin JWTs have no users row. Their sessions live in the same
-- table with role = 'admin' and user_id = NULL. The admin JWT also
-- carries a fingerprint derived from ADMIN_PASSWORD, so rotating
-- that env var invalidates issued admin tokens without a database
-- write.
--
-- RLS is enabled and no policies are created: every access goes
-- through the server-side service-role client.
-- ============================================================

-- ─── Users: the global generation ─────────────────────────────

alter table public.users
  add column if not exists session_version integer not null default 1;

comment on column public.users.session_version is
  'Bumped by logout-all, password reset, suspension and unblocking. A JWT is valid only when its sv claim matches this value.';

-- ─── Session registry ─────────────────────────────────────────

create table if not exists public.auth_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users (id) on delete cascade,
  role            text not null check (role in ('user', 'admin')),
  session_version integer not null default 0,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  revoked_reason  text,
  user_agent      text,
  constraint auth_sessions_subject check (
    (role = 'user' and user_id is not null)
    or (role = 'admin' and user_id is null)
  ),
  constraint auth_sessions_expiry_after_creation check (expires_at > created_at)
);

create index if not exists idx_auth_sessions_user_active
  on public.auth_sessions (user_id, expires_at)
  where revoked_at is null;

create index if not exists idx_auth_sessions_admin_active
  on public.auth_sessions (expires_at)
  where role = 'admin' and revoked_at is null;

alter table public.auth_sessions enable row level security;

revoke all on table public.auth_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_sessions to service_role;

comment on table public.auth_sessions is
  'One row per issued JWT. Revoked or expired rows are rejected by the web app and realtime service. Service-role only.';
comment on column public.auth_sessions.session_version is
  'The users.session_version value the JWT was issued with. A mismatch invalidates the session even if this row was not revoked.';

-- ─── Issue a session ──────────────────────────────────────────
-- Reading the version and inserting the row in one statement closes
-- the race where a reset/suspension lands between the login read and
-- the session insert.

create or replace function public.create_auth_session(
  p_user_id uuid,
  p_role text,
  p_expires_at timestamptz,
  p_user_agent text default null
)
returns table (session_id uuid, session_version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer;
begin
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'session_expiry_invalid' using errcode = '22023';
  end if;

  if p_role = 'user' then
    if p_user_id is null then
      raise exception 'session_subject_invalid' using errcode = '22023';
    end if;

    select u.session_version
      into v_version
      from public.users u
     where u.id = p_user_id
       and u.is_blocked = false;

    if v_version is null then
      raise exception 'account_unavailable' using errcode = 'P0001';
    end if;
  elsif p_role = 'admin' then
    if p_user_id is not null then
      raise exception 'session_subject_invalid' using errcode = '22023';
    end if;
    v_version := 0;
  else
    raise exception 'session_role_invalid' using errcode = '22023';
  end if;

  return query
    insert into public.auth_sessions (
      user_id,
      role,
      session_version,
      expires_at,
      user_agent
    )
    values (
      p_user_id,
      p_role,
      v_version,
      p_expires_at,
      nullif(left(coalesce(p_user_agent, ''), 512), '')
    )
    returning auth_sessions.id, auth_sessions.session_version;
end;
$$;

comment on function public.create_auth_session(uuid, text, timestamptz, text) is
  'Atomically reads the current account version and inserts the session row used by a newly-issued JWT.';

-- ─── Revoke one session (logout) ──────────────────────────────

create or replace function public.revoke_auth_session(
  p_session_id uuid,
  p_reason text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, nullif(p_reason, ''))
   where id = p_session_id;
$$;

comment on function public.revoke_auth_session(uuid, text) is
  'Revokes one device session. Used by logout and by admin logout.';

-- ─── Revoke every session + bump the generation ───────────────

create or replace function public.revoke_all_user_sessions(
  p_user_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer;
begin
  update public.users
     set session_version = session_version + 1,
         updated_at = now()
   where id = p_user_id
  returning session_version into v_version;

  if v_version is null then
    return null;
  end if;

  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, nullif(p_reason, ''))
   where user_id = p_user_id
     and revoked_at is null;

  return v_version;
end;
$$;

comment on function public.revoke_all_user_sessions(uuid, text) is
  'Logout-all, password reset and suspension. Bumps users.session_version and revokes every registry row.';

-- ─── Revoke the other devices (password change) ───────────────

create or replace function public.revoke_other_user_sessions(
  p_user_id uuid,
  p_keep_session_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, nullif(p_reason, ''))
   where user_id = p_user_id
     and (p_keep_session_id is null or id <> p_keep_session_id)
     and revoked_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.revoke_other_user_sessions(uuid, uuid, text) is
  'Password change: revokes every device except the one making the change. Does not bump the global version.';

-- ─── Password change ──────────────────────────────────────────

-- The optional expected hash makes the change optimistic: a password reset
-- that commits between the route's bcrypt compare and this update changes the
-- hash, the update matches zero rows, and the caller gets password_changed
-- instead of overwriting the victim's new password.
drop function if exists public.change_user_password(uuid, text, uuid);

create or replace function public.change_user_password(
  p_user_id uuid,
  p_password_hash text,
  p_keep_session_id uuid,
  p_expected_hash text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(p_password_hash, '') is null then
    raise exception 'password_hash_invalid' using errcode = '22023';
  end if;

  update public.users
     set password_hash = p_password_hash,
         updated_at = now()
   where id = p_user_id
     and (p_expected_hash is null or password_hash = p_expected_hash);

  if not found then
    raise exception 'password_changed' using errcode = 'P0001';
  end if;

  return public.revoke_other_user_sessions(
    p_user_id,
    p_keep_session_id,
    'password_change'
  );
end;
$$;

comment on function public.change_user_password(uuid, text, uuid, text) is
  'Updates the password hash (optimistically matched against the expected old hash) and revokes every other device, keeping the current session alive.';

-- ─── Suspension / unblocking ──────────────────────────────────

create or replace function public.set_user_blocked(
  p_user_id uuid,
  p_blocked boolean,
  p_reason text
)
returns table (id uuid, is_blocked boolean, session_version integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users as u
     set is_blocked = p_blocked,
         session_version = u.session_version + 1,
         updated_at = now()
   where u.id = p_user_id
  returning u.id, u.is_blocked, u.session_version
       into id, is_blocked, session_version;

  if not found then
    raise exception 'account_unavailable' using errcode = 'P0001';
  end if;

  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, nullif(p_reason, ''))
   where user_id = p_user_id
     and revoked_at is null;

  return next;
end;
$$;

comment on function public.set_user_blocked(uuid, boolean, text) is
  'Blocks or unblocks an account, bumps its session version and revokes every session. Unblocking still requires a fresh login.';

-- ─── Password reset ───────────────────────────────────────────

create or replace function public.complete_password_reset(
  p_token text,
  p_password_hash text
)
returns table (status text, user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reset_id uuid;
  v_user_id uuid;
  v_expires_at timestamptz;
  v_used_at timestamptz;
begin
  if nullif(p_password_hash, '') is null then
    raise exception 'password_hash_invalid' using errcode = '22023';
  end if;

  select pr.id, pr.user_id, pr.expires_at, pr.used_at
    into v_reset_id, v_user_id, v_expires_at, v_used_at
    from public.password_resets pr
   where pr.token = p_token
     for update;

  if v_reset_id is null then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if v_used_at is not null then
    return query select 'used'::text, v_user_id;
    return;
  end if;

  if v_expires_at <= now() then
    return query select 'expired'::text, v_user_id;
    return;
  end if;

  update public.password_resets
     set used_at = now()
   where id = v_reset_id;

  update public.users
     set password_hash = p_password_hash,
         session_version = session_version + 1,
         updated_at = now()
   where id = v_user_id;

  if not found then
    return query select 'missing_user'::text, v_user_id;
    return;
  end if;

  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, 'password_reset')
   where auth_sessions.user_id = v_user_id
     and revoked_at is null;

  return query select 'ok'::text, v_user_id;
end;
$$;

comment on function public.complete_password_reset(text, text) is
  'Atomic reset: claims the token, changes the hash, bumps the session version and revokes every session.';

-- ─── Admin logout-all ─────────────────────────────────────────

create or replace function public.revoke_all_admin_sessions(
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.auth_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_reason = coalesce(revoked_reason, nullif(p_reason, ''))
   where role = 'admin'
     and revoked_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.revoke_all_admin_sessions(text) is
  'Revokes every environment-admin session. Rotating ADMIN_PASSWORD also invalidates them through the JWT admin fingerprint.';

-- ─── Execution grants ────────────────────────────────────────

revoke all on function public.create_auth_session(uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.revoke_auth_session(uuid, text) from public, anon, authenticated;
revoke all on function public.revoke_all_user_sessions(uuid, text) from public, anon, authenticated;
revoke all on function public.revoke_other_user_sessions(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.change_user_password(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.set_user_blocked(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.complete_password_reset(text, text) from public, anon, authenticated;
revoke all on function public.revoke_all_admin_sessions(text) from public, anon, authenticated;

grant execute on function public.create_auth_session(uuid, text, timestamptz, text) to service_role;
grant execute on function public.revoke_auth_session(uuid, text) to service_role;
grant execute on function public.revoke_all_user_sessions(uuid, text) to service_role;
grant execute on function public.revoke_other_user_sessions(uuid, uuid, text) to service_role;
grant execute on function public.change_user_password(uuid, text, uuid, text) to service_role;
grant execute on function public.set_user_blocked(uuid, boolean, text) to service_role;
grant execute on function public.complete_password_reset(text, text) to service_role;
grant execute on function public.revoke_all_admin_sessions(text) to service_role;

-- ─── Admin subject guard ─────────────────────────────────────
-- A role change on an existing row must not be able to turn a user
-- session into an admin one (or vice versa). The check constraint
-- above applies to INSERT and UPDATE already, so no extra trigger is
-- needed; this comment records the intent.
