begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- Fixtures: one master row per type with a picture, a city without one, and
-- communities whose mirrored copy is stale (old URL) or missing (null). The
-- user-led community is unrelated to master data and must never be touched.
insert into public.cities(id, name, image_url) values
  ('bf200000-0000-4000-8000-000000000001', 'Backfill City', 'https://r2/backfill-city.webp'),
  ('bf200000-0000-4000-8000-000000000002', 'Pictureless City', null);
insert into public.design_sectors(id, name, image_url) values
  ('bf300000-0000-4000-8000-000000000001', 'Backfill Sector', 'https://r2/backfill-sector.webp');
insert into public.experience_levels(id, slug, name, image_url) values
  ('bf400000-0000-4000-8000-000000000001', 'backfill_level', 'Backfill Level', 'https://r2/backfill-level.webp');
insert into public.job_titles(id, slug, name, image_url) values
  ('bf500000-0000-4000-8000-000000000001', 'backfill_title', 'Backfill Title', 'https://r2/backfill-title.webp');

insert into public.users(id, name, email, password_hash) values
  ('bf100000-0000-4000-8000-000000000001', 'Backfill Owner', 'backfill-owner@test.invalid', 'hash');
insert into public.communities(id, type, reference_id, name, image_url, owner_id) values
  ('bf600000-0000-4000-8000-000000000001', 'city', 'bf200000-0000-4000-8000-000000000001', 'Backfill City Designers', 'https://r2/old-city.webp', null),
  ('bf600000-0000-4000-8000-000000000002', 'city', 'bf200000-0000-4000-8000-000000000002', 'Pictureless City Designers', 'https://r2/kept.webp', null),
  ('bf600000-0000-4000-8000-000000000003', 'sector', 'bf300000-0000-4000-8000-000000000001', 'Backfill Sector Community', null, null),
  ('bf600000-0000-4000-8000-000000000004', 'experience_level', 'bf400000-0000-4000-8000-000000000001', 'Backfill Level', 'https://r2/old-level.webp', null),
  ('bf600000-0000-4000-8000-000000000005', 'job_title', 'bf500000-0000-4000-8000-000000000001', 'Backfill Title', null, null),
  ('bf600000-0000-4000-8000-000000000006', 'user', null, 'Member Uploaded Community', 'https://r2/member.webp', 'bf100000-0000-4000-8000-000000000001');

\ir ../migrations/20261105000000_backfill_official_community_images.sql

select is(
  (select image_url from public.communities where id = 'bf600000-0000-4000-8000-000000000001'),
  'https://r2/backfill-city.webp',
  'a stale city copy is replaced with the master picture'
);
select is(
  (select image_url from public.communities where id = 'bf600000-0000-4000-8000-000000000003'),
  'https://r2/backfill-sector.webp',
  'a missing sector copy is filled from the master picture'
);
select is(
  (select image_url from public.communities where id = 'bf600000-0000-4000-8000-000000000004'),
  'https://r2/backfill-level.webp',
  'a stale experience-level copy is replaced'
);
select is(
  (select image_url from public.communities where id = 'bf600000-0000-4000-8000-000000000005'),
  'https://r2/backfill-title.webp',
  'a missing job-title copy is filled'
);
select is(
  (select image_url from public.communities where id = 'bf600000-0000-4000-8000-000000000002'),
  'https://r2/kept.webp',
  'a master row without a picture leaves its community copy untouched'
);
select is(
  (select image_url from public.communities where id = 'bf600000-0000-4000-8000-000000000006'),
  'https://r2/member.webp',
  'member-led communities are never touched'
);

-- Idempotence: a second run must change no row.
create temporary table copies_before as
select id, image_url from public.communities where id::text like 'bf600000-%';

\ir ../migrations/20261105000000_backfill_official_community_images.sql

select is(
  (select count(*)::integer from public.communities c
    join copies_before b on b.id = c.id
    where c.image_url is distinct from b.image_url),
  0,
  're-running the backfill changes nothing'
);

select is(
  (select count(*)::integer from public.communities where type = 'city' and reference_id = 'bf200000-0000-4000-8000-000000000001'),
  1,
  'the backfill never creates or removes communities'
);
select is(
  (select image_url from public.communities where id = 'bf600000-0000-4000-8000-000000000003'),
  'https://r2/backfill-sector.webp',
  'the filled copy survives the second run'
);
select is(
  (select image_url from public.communities where id = 'bf600000-0000-4000-8000-000000000006'),
  'https://r2/member.webp',
  'the member-led copy survives the second run'
);

select * from finish();
rollback;
