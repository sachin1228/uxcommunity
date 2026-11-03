begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.users(id, name, email, password_hash) values
 ('af000000-0000-4000-8000-000000000001', 'Login fixture', 'login-performance@test.invalid', 'hash-old');

select ok(not has_function_privilege('anon', 'public.create_login_session(uuid,text,timestamptz,text)', 'execute'), 'anonymous cannot issue sessions');
select ok(not has_function_privilege('authenticated', 'public.create_login_session(uuid,text,timestamptz,text)', 'execute'), 'members cannot issue sessions directly');
select ok(has_function_privilege('service_role', 'public.create_login_session(uuid,text,timestamptz,text)', 'execute'), 'service role may issue sessions');

create temporary table issued as select * from public.create_login_session(
 'af000000-0000-4000-8000-000000000001', 'hash-old', now() + interval '7 days', repeat('a', 600));
select is((select session_version from issued), 1, 'successful login uses the live generation');
select is((select length(user_agent) from public.auth_sessions where id = (select session_id from issued)), 512, 'user agent remains bounded');
select throws_ok($$select * from public.create_login_session('af000000-0000-4000-8000-000000000001','wrong-hash',now()+interval '7 days')$$, 'P0001', 'password_changed', 'a stale verified password is refused');
select throws_ok($$select * from public.create_login_session('af000000-0000-4000-8000-000000000001',null,now()+interval '7 days')$$, 'P0001', 'password_changed', 'null is not an unchecked login');
select is((select count(*)::integer from public.auth_sessions where user_id='af000000-0000-4000-8000-000000000001'), 1, 'refused logins leave no session rows');
select throws_ok($$select * from public.create_login_session('af000000-0000-4000-8000-000000000001','hash-old',now()-interval '1 minute')$$, '22023', 'session_expiry_invalid', 'expired session is refused');

update public.users set is_blocked = true where id='af000000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.create_login_session('af000000-0000-4000-8000-000000000001','hash-old',now()+interval '7 days')$$, 'P0001', 'account_unavailable', 'suspended account cannot issue a session');
update public.users set is_blocked = false, suspended_until = now()+interval '1 day' where id='af000000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.create_login_session('af000000-0000-4000-8000-000000000001','hash-old',now()+interval '7 days')$$, 'P0001', 'account_unavailable', 'temporary suspension cannot issue a session');
update public.users set suspended_until = null, password_hash = 'hash-new' where id='af000000-0000-4000-8000-000000000001';
select public.revoke_all_user_sessions('af000000-0000-4000-8000-000000000001', 'test_reset');
select throws_ok($$select * from public.create_login_session('af000000-0000-4000-8000-000000000001','hash-old',now()+interval '7 days')$$, 'P0001', 'password_changed', 'reset before issuance invalidates the old password');
select is((select count(*)::integer from public.auth_sessions where user_id='af000000-0000-4000-8000-000000000001' and revoked_at is null), 0, 'reset revokes the session issued before it');
select is((select session_version from public.create_login_session('af000000-0000-4000-8000-000000000001','hash-new',now()+interval '7 days')), 2, 'new password receives the new generation');
select lives_ok($$select * from public.create_auth_session(null,'admin',now()+interval '7 days')$$, 'old admin RPC stays compatible');
select lives_ok($$select * from public.create_auth_session('af000000-0000-4000-8000-000000000001','user',now()+interval '7 days')$$, 'old signup RPC stays compatible');
delete from public.users where id='af000000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.create_login_session('af000000-0000-4000-8000-000000000001','hash-new',now()+interval '7 days')$$, 'P0001', 'account_unavailable', 'deleted accounts cannot issue sessions');
select * from finish();
rollback;
