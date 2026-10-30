-- ============================================================
-- Immediate session revocation
--
-- Migration under test: 20261030210000_session_revocation.sql
--
-- Proves the database half of the contract:
--   * users get a version and auth_sessions stores one row per JWT;
--   * logout revokes one row;
--   * password change keeps the current session and revokes the rest;
--   * logout-all / reset / suspension bump the version and revoke all;
--   * unblocking does not restore an old token;
--   * deleting the user cascades its sessions;
--   * anon/authenticated cannot read or execute the registry.
--
-- Run locally:
--   bash supabase/tests/run-local.sh supabase/tests/session_revocation.test.sql
-- ============================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ─── Fixture ────────────────────────────────────────────────
delete from public.users where email = 'session-revocation@test.invalid';

insert into public.users (id, name, email, password_hash)
values (
  'a8a8a8a8-0000-4000-8000-000000000001',
  'Session revocation fixture',
  'session-revocation@test.invalid',
  'hash-0'
);

-- ─── Shape and privileges ───────────────────────────────────
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'session_version'
  ),
  'users carry a session generation'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'auth_sessions'
      and column_name = 'session_version'
  ),
  'each session records the generation it was issued with'
);

select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.auth_sessions'::regclass),
  'auth_sessions has row-level security enabled'
);

select ok(
  not has_table_privilege('anon', 'public.auth_sessions', 'select'),
  'anon cannot read the session registry'
);

select ok(
  not has_table_privilege('authenticated', 'public.auth_sessions', 'select'),
  'authenticated cannot read the session registry'
);

select ok(
  not has_function_privilege('anon',
    'public.create_auth_session(uuid,text,timestamptz,text)', 'execute'),
  'anon cannot create a session row'
);

select ok(
  has_function_privilege('service_role',
    'public.create_auth_session(uuid,text,timestamptz,text)', 'execute'),
  'service_role can create a session row'
);

-- ─── Issue two sessions ─────────────────────────────────────
create temporary table s1 as
  select * from public.create_auth_session(
    'a8a8a8a8-0000-4000-8000-000000000001',
    'user',
    now() + interval '7 days',
    'test-agent'
  );

create temporary table s2 as
  select * from public.create_auth_session(
    'a8a8a8a8-0000-4000-8000-000000000001',
    'user',
    now() + interval '7 days',
    'test-agent'
  );

select is((select session_version from s1), 1,
  'a new session carries the account generation');

select is(
  (select count(*)::integer from public.auth_sessions
    where user_id = 'a8a8a8a8-0000-4000-8000-000000000001'),
  2,
  'two logins create two independent registry rows'
);

-- ─── Logout one device ──────────────────────────────────────
select public.revoke_auth_session((select session_id from s2), 'logout');

select ok(
  (select revoked_at is not null from public.auth_sessions
    where id = (select session_id from s2)),
  'logout revokes only that session'
);

select ok(
  (select revoked_at is null from public.auth_sessions
    where id = (select session_id from s1)),
  'the other device stays active after logout'
);

-- ─── Password change keeps the current device ───────────────
create temporary table s3 as
  select * from public.create_auth_session(
    'a8a8a8a8-0000-4000-8000-000000000001',
    'user',
    now() + interval '7 days',
    'test-agent'
  );

select is(
  public.change_user_password(
    'a8a8a8a8-0000-4000-8000-000000000001',
    'hash-1',
    (select session_id from s1),
    'hash-0'
  ),
  1,
  'password change revokes the one other active session'
);

select is(
  (select password_hash from public.users
    where id = 'a8a8a8a8-0000-4000-8000-000000000001'),
  'hash-1',
  'password change updates the stored hash'
);

select ok(
  (select revoked_at is null from public.auth_sessions
    where id = (select session_id from s1)),
  'password change keeps the current session active'
);

select ok(
  (select revoked_at is not null from public.auth_sessions
    where id = (select session_id from s3)),
  'password change revokes a second device'
);

-- ─── Logout all / password reset style revocation ───────────
select is(
  public.revoke_all_user_sessions(
    'a8a8a8a8-0000-4000-8000-000000000001',
    'logout_all'
  ),
  2,
  'logout-all bumps the account generation'
);

select ok(
  not exists (
    select 1 from public.auth_sessions
    where user_id = 'a8a8a8a8-0000-4000-8000-000000000001'
      and revoked_at is null
  ),
  'logout-all leaves no active registry row'
);

-- ─── Suspension and unblocking ──────────────────────────────
select is(
  (select session_version from public.set_user_blocked(
    'a8a8a8a8-0000-4000-8000-000000000001',
    true,
    'account_blocked'
  )),
  3,
  'suspension bumps the account generation'
);

select ok(
  (select is_blocked from public.users
    where id = 'a8a8a8a8-0000-4000-8000-000000000001'),
  'suspension sets is_blocked'
);

select is(
  (select session_version from public.set_user_blocked(
    'a8a8a8a8-0000-4000-8000-000000000001',
    false,
    'account_unblocked'
  )),
  4,
  'unblocking bumps the generation again, so no old token returns'
);

-- ─── Password reset is atomic ───────────────────────────────
insert into public.password_resets (user_id, token)
values (
  'a8a8a8a8-0000-4000-8000-000000000001',
  'session-revocation-reset-token'
);

create temporary table reset_result as
  select * from public.complete_password_reset(
    'session-revocation-reset-token',
    'hash-2'
  );

select is((select status from reset_result), 'ok',
  'a valid reset token completes');

select is(
  (select session_version from public.users
    where id = 'a8a8a8a8-0000-4000-8000-000000000001'),
  5,
  'password reset bumps the account generation'
);

select ok(
  (select used_at is not null from public.password_resets
    where token = 'session-revocation-reset-token'),
  'password reset claims the token atomically'
);

create temporary table reset_result_2 as
  select * from public.complete_password_reset(
    'session-revocation-reset-token',
    'hash-3'
  );

select is((select status from reset_result_2), 'used',
  'a claimed reset token cannot be replayed');

-- ─── Admin sessions are separate and revocable ──────────────
create temporary table admin_session as
  select * from public.create_auth_session(
    null,
    'admin',
    now() + interval '7 days',
    'admin-agent'
  );

select is((select session_version from admin_session), 0,
  'admin sessions carry the reserved version');

select is(
  public.revoke_all_admin_sessions('admin_logout_all'),
  1,
  'admin logout-all revokes the admin session'
);

-- ─── Deletion cascades ──────────────────────────────────────
delete from public.users
where id = 'a8a8a8a8-0000-4000-8000-000000000001';

select is(
  (select count(*)::integer from public.auth_sessions
    where user_id = 'a8a8a8a8-0000-4000-8000-000000000001'),
  0,
  'deleting the user cascades its session rows away'
);

select * from finish();
rollback;
