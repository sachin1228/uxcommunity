-- Backfill the display-picture copy for app-created communities.
--
-- Every master image write mirrors the new URL onto the communities rows that
-- point at it (see lib/master-data/mirror-image.ts), and the read path trusts
-- that copy first — it is written in the same request as the master row, while
-- the cached master map can lag for up to an hour. Rows created before the
-- mirror shipped, or while their master row had no picture yet, still hold a
-- stale copy or none at all, so bring the copies in line once.
--
-- Idempotent: re-running changes nothing. A master row without a picture
-- leaves its communities untouched — the read path keeps showing their stored
-- copy in that case — so this never clears a picture anyone can see today.
-- The replaced objects become unreferenced and are reclaimed by the existing
-- admin orphan scan (R2 storage health), the same path the mirror uses.
update public.communities as c
set image_url = m.image_url
from public.cities as m
where c.type = 'city'
  and c.reference_id = m.id
  and m.image_url is not null
  and c.image_url is distinct from m.image_url;

update public.communities as c
set image_url = m.image_url
from public.design_sectors as m
where c.type = 'sector'
  and c.reference_id = m.id
  and m.image_url is not null
  and c.image_url is distinct from m.image_url;

update public.communities as c
set image_url = m.image_url
from public.experience_levels as m
where c.type = 'experience_level'
  and c.reference_id = m.id
  and m.image_url is not null
  and c.image_url is distinct from m.image_url;

update public.communities as c
set image_url = m.image_url
from public.job_titles as m
where c.type = 'job_title'
  and c.reference_id = m.id
  and m.image_url is not null
  and c.image_url is distinct from m.image_url;
