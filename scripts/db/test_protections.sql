-- Disposable database only. The harness verifies loopback identity first.
begin;

do $test$
declare
  application uuid;
  member uuid;
  audit_entry uuid;
begin
  if not exists (
    select 1 from pg_attribute a join pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.notification_preferences'::regclass
      and a.attname = 'community_push_enabled' and not a.attisdropped
      and a.atttypid = 'boolean'::regtype and a.attnotnull
      and pg_get_expr(d.adbin, d.adrelid) = 'true'
  ) then
    raise exception 'community push preference has the wrong definition';
  end if;

  if not exists (
    select 1 from pg_constraint c join pg_index i on i.indexrelid = c.conindid
    where c.conrelid = 'public.users'::regclass
      and c.conname = 'users_application_id_unique' and c.contype = 'u'
      and not c.condeferrable and c.convalidated
      and i.indisunique and i.indisvalid and i.indisready
      and not i.indnullsnotdistinct and i.indnkeyatts = 1
      and i.indexprs is null and i.indpred is null
      and pg_get_constraintdef(c.oid) = 'UNIQUE (application_id)'
  ) then
    raise exception 'application uniqueness has the wrong definition';
  end if;

  insert into public.applications
    (name, email, linkedin_url, portfolio_url, applicant_email)
  values ('Baseline test', 'baseline-app@example.test', '', '', 'baseline-app@example.test')
  returning id into application;
  insert into public.users (application_id, name, email, password_hash)
  values (application, 'Baseline test', 'baseline-one@example.test', 'test-only')
  returning id into member;

  begin
    insert into public.users (application_id, name, email, password_hash)
    values (application, 'Duplicate test', 'baseline-two@example.test', 'test-only');
    raise exception 'duplicate application id was accepted';
  exception when unique_violation then
    null;
  end;

  insert into public.users (application_id, name, email, password_hash) values
    (null, 'Direct one', 'baseline-null-one@example.test', 'test-only'),
    (null, 'Direct two', 'baseline-null-two@example.test', 'test-only');

  insert into public.notification_preferences (user_id) values (member);
  if not (select community_push_enabled from public.notification_preferences where user_id=member) then
    raise exception 'push preference did not default to true';
  end if;
  update public.notification_preferences set community_push_enabled=false where user_id=member;
  if (select community_push_enabled from public.notification_preferences where user_id=member) then
    raise exception 'explicit false preference was overwritten';
  end if;

  -- Preserve the live ACLs, while proving append-only behavior independently.
  insert into public.moderation_audit_log (action, target_type)
  values ('dismiss_report', 'baseline-test') returning id into audit_entry;
  begin
    update public.moderation_audit_log set reason='changed' where id=audit_entry;
    raise exception 'audit log update was accepted';
  exception when raise_exception then
    if sqlerrm <> 'moderation_audit_log is append-only' then raise; end if;
  end;
  begin
    delete from public.moderation_audit_log where id=audit_entry;
    raise exception 'audit log delete was accepted';
  exception when raise_exception then
    if sqlerrm <> 'moderation_audit_log is append-only' then raise; end if;
  end;
end
$test$;

rollback;
