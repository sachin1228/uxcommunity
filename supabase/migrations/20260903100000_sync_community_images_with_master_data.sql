-- ============================================================
-- Sync app-created community images with master data
--
-- App-created communities (general/city/sector/interest/
-- experience_level — owner_id IS NULL) copy their image from a
-- master table at upsert time (auto-join). When an admin later
-- changes that master image, the stored copy in
-- communities.image_url goes stale until the next auto-join
-- upsert refreshes it.
--
-- This backfills the stored image_url for every app-created
-- community to the current master image, so the communities
-- table itself is the synced source. The admin Communities API
-- also resolves master images at read time, so display stays
-- correct even before this runs — this is a one-time data repair.
-- ============================================================

update public.communities as c
   set image_url = t.image_url
  from public.cities as t
 where c.type = 'city'
   and c.owner_id is null
   and c.reference_id = t.id
   and c.image_url is distinct from t.image_url;

update public.communities as c
   set image_url = t.image_url
  from public.design_sectors as t
 where c.type = 'sector'
   and c.owner_id is null
   and c.reference_id = t.id
   and c.image_url is distinct from t.image_url;

update public.communities as c
   set image_url = t.image_url
  from public.design_interests as t
 where c.type = 'interest'
   and c.owner_id is null
   and c.reference_id = t.id
   and c.image_url is distinct from t.image_url;

update public.communities as c
   set image_url = t.image_url
  from public.experience_levels as t
 where c.type = 'experience_level'
   and c.owner_id is null
   and c.reference_id = t.id
   and c.image_url is distinct from t.image_url;