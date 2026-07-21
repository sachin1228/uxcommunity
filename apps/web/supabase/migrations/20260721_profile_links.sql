-- Add editable profile fields to designer_profiles
alter table designer_profiles
  add column if not exists linkedin_url  text,
  add column if not exists portfolio_url text,
  add column if not exists bio           text;

-- Back-fill linkedin/portfolio from the linked application (best-effort)
update designer_profiles dp
set
  linkedin_url  = a.linkedin_url,
  portfolio_url = a.portfolio_url
from users u
join applications a on a.id = u.application_id
where dp.user_id = u.id
  and dp.linkedin_url  is null
  and dp.portfolio_url is null;
