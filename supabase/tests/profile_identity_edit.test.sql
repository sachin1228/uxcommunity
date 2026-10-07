-- ============================================================
-- Profile identity edit (migration 20261007120000): cooldowns + group swaps
--
-- update_profile_identity() is the one writer of the identity slots edited
-- from the profile modal (name / designation / city / sector). These
-- assertions pin the contract the modal and the API rely on:
--
--   * each slot can change once per three months — independently;
--   * "designation" is ONE slot covering experience level AND job title;
--   * a change swaps the member between the official groups of the changed
--     dimension only (leave old value's group, join new value's group,
--     upserting it exactly like auto-join does), moving the membership;
--   * the General community and the other dimensions' memberships are never
--     touched;
--   * catch-all "Other" values produce no community (leave only);
--   * a missing old membership is not an error (nothing to leave);
--   * inactive master values are refused whole (nothing applied);
--   * same-value calls are no-ops and consume no cooldown.
--
-- Master rows (Pune / Mumbai / Other cities, sectors, levels, titles) come
-- from the migration seeds; the fixtures below only add users, profiles,
-- communities and memberships. Everything runs in a transaction and rolls
-- back.
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- ─── Seeded master rows ─────────────────────────────────────────────────────
create temporary table fx as
select
  (select id            from public.cities where name = 'Pune')                     as pune_id,
  (select id            from public.cities where name = 'Mumbai')                   as mumbai_id,
  (select id            from public.cities where name = 'Other' and is_active)      as other_city_id,
  (select id            from public.design_sectors where name = 'Healthcare & MedTech') as sector_a_id,
  (select id            from public.design_sectors where name = 'Finance & Fintech')    as sector_b_id,
  (select id            from public.experience_levels where slug = 'mid_level')     as mid_level_id,
  (select id            from public.experience_levels where slug = 'senior')        as senior_id,
  (select id            from public.job_titles where slug = 'product_designer')     as product_title_id,
  (select id            from public.job_titles where slug = 'ux_designer')          as ux_title_id;

-- ─── Fixtures ───────────────────────────────────────────────────────────────
-- Three members: "one" (full auto-join memberships), "two" (general + city),
-- "three" (general only — as if they had left the city group before).

insert into public.users (id, name, email, password_hash) values
  ('0b000000-0000-4000-8000-000000000001', 'Member One',   'one@example.test',   'x'),
  ('0b000000-0000-4000-8000-000000000002', 'Member Two',   'two@example.test',   'x'),
  ('0b000000-0000-4000-8000-000000000003', 'Member Three', 'three@example.test', 'x');

insert into public.designer_profiles (user_id, city_id, sector_id, experience_level, job_title)
select u.id, fx.pune_id, fx.sector_a_id, 'mid_level', 'product_designer'
  from fx,
       (values ('0b000000-0000-4000-8000-000000000001'::uuid),
               ('0b000000-0000-4000-8000-000000000002'::uuid),
               ('0b000000-0000-4000-8000-000000000003'::uuid)) as u(id);

-- The official groups as auto-join would have created them at signup.
-- (General is seeded as a singleton by migration 20260726500000 and job
-- title groups by 20260913120000 — the fixtures join the seeded rows.)
insert into public.communities (id, name, type, reference_id) values
  ('0a000000-0000-4000-8000-000000000002', 'Pune Designers',      'city',
   (select pune_id from fx)),
  ('0a000000-0000-4000-8000-000000000003', 'Mid-Level Designers', 'experience_level',
   (select mid_level_id from fx));

insert into public.community_members (community_id, user_id)
select (select id from public.communities where type = 'general'), u.id
  from (values ('0b000000-0000-4000-8000-000000000001'::uuid),
               ('0b000000-0000-4000-8000-000000000002'::uuid),
               ('0b000000-0000-4000-8000-000000000003'::uuid)) as u(id);

insert into public.community_members (community_id, user_id) values
  ('0a000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-000000000001'),
  ('0a000000-0000-4000-8000-000000000003', '0b000000-0000-4000-8000-000000000001'),
  ('0a000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-000000000002');

insert into public.community_members (community_id, user_id)
select c.id, '0b000000-0000-4000-8000-000000000001'
  from public.communities as c
 where c.type = 'job_title' and c.reference_id = (select product_title_id from fx);

select has_function(
  'public', 'update_profile_identity',
  array['uuid', 'text', 'uuid', 'uuid', 'text', 'text']
);

-- The cooldown records are server-side only: RLS on and no client grants,
-- the same Data-API hygiene the exposure regression test enforces.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profile_field_changes'::regclass),
  'RLS is enabled on the cooldown records'
);

select ok(
  not has_table_privilege('anon', 'public.profile_field_changes', 'SELECT')
  and not has_table_privilege('authenticated', 'public.profile_field_changes', 'SELECT'),
  'client roles cannot read the cooldown records'
);

-- ─── 1. A name-only change: no community moves, name slot consumed ──────────
create temporary table r1 as
select public.update_profile_identity(
  '0b000000-0000-4000-8000-000000000001',
  p_name => 'Renamed Member'
) as res;

select is(
  (select res ->> 'changed_fields' from r1)::jsonb, '["name"]'::jsonb,
  'name-only edit reports exactly the name slot'
);

select is(
  (select name from public.users where id = '0b000000-0000-4000-8000-000000000001'),
  'Renamed Member',
  'users.name is updated'
);

select is(
  (select jsonb_array_length((res ->> 'left_communities')::jsonb)
        + jsonb_array_length((res ->> 'joined_communities')::jsonb) from r1),
  0,
  'a name-only edit moves no communities'
);

select ok(
  exists (
    select 1 from public.profile_field_changes
     where user_id = '0b000000-0000-4000-8000-000000000001' and field = 'name'
  ),
  'the name slot records its change timestamp'
);

-- ─── 2. The slot is locked for three months ─────────────────────────────────
select throws_ok(
  $$select public.update_profile_identity(
      '0b000000-0000-4000-8000-000000000001', p_name => 'Second Name')$$,
  'P0001',
  'profile_field_cooldown',
  'a second name change inside three months is refused'
);

-- A same-value call is a no-op and must not trip the cooldown.
create temporary table r2 as
select public.update_profile_identity(
  '0b000000-0000-4000-8000-000000000001',
  p_name => 'Renamed Member'
) as res;

select is(
  (select res ->> 'changed_fields' from r2)::jsonb, '[]'::jsonb,
  'a same-value call reports no changes'
);

select is(
  (select jsonb_array_length((res ->> 'left_communities')::jsonb)
        + jsonb_array_length((res ->> 'joined_communities')::jsonb) from r2),
  0,
  'a same-value call moves no communities'
);

-- ─── 3. A city change swaps exactly the city groups ─────────────────────────
create temporary table r3 as
select public.update_profile_identity(
  '0b000000-0000-4000-8000-000000000001',
  p_city_id => (select mumbai_id from fx)
) as res;

select is(
  (select res ->> 'changed_fields' from r3)::jsonb, '["city"]'::jsonb,
  'a city edit reports the city slot'
);

select is(
  (select city_id from public.designer_profiles
    where user_id = '0b000000-0000-4000-8000-000000000001'),
  (select mumbai_id from fx),
  'designer_profiles.city_id is updated'
);

select is(
  (select res -> 'left_communities' -> 0 ->> 'name' from r3),
  'Pune Designers',
  'the old city group is left'
);

select is(
  (select res -> 'joined_communities' -> 0 ->> 'name' from r3),
  'Mumbai Designers',
  'the new city group is joined (created on demand)'
);

select ok(
  exists (
    select 1 from public.communities
     where type = 'city' and reference_id = (select mumbai_id from fx)
       and name = 'Mumbai Designers'
  ),
  'the new city community row exists'
);

select ok(
  not exists (
    select 1 from public.community_members
     where user_id = '0b000000-0000-4000-8000-000000000001'
       and community_id = '0a000000-0000-4000-8000-000000000002'
  ),
  'the old city membership is gone'
);

select ok(
  exists (
    select 1 from public.community_members cm
    join public.communities c on c.id = cm.community_id
     where cm.user_id = '0b000000-0000-4000-8000-000000000001'
       and c.type = 'city' and c.reference_id = (select mumbai_id from fx)
  ),
  'the membership moved to the new city group'
);

select ok(
  exists (
    select 1 from public.community_members
     where user_id = '0b000000-0000-4000-8000-000000000001'
       and community_id = (select id from public.communities where type = 'general')
  ),
  'General is never touched'
);

select ok(
  exists (
    select 1 from public.community_members
     where user_id = '0b000000-0000-4000-8000-000000000001'
       and community_id = '0a000000-0000-4000-8000-000000000003'
  ),
  'the untouched dimensions (experience level) keep their membership'
);

select throws_ok(
  $$select public.update_profile_identity(
      '0b000000-0000-4000-8000-000000000001',
      p_city_id => (select pune_id from fx))$$,
  'P0001',
  'profile_field_cooldown',
  'a second city change inside three months is refused'
);

-- ─── 4. Designation is ONE slot: a title change locks seniority too ─────────
create temporary table r4 as
select public.update_profile_identity(
  '0b000000-0000-4000-8000-000000000001',
  p_job_title => 'ux_designer'
) as res;

select is(
  (select res ->> 'changed_fields' from r4)::jsonb, '["designation"]'::jsonb,
  'a job title edit reports the designation slot'
);

select is(
  (select res -> 'left_communities' -> 0 ->> 'name' from r4),
  'Product Designer',
  'the old job title group is left'
);

select is(
  (select res -> 'joined_communities' -> 0 ->> 'name' from r4),
  'UX Designer',
  'the new job title group is joined'
);

select throws_ok(
  $$select public.update_profile_identity(
      '0b000000-0000-4000-8000-000000000001', p_experience_level => 'senior')$$,
  'P0001',
  'profile_field_cooldown',
  'an experience-level change hits the same designation cooldown'
);

-- ─── 5. When the designation cooldown lapses, both halves are available ─────
update public.profile_field_changes
   set changed_at = now() - interval '4 months'
 where user_id = '0b000000-0000-4000-8000-000000000001' and field = 'designation';

create temporary table r5 as
select public.update_profile_identity(
  '0b000000-0000-4000-8000-000000000001',
  p_experience_level => 'senior'
) as res;

select is(
  (select res ->> 'changed_fields' from r5)::jsonb, '["designation"]'::jsonb,
  'a lapsed designation slot can be used again'
);

select is(
  (select res -> 'left_communities' -> 0 ->> 'name' from r5),
  'Mid-Level Designers',
  'the old experience-level group is left'
);

select is(
  (select res -> 'joined_communities' -> 0 ->> 'name' from r5),
  'Senior Designers',
  'the new experience-level group is joined'
);

select ok(
  exists (
    select 1 from public.community_members cm
    join public.communities c on c.id = cm.community_id
     where cm.user_id = '0b000000-0000-4000-8000-000000000001'
       and c.type = 'job_title' and c.reference_id = (select ux_title_id from fx)
  ),
  'roles inside one designation change move only the changed dimension'
);

-- ─── 6. "Other" joins nothing: the catch-all keeps members in General ───────
create temporary table r6 as
select public.update_profile_identity(
  '0b000000-0000-4000-8000-000000000002',
  p_city_id => (select other_city_id from fx)
) as res;

select is(
  (select res ->> 'changed_fields' from r6)::jsonb, '["city"]'::jsonb,
  'a catch-all city edit reports the city slot'
);

select is(
  (select res -> 'left_communities' -> 0 ->> 'name' from r6),
  'Pune Designers',
  'a catch-all city edit still leaves the old city group'
);

select is(
  (select jsonb_array_length((res ->> 'joined_communities')::jsonb) from r6),
  0,
  'a catch-all city edit joins no group'
);

select is(
  (select city_id from public.designer_profiles
    where user_id = '0b000000-0000-4000-8000-000000000002'),
  (select other_city_id from fx),
  'the catch-all city still lands on the profile'
);

-- ─── 7. Inactive master values are refused whole ────────────────────────────
update public.design_sectors
   set is_active = false
 where id = (select sector_b_id from fx);

select throws_ok(
  $$select public.update_profile_identity(
      '0b000000-0000-4000-8000-000000000002',
      p_sector_id => (select sector_b_id from fx))$$,
  '23503',
  'inactive_or_missing_profile_option',
  'an inactive sector is refused'
);

select is(
  (select sector_id from public.designer_profiles
    where user_id = '0b000000-0000-4000-8000-000000000002'),
  (select sector_a_id from fx),
  'the refusal leaves the profile untouched'
);

select ok(
  not exists (
    select 1 from public.profile_field_changes
     where user_id = '0b000000-0000-4000-8000-000000000002' and field = 'sector'
  ),
  'the refusal consumes no cooldown'
);

-- ─── 8. Not being a member of the old group is not an error ─────────────────
create temporary table r8 as
select public.update_profile_identity(
  '0b000000-0000-4000-8000-000000000003',
  p_city_id => (select mumbai_id from fx)
) as res;

select is(
  (select jsonb_array_length((res ->> 'left_communities')::jsonb) from r8),
  0,
  'a member who never held the old group leaves nothing'
);

select is(
  (select res -> 'joined_communities' -> 0 ->> 'name' from r8),
  'Mumbai Designers',
  'the new city group is still joined'
);

select ok(
  exists (
    select 1 from public.community_members cm
    join public.communities c on c.id = cm.community_id
     where cm.user_id = '0b000000-0000-4000-8000-000000000003'
       and c.type = 'city' and c.reference_id = (select mumbai_id from fx)
  ),
  'and the membership row is created'
);

select * from finish();
rollback;
